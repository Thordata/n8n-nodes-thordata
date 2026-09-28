import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import type {
  IDataObject,
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INode,
  INodeExecutionData,
  INodePropertyOptions,
  INodePropertyTypeOptions,
  INodeType,
  INodeTypeDescription,
  JsonObject,
  NodeConnectionType,
  ResourceMapperFields,
} from 'n8n-workflow';

import {
  buildSchemaRequestOptions,
  serpSchemaRepository,
} from './schema-client';
import {
  findEngine,
  isMultiValueField,
  SERP_ENGINE_FAMILIES,
  toOperationOptions,
  toResourceMapperFields,
  type SerpSchema,
} from './schema';
import {
  buildSerpParams,
  buildSerpRequestOptions,
  encodeUuleLocation,
  type ParamsJsonInput,
} from './request';
import { normalizeSerpResponse } from './response';
import { DATASET_DELIVERY_TYPES, DATASET_FORMATS, DATASET_OPERATIONS, DATASET_PURCHASE_TYPES, VIDEO_DATA_CONTACT } from './dataset-delivery';
import { assertDatasetSnapshotReady, buildDatasetRequestOptions, createDatasetIdempotencyKey, normalizeDatasetResponse } from './dataset-request';
import { loadDatasetCatalog } from './dataset-schema-client';
import { chooseDatasetPackageId, chooseDatasetRecordLimit, datasetPackages, toDatasetPackageOptions, toDatasetRecordOptions, type DatasetPurchaseType } from './dataset-package';

type ThordataNodeError = NodeApiError | NodeOperationError;
type CompatibleResourceMapperOptions = NonNullable<
  INodePropertyTypeOptions['resourceMapper']
> & {
  hideNoDataError: boolean;
};

const SERP_RESOURCE_MAPPER_OPTIONS: CompatibleResourceMapperOptions = {
  resourceMapperMethod: 'getSerpParameters',
  mode: 'add',
  fieldWords: { singular: 'parameter', plural: 'parameters' },
  addAllFields: true,
  supportAutoMap: false,
  hideNoDataError: true,
};

const VISIBLE_UULE_ENGINES = ['google_ai_mode', 'google_web', 'google_local', 'google_jobs'];

// n8n's resourceMapper cannot store arrays (the editor writes any value that is not a
// string/number/boolean as null), so multi-select fields are exposed as top-level
// multiOptions properties instead, and their options still load from the backend schema.
// Only google_web currently has visible multi-select fields (cr / lr).
const MULTI_VALUE_ENGINES = ['google_web'];
const MULTI_VALUE_PROPERTIES = [
  { name: 'cr', displayName: 'Set Multiple Countries', loadOptionsMethod: 'getMultiCountries' },
  { name: 'lr', displayName: 'Set Multiple Languages', loadOptionsMethod: 'getMultiLanguages' },
] as const;

async function loadMultiValueOptions(
  loadOptions: ILoadOptionsFunctions,
  key: string,
): Promise<INodePropertyOptions[]> {
  const schema = await serpSchemaRepository.getForEditor(
    () => loadOptions.helpers.httpRequest(buildSchemaRequestOptions()),
  );
  const operation = loadOptions.getCurrentNodeParameter('operation');
  const engineKey = typeof operation === 'string'
    && schema.engines.some((candidate) => candidate.key === operation)
    ? operation
    : schema.defaultEngine;
  const field = findEngine(schema, engineKey).fields.find(
    (candidate) => candidate.key === key && candidate.visible && isMultiValueField(candidate),
  );
  return field?.options ? field.options.map((option) => ({ ...option })) : [];
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (
    typeof error === 'object'
    && error !== null
    && 'message' in error
    && typeof error.message === 'string'
  ) {
    return new Error(error.message);
  }
  return new Error(typeof error === 'string' ? error : 'Unknown error');
}

function normalizeNodeError(
  node: INode,
  error: unknown,
  itemIndex?: number,
  cloneExisting = false,
): ThordataNodeError {
  if (error instanceof NodeApiError || error instanceof NodeOperationError) {
    if (cloneExisting && typeof itemIndex === 'number') {
      return cloneNodeErrorWithItemIndex(error, itemIndex);
    }
    if (typeof itemIndex === 'number' && error.context.itemIndex === undefined) {
      try {
        error.context.itemIndex = itemIndex;
      } catch {
        return cloneNodeErrorWithItemIndex(error, itemIndex);
      }
      if (error.context.itemIndex !== itemIndex) {
        return cloneNodeErrorWithItemIndex(error, itemIndex);
      }
    }
    return error;
  }
  return new NodeOperationError(
    node,
    toError(error),
    typeof itemIndex === 'number' ? { itemIndex } : undefined,
  );
}

function cloneNodeErrorWithItemIndex(
  error: ThordataNodeError,
  itemIndex: number,
): ThordataNodeError {
  const descriptors = Object.getOwnPropertyDescriptors(error);
  const contextDescriptor = descriptors.context;
  descriptors.context = contextDescriptor && 'value' in contextDescriptor
    ? {
        ...contextDescriptor,
        value: { ...error.context, itemIndex },
      }
    : {
        configurable: true,
        enumerable: true,
        writable: true,
        value: { ...error.context, itemIndex },
      };
  return Object.create(
    Object.getPrototypeOf(error),
    descriptors,
  ) as ThordataNodeError;
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export class Thordata implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Thordata',
    name: 'thordata',
    icon: { light: 'file:thordata.svg', dark: 'file:thordata.dark.svg' },
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Search with Thordata SERP API',
    defaults: {
      name: 'Thordata',
    },
    inputs: ['main' as NodeConnectionType],
    outputs: ['main' as NodeConnectionType],
    usableAsTool: true,
    credentials: [
      {
        name: 'thordataApi',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        options: [
          { name: 'SERP API', value: 'serp' },
          { name: 'Dataset', value: 'dataset' },
        ],
        default: 'serp',
        required: true,
        noDataExpression: true,
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        options: DATASET_OPERATIONS,
        default: 'listDatasets',
        required: true,
        noDataExpression: true,
        displayOptions: { show: { resource: ['dataset'] } },
      },
      // Each notice renders on its own line. Older n8n versions drop <br> inside a notice, so the
      // contact details are three notices instead of one string with line breaks.
      {
        displayName: '<strong>Contact Us</strong>',
        name: 'videoDataContact',
        type: 'notice',
        default: '',
        displayOptions: { show: { resource: ['dataset'], operation: ['videoData'] } },
      },
      {
        displayName: 'Email: support@thordata.com',
        name: 'videoDataEmail',
        type: 'notice',
        default: '',
        displayOptions: { show: { resource: ['dataset'], operation: ['videoData'] } },
      },
      {
        displayName: 'Website: <a href="https://www.thordata.com/?ls=video&amp;lk=video" target="_blank">thordata.com</a>',
        name: 'videoDataWebsite',
        type: 'notice',
        default: '',
        displayOptions: { show: { resource: ['dataset'], operation: ['videoData'] } },
      },
      {
        displayName: 'Purchase Type',
        name: 'purchaseType',
        type: 'options',
        options: DATASET_PURCHASE_TYPES,
        default: 'snapshot',
        required: true,
        noDataExpression: true,
        displayOptions: { show: { resource: ['dataset'], operation: ['purchaseDataset'] } },
      },
      {
        displayName: 'Dataset Name or ID',
        name: 'datasetId',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getDatasetOptions' },
        default: '',
        required: true,
        noDataExpression: true,
        description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
        displayOptions: {
          show: {
            resource: ['dataset'],
            operation: ['purchaseDataset'],
          },
        },
      },
      {
        displayName: 'Records Name or ID', name: 'recordsLimit', type: 'options',
        typeOptions: { loadOptionsMethod: 'getDatasetRecordOptions', loadOptionsDependsOn: ['datasetId', 'purchaseType', 'packageId'] },
        default: '',
        required: true, description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
        displayOptions: { show: { resource: ['dataset'], operation: ['purchaseDataset'] } },
      },
      {
        displayName: 'Package Name or ID', name: 'packageId', type: 'options',
        typeOptions: { loadOptionsMethod: 'getDatasetPackages', loadOptionsDependsOn: ['datasetId', 'purchaseType'] },
        default: '', description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
        hint: 'Uses the default package when left unset',
        displayOptions: { show: { resource: ['dataset'], operation: ['purchaseDataset'] } },
      },
      {
        displayName: 'Delivery ID', name: 'deliveryId', type: 'string', default: '',
        description: 'Delivery ID the console lists for the dataset, or a snapshot ID; uses the previous node\'s value when left empty',
        displayOptions: { show: { resource: ['dataset'], operation: ['downloadDataset', 'deliverDataset'] } },
      },
      {
        displayName: 'Format', name: 'format', type: 'options', options: DATASET_FORMATS, default: 'csv.gz', required: true,
        displayOptions: { show: { resource: ['dataset'], operation: ['downloadDataset', 'deliverDataset'] } },
      },
      {
        displayName: 'Download Mode',
        name: 'downloadMode',
        type: 'options',
        options: [
          { name: 'Download Links (Fast)', value: 'links' },
          { name: 'Binary Files', value: 'binary' },
        ],
        default: 'links',
        required: true,
        description: 'Return a lightweight download page or fetch every file into n8n binary data',
        displayOptions: { show: { resource: ['dataset'], operation: ['downloadDataset'] } },
      },
      {
        displayName: 'Destination', name: 'deliveryType', type: 'options', options: DATASET_DELIVERY_TYPES,
        default: 's3', required: true,
        displayOptions: { show: { resource: ['dataset'], operation: ['deliverDataset'] } },
      },
      {
        displayName: 'Bucket', name: 'bucket', type: 'string', default: '', required: true,
        displayOptions: { show: { resource: ['dataset'], operation: ['deliverDataset'], deliveryType: ['s3'] } },
      },
      {
        displayName: 'AWS Access Key', name: 'awsAccessKey', type: 'string', typeOptions: { password: true }, default: '', required: true,
        displayOptions: { show: { resource: ['dataset'], operation: ['deliverDataset'], deliveryType: ['s3'] } },
      },
      {
        displayName: 'AWS Secret Key', name: 'awsSecretKey', type: 'string', typeOptions: { password: true }, default: '', required: true,
        displayOptions: { show: { resource: ['dataset'], operation: ['deliverDataset'], deliveryType: ['s3'] } },
      },
      {
        displayName: 'Region', name: 'region', type: 'string', default: '',
        displayOptions: { show: { resource: ['dataset'], operation: ['deliverDataset'], deliveryType: ['s3'] } },
      },
      {
        displayName: 'Target Path', name: 'targetPath', type: 'string', default: '',
        displayOptions: { show: { resource: ['dataset'], operation: ['deliverDataset'], deliveryType: ['s3'] } },
      },
      {
        displayName: 'Account Identifier', name: 'accountIdentifier', type: 'string', default: '', required: true,
        displayOptions: { show: { resource: ['dataset'], operation: ['deliverDataset'], deliveryType: ['snowflake'] } },
      },
      {
        displayName: 'Database', name: 'database', type: 'string', default: '', required: true,
        displayOptions: { show: { resource: ['dataset'], operation: ['deliverDataset'], deliveryType: ['snowflake'] } },
      },
      {
        displayName: 'Role', name: 'role', type: 'string', default: '', required: true,
        displayOptions: { show: { resource: ['dataset'], operation: ['deliverDataset'], deliveryType: ['snowflake'] } },
      },
      {
        displayName: 'User', name: 'snowflakeUser', type: 'string', default: '', required: true,
        displayOptions: { show: { resource: ['dataset'], operation: ['deliverDataset'], deliveryType: ['snowflake'] } },
      },
      {
        displayName: 'Password', name: 'snowflakePassword', type: 'string', typeOptions: { password: true }, default: '', required: true,
        displayOptions: { show: { resource: ['dataset'], operation: ['deliverDataset'], deliveryType: ['snowflake'] } },
      },
      {
        displayName: 'Schema', name: 'schemaName', type: 'string', default: '', required: true,
        displayOptions: { show: { resource: ['dataset'], operation: ['deliverDataset'], deliveryType: ['snowflake'] } },
      },
      {
        displayName: 'Stage', name: 'stage', type: 'string', default: '', required: true,
        displayOptions: { show: { resource: ['dataset'], operation: ['deliverDataset'], deliveryType: ['snowflake'] } },
      },
      {
        displayName: 'Warehouse', name: 'warehouse', type: 'string', default: '', required: true,
        displayOptions: { show: { resource: ['dataset'], operation: ['deliverDataset'], deliveryType: ['snowflake'] } },
      },
      {
        displayName: 'File Name', name: 'fileName', type: 'string', default: '',
        displayOptions: { show: { resource: ['dataset'], operation: ['deliverDataset'] } },
      },
      {
        displayName: 'Operation Name or ID',
        name: 'operation',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getSerpOperations' },
        // Static shortcut so SERP appears in the node panel's action list; the dropdown still loads every engine
        options: SERP_ENGINE_FAMILIES,
        // n8n's review rules require this exact wording for dynamic dropdowns (options + loadOptionsMethod)
        description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
        default: 'google',
        required: true,
        noDataExpression: true,
        displayOptions: { show: { resource: ['serp'] } },
      },
      {
        displayName: 'Parameters',
        name: 'parameters',
        type: 'resourceMapper',
        default: { mappingMode: 'defineBelow', value: null },
        required: true,
        noDataExpression: true,
        displayOptions: { show: { resource: ['serp'] } },
        typeOptions: {
          loadOptionsDependsOn: ['resource', 'operation'],
          resourceMapper: SERP_RESOURCE_MAPPER_OPTIONS,
        },
      },
      {
        displayName: 'Encoded Location Name or ID',
        name: 'encodedLocationValue',
        type: 'options',
        // The option value is always an empty string and the label is the computed UULE: the
        // parameter stays unset, but the empty string matches this option, so n8n renders the
        // dynamic label in the input field (resourceMapper cannot do this).
        typeOptions: {
          loadOptionsMethod: 'getEncodedLocationOptions',
          loadOptionsDependsOn: ['operation', 'parameters.value.location'],
        },
        // n8n's review rules require this exact wording for dynamic dropdowns (options + loadOptionsMethod)
        description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
        default: '',
        noDataExpression: true,
        displayOptions: {
          show: {
            resource: ['serp'],
            operation: VISIBLE_UULE_ENGINES,
          },
        },
      },
      ...MULTI_VALUE_PROPERTIES.map((field) => ({
        displayName: field.displayName,
        name: field.name,
        type: 'multiOptions' as const,
        typeOptions: { loadOptionsMethod: field.loadOptionsMethod },
        default: [] as string[],
        displayOptions: {
          show: {
            resource: ['serp'],
            operation: [...MULTI_VALUE_ENGINES],
          },
        },
      })),
      {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        default: {},
        placeholder: 'Add Option',
        displayOptions: { show: { resource: ['serp'] } },
        options: [
          {
            displayName: 'Extra Parameters JSON',
            name: 'extraParameters',
            type: 'json',
            default: '{}',
            description: 'Additional parameters override mapped parameters, except protected engine and isjson fields',
          },
        ],
      },
    ],
  };

  methods = {
    loadOptions: {
      async getSerpOperations(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const schema = await serpSchemaRepository.getForEditor(
          () => this.helpers.httpRequest(buildSchemaRequestOptions()),
        );
        return toOperationOptions(schema);
      },
      async getMultiCountries(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        return loadMultiValueOptions(this, 'cr');
      },
      async getMultiLanguages(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        return loadMultiValueOptions(this, 'lr');
      },
      async getEncodedLocationOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const operation = this.getCurrentNodeParameter('operation');
        if (typeof operation !== 'string' || !VISIBLE_UULE_ENGINES.includes(operation)) {
          return [];
        }
        const values = recordOrEmpty(this.getCurrentNodeParameter('parameters.value'));
        const location = typeof values.location === 'string' ? values.location : '';
        const uule = encodeUuleLocation(location);
        // The option value is fixed to an empty string (the parameter stays unset) and the label
        // carries the computed UULE, so n8n renders the matched label in the input and the encoded
        // result is visible in the editor.
        return [{
          name: uule === '' ? 'No Location Selected' : uule,
          value: '',
        }];
      },
      async getDatasetOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const credentials = await this.getCredentials('thordataApi');
        return loadDatasetCatalog(this, String(credentials.datasetEndpoint));
      },
      async getDatasetPackages(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const datasetId = String(this.getCurrentNodeParameter('datasetId') ?? '');
        if (!datasetId) return [];
        const type = this.getCurrentNodeParameter('purchaseType') === 'subscription' ? 'subscription' : 'snapshot';
        const credentials = await this.getCredentials('thordataApi');
        const options = buildDatasetRequestOptions({
          baseUrl: String(credentials.datasetEndpoint),
          path: `/datasets/${encodeURIComponent(datasetId)}/capabilities`, method: 'GET',
        });
        const response = await this.helpers.httpRequestWithAuthentication.call(this, 'thordataApi', options);
        return toDatasetPackageOptions(datasetPackages(normalizeDatasetResponse(response)), type);
      },
      async getDatasetRecordOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const datasetId = String(this.getCurrentNodeParameter('datasetId') ?? '');
        if (!datasetId) return [];
        const type = this.getCurrentNodeParameter('purchaseType') === 'subscription' ? 'subscription' : 'snapshot';
        const packageId = Number(this.getCurrentNodeParameter('packageId') ?? 0);
        const credentials = await this.getCredentials('thordataApi');
        const options = buildDatasetRequestOptions({
          baseUrl: String(credentials.datasetEndpoint),
          path: `/datasets/${encodeURIComponent(datasetId)}/capabilities`, method: 'GET',
        });
        const response = await this.helpers.httpRequestWithAuthentication.call(this, 'thordataApi', options);
        return toDatasetRecordOptions(datasetPackages(normalizeDatasetResponse(response)), type, packageId);
      },
    },
    resourceMapping: {
      async getSerpParameters(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
        const schema = await serpSchemaRepository.getForEditor(
          () => this.helpers.httpRequest(buildSchemaRequestOptions()),
        );
        const operation = this.getCurrentNodeParameter('operation');
        const engine = typeof operation === 'string'
          && operation.trim() !== ''
          && schema.engines.some((candidate) => candidate.key === operation)
          ? operation
          : schema.defaultEngine;
        return toResourceMapperFields(schema, engine);
      },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    if (items.length === 0) return [[]];

    let schema: SerpSchema | undefined;

    const returnData: INodeExecutionData[] = [];
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      try {
        const resource = this.getNodeParameter('resource', itemIndex);
        if (resource === 'dataset') {
          const operation = String(this.getNodeParameter('operation', itemIndex, 'listDatasets'));
          if (operation === 'videoData') {
            returnData.push({
              json: { ...VIDEO_DATA_CONTACT },
              pairedItem: { item: itemIndex },
            });
            continue;
          }
          if (operation === 'downloadDataset') {
            returnData.push(...await executeDatasetDownload(this, itemIndex));
            continue;
          }
          const payload = await executeDatasetOperation(this, itemIndex);
          returnData.push({
            json: datasetOutput(payload),
            pairedItem: { item: itemIndex },
          });
          continue;
        }
        if (resource !== 'serp') {
          throw new NodeOperationError(
            this.getNode(),
            `Unsupported Thordata resource: ${String(resource)}`,
            { itemIndex },
          );
        }

        if (!schema) {
          schema = await serpSchemaRepository.getForExecution(
            () => this.helpers.httpRequest(buildSchemaRequestOptions()),
          );
        }

        const operationValue = this.getNodeParameter('operation', itemIndex);
        const operation = typeof operationValue === 'string'
          ? operationValue
          : String(operationValue ?? '');
        const mappedValues = recordOrEmpty(
          this.getNodeParameter('parameters.value', itemIndex, {}),
        );
        const values = { ...mappedValues };
        const nodeOptions = recordOrEmpty(
          this.getNodeParameter('options', itemIndex, {}),
        );
        const extraParameters = nodeOptions.extraParameters as ParamsJsonInput;
        const multiValues: Record<string, unknown> = {};
        for (const field of MULTI_VALUE_PROPERTIES) {
          multiValues[field.name] = this.getNodeParameter(field.name, itemIndex, []);
        }
        const credentials = await this.getCredentials('thordataApi', itemIndex);
        const endpoint = String(credentials.endpoint);
        // uule is derived from location by buildSerpParams (encodedLocationValue is display only)
        const params = buildSerpParams({
          schema,
          engine: operation,
          values,
          extraParameters,
          multiValues,
        });
        const engineSchema = findEngine(schema, operation);
        const requestOptions = buildSerpRequestOptions({ endpoint, params });
        const payload = await this.helpers.httpRequestWithAuthentication.call(
          this,
          'thordataApi',
          requestOptions,
        );
        const normalized = normalizeSerpResponse({ engineSchema, params, payload });

        returnData.push({
          json: { ...normalized } as IDataObject,
          pairedItem: { item: itemIndex },
        });
      } catch (error) {
        const shouldContinue = this.continueOnFail();
        const normalizedError = normalizeNodeError(
          this.getNode(),
          error,
          itemIndex,
          shouldContinue,
        );
        if (!shouldContinue) throw normalizedError;
        returnData.push({
          json: { error: normalizedError.message },
          error: normalizedError,
          pairedItem: { item: itemIndex },
        });
      }
    }

    return [returnData];
  }
}

function datasetOutput(payload: unknown): IDataObject {
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload as IDataObject;
  }
  return { data: payload as IDataObject };
}

function datasetOption(context: IExecuteFunctions, itemIndex: number, name: string, fallback?: unknown): unknown {
  try {
    const direct = context.getNodeParameter(name, itemIndex, undefined);
    if (direct !== undefined) return direct;
  } catch {
    // Optional operation-specific fields are absent on other Dataset operations.
  }
  const options = recordOrEmpty(context.getNodeParameter('datasetOptions', itemIndex, {}));
  return options[name] ?? fallback;
}

function parseDatasetJSON(node: INode, value: unknown, fallback: unknown): unknown {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new NodeOperationError(node, 'Dataset JSON option is invalid');
  }
}

function datasetID(context: IExecuteFunctions, itemIndex: number): string {
  const id = String(context.getNodeParameter('datasetId', itemIndex, '') || '').trim();
  if (!id) {
    throw new NodeOperationError(context.getNode(), 'Dataset is required for this operation', { itemIndex });
  }
  return id;
}

function requiredDatasetOption(context: IExecuteFunctions, itemIndex: number, name: string): string {
  const value = String(datasetOption(context, itemIndex, name, '') || '').trim();
  if (!value) {
    throw new NodeOperationError(context.getNode(), `${name} is required for this operation`, { itemIndex });
  }
  return value;
}

function datasetFilter(context: IExecuteFunctions, itemIndex: number): unknown {
  const advanced = parseDatasetJSON(context.getNode(), datasetOption(context, itemIndex, 'filter', '{}'), {});
  if (advanced && typeof advanced === 'object' && !Array.isArray(advanced) && Object.keys(advanced as Record<string, unknown>).length > 0) {
    return advanced;
  }
  const mapper = recordOrEmpty(context.getNodeParameter('filterFields', itemIndex, {}));
  const mapped = recordOrEmpty(mapper.value ?? mapper);
  const filters = Object.entries(mapped)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([field, value]) => ({ field, operator: 'equals', value }));
  return filters.length ? { operator: 'and', filters } : {};
}

async function datasetCommonBody(
  context: IExecuteFunctions, itemIndex: number, baseUrl: string, type: DatasetPurchaseType,
): Promise<Record<string, unknown>> {
  const id = datasetID(context, itemIndex);
  const options = buildDatasetRequestOptions({
    baseUrl, path: `/datasets/${encodeURIComponent(id)}/capabilities`, method: 'GET',
  });
  const response = await context.helpers.httpRequestWithAuthentication.call(context, 'thordataApi', options);
  const packages = datasetPackages(normalizeDatasetResponse(response));
  const packageId = chooseDatasetPackageId(packages, type, datasetOption(context, itemIndex, 'packageId', 0));
  const recordsLimit = chooseDatasetRecordLimit(packages, type, packageId, datasetOption(context, itemIndex, 'recordsLimit', 0));
  const body: Record<string, unknown> = {
    dataset_id: Number(id),
    records_limit: recordsLimit,
    package_id: packageId,
    filter: datasetFilter(context, itemIndex),
  };
  if (!Number.isFinite(body.dataset_id as number)) body.dataset_id = datasetID(context, itemIndex);
  return body;
}

function datasetDeliveryOrSnapshotID(context: IExecuteFunctions, itemIndex: number): string {
  // Download and deliver address the data by the delivery ID the console lists, or by the
  // snapshot's own ID; the API resolves either. The legacy snapshotId parameter is still read so
  // workflows saved before the rename keep working.
  for (const name of ['deliveryId', 'snapshotId']) {
    try {
      const explicit = String(context.getNodeParameter(name, itemIndex, '') || '').trim();
      if (explicit) return explicit;
    } catch {
      // Resolve from the previous node output when the optional field is absent.
    }
  }
  const input = recordOrEmpty(context.getInputData()[itemIndex]?.json);
  const nested = recordOrEmpty(input.data ?? input.result);
  const value = input.delivery_id ?? input.deliveryId
    ?? nested.delivery_id ?? nested.deliveryId
    ?? input.snapshot_id ?? input.snapshotId
    ?? nested.snapshot_id ?? nested.snapshotId;
  const id = String(value ?? '').trim();
  if (!id) {
    throw new NodeOperationError(context.getNode(), 'Delivery ID is required for this operation', { itemIndex });
  }
  return id;
}

function datasetDeliveryConfig(context: IExecuteFunctions, itemIndex: number, deliveryType: string): Record<string, unknown> {
  const fileName = String(datasetOption(context, itemIndex, 'fileName', '') || '');
  if (deliveryType === 's3') {
    return {
      Bucket: String(datasetOption(context, itemIndex, 'bucket', '')),
      access_key: String(datasetOption(context, itemIndex, 'awsAccessKey', '')),
      secret_key: String(datasetOption(context, itemIndex, 'awsSecretKey', '')),
      region: String(datasetOption(context, itemIndex, 'region', '') || ''),
      target_path: String(datasetOption(context, itemIndex, 'targetPath', '') || ''),
      file_name: fileName,
    };
  }
  if (deliveryType === 'snowflake') {
    return {
      account_identifier: String(datasetOption(context, itemIndex, 'accountIdentifier', '')),
      database: String(datasetOption(context, itemIndex, 'database', '')),
      role: String(datasetOption(context, itemIndex, 'role', '')),
      user: String(datasetOption(context, itemIndex, 'snowflakeUser', '')),
      pwd: String(datasetOption(context, itemIndex, 'snowflakePassword', '')),
      schema: String(datasetOption(context, itemIndex, 'schemaName', '')),
      stage: String(datasetOption(context, itemIndex, 'stage', '')),
      warehouse: String(datasetOption(context, itemIndex, 'warehouse', '')),
      file_name: fileName,
    };
  }
  throw new NodeOperationError(context.getNode(), `Unsupported Dataset delivery type: ${deliveryType}`, { itemIndex });
}

async function executeDatasetOperation(context: IExecuteFunctions, itemIndex: number): Promise<unknown> {
  const operation = String(context.getNodeParameter('operation', itemIndex, 'listDatasets'));
  const credentials = await context.getCredentials('thordataApi', itemIndex);
  const baseUrl = String(credentials.datasetEndpoint || '').trim();
  const snapshotID = () => datasetDeliveryOrSnapshotID(context, itemIndex);
  const subscriptionID = () => requiredDatasetOption(context, itemIndex, 'subscriptionId');
  const deliveryID = () => requiredDatasetOption(context, itemIndex, 'deliveryId');
  let path = '/datasets';
  let method: 'GET' | 'POST' = 'GET';
  let body: unknown;
  let query: Record<string, string | number | boolean | undefined> | undefined;
  let idempotencyKey: string | undefined;
  let resolvedSnapshotId: string | undefined;

  switch (operation) {
    case 'listDatasets':
      query = { q: String(datasetOption(context, itemIndex, 'keyword', '') || '') || undefined };
      break;
    case 'getDataset':
      path = `/datasets/${encodeURIComponent(datasetID(context, itemIndex))}`;
      break;
    case 'getDatasetSchema':
      path = `/datasets/${encodeURIComponent(datasetID(context, itemIndex))}/schema`;
      break;
    case 'purchaseDataset': {
      const purchaseType = String(context.getNodeParameter('purchaseType', itemIndex, 'snapshot'));
      const format = String(datasetOption(context, itemIndex, 'format', 'csv.gz'));
      const quoteId = String(datasetOption(context, itemIndex, 'quoteId', '') || '') || undefined;
      method = 'POST';
      idempotencyKey = String(datasetOption(context, itemIndex, 'idempotencyKey', '') || '')
        || createDatasetIdempotencyKey(purchaseType);
      if (purchaseType === 'subscription') {
        path = '/dataset-subscriptions';
        body = {
          ...await datasetCommonBody(context, itemIndex, baseUrl, 'subscription'),
          billing_mode: 'wallet_recurring',
          format: 'csv.gz',
          batch_size: 1000,
          quote_id: quoteId,
        };
      } else if (purchaseType === 'snapshot') {
        path = '/dataset-snapshots';
        body = { ...await datasetCommonBody(context, itemIndex, baseUrl, 'snapshot'), format, quote_id: quoteId };
      } else {
        throw new NodeOperationError(context.getNode(), `Unsupported Dataset purchase type: ${purchaseType}`, { itemIndex });
      }
      break;
    }
    case 'deliverDataset': {
      const readySnapshotId = snapshotID();
      resolvedSnapshotId = readySnapshotId;
      await requireDatasetSnapshotReady(context, baseUrl, readySnapshotId);
      path = `/dataset-snapshots/${encodeURIComponent(readySnapshotId)}/deliver`;
      method = 'POST';
      const deliveryType = String(datasetOption(context, itemIndex, 'deliveryType', 's3'));
      body = {
        type: deliveryType,
        format: String(datasetOption(context, itemIndex, 'format', 'csv.gz')),
        config: datasetDeliveryConfig(context, itemIndex, deliveryType),
      };
      idempotencyKey = createDatasetIdempotencyKey('delivery');
      break;
    }
    case 'estimateSnapshot':
      path = '/dataset-snapshots/estimate'; method = 'POST'; body = await datasetCommonBody(context, itemIndex, baseUrl, 'snapshot'); break;
    case 'createSnapshot':
      path = '/dataset-snapshots'; method = 'POST';
      body = { ...await datasetCommonBody(context, itemIndex, baseUrl, 'snapshot'), format: String(datasetOption(context, itemIndex, 'format', 'csv.gz')), quote_id: String(datasetOption(context, itemIndex, 'quoteId', '') || '') || undefined };
      idempotencyKey = String(datasetOption(context, itemIndex, 'idempotencyKey', '') || '') || createDatasetIdempotencyKey('snapshot');
      break;
    case 'getSnapshot':
      path = `/dataset-snapshots/${encodeURIComponent(snapshotID())}`; break;
    case 'waitSnapshot':
      path = `/dataset-snapshots/${encodeURIComponent(snapshotID())}/wait`; method = 'POST';
      query = { timeout: Number(datasetOption(context, itemIndex, 'waitTimeout', 120)), poll_interval: Number(datasetOption(context, itemIndex, 'pollInterval', 3)) };
      break;
    case 'downloadSnapshot':
      path = `/dataset-snapshots/${encodeURIComponent(snapshotID())}/download`;
      query = { format: String(datasetOption(context, itemIndex, 'format', 'csv.gz')) }; break;
    case 'deliverSnapshot':
      path = `/dataset-snapshots/${encodeURIComponent(snapshotID())}/deliver`; method = 'POST';
      body = { type: String(datasetOption(context, itemIndex, 'deliveryType', 'download')), format: String(datasetOption(context, itemIndex, 'format', 'csv.gz')), config: parseDatasetJSON(context.getNode(), datasetOption(context, itemIndex, 'deliveryConfig', '{}'), {}) };
      idempotencyKey = String(datasetOption(context, itemIndex, 'idempotencyKey', '') || '') || createDatasetIdempotencyKey('delivery'); break;
    case 'getDeliveryStatus':
      path = `/dataset-snapshots/${encodeURIComponent(snapshotID())}/delivery/${encodeURIComponent(deliveryID())}`; break;
    case 'estimateSubscription':
      path = '/dataset-subscriptions/estimate'; method = 'POST'; body = await datasetCommonBody(context, itemIndex, baseUrl, 'subscription'); break;
    case 'createSubscription':
      path = '/dataset-subscriptions'; method = 'POST';
      body = { ...await datasetCommonBody(context, itemIndex, baseUrl, 'subscription'), billing_mode: String(datasetOption(context, itemIndex, 'billingMode', 'wallet_recurring')), format: String(datasetOption(context, itemIndex, 'format', 'csv.gz')), batch_size: Number(datasetOption(context, itemIndex, 'batchSize', 1000)), quote_id: String(datasetOption(context, itemIndex, 'quoteId', '') || '') || undefined, delivery: { type: String(datasetOption(context, itemIndex, 'deliveryType', 'download')), format: String(datasetOption(context, itemIndex, 'format', 'csv.gz')), config: parseDatasetJSON(context.getNode(), datasetOption(context, itemIndex, 'deliveryConfig', '{}'), {}) } };
      idempotencyKey = String(datasetOption(context, itemIndex, 'idempotencyKey', '') || '') || createDatasetIdempotencyKey('subscription'); break;
    case 'getSubscription':
      path = `/dataset-subscriptions/${encodeURIComponent(subscriptionID())}`; break;
    case 'listSubscriptionRuns':
      path = `/dataset-subscriptions/${encodeURIComponent(subscriptionID())}/runs`; break;
    case 'pauseSubscription':
    case 'resumeSubscription':
    case 'cancelSubscription':
    case 'retrySubscription':
      path = `/dataset-subscriptions/${encodeURIComponent(subscriptionID())}/${operation === 'retrySubscription' ? 'retry' : operation.replace('Subscription', '').toLowerCase()}`;
      method = 'POST'; idempotencyKey = String(datasetOption(context, itemIndex, 'idempotencyKey', '') || '') || createDatasetIdempotencyKey(operation); break;
    default:
      throw new NodeOperationError(context.getNode(), `Unsupported Dataset operation: ${operation}`, { itemIndex });
  }

  const options = buildDatasetRequestOptions({ baseUrl, path, method, body, query, idempotencyKey });
  const response = await context.helpers.httpRequestWithAuthentication.call(context, 'thordataApi', options);
  const normalized = normalizeDatasetResponse(response);
  if (resolvedSnapshotId && normalized !== null && typeof normalized === 'object' && !Array.isArray(normalized)) {
    // Echo the id the node addressed so a following node can chain on it; a record's own
    // delivery_id always wins over the echo.
    const merged = { ...(normalized as Record<string, unknown>) };
    if (merged.delivery_id === undefined) merged.delivery_id = resolvedSnapshotId;
    return merged;
  }
  return normalized;
}

async function executeDatasetDownload(
  context: IExecuteFunctions,
  itemIndex: number,
): Promise<INodeExecutionData[]> {
  const credentials = await context.getCredentials('thordataApi', itemIndex);
  const baseUrl = String(credentials.datasetEndpoint || '').trim();
  const snapshotId = datasetDeliveryOrSnapshotID(context, itemIndex);
  const format = String(datasetOption(context, itemIndex, 'format', 'csv.gz')).trim().toLowerCase();

  await requireDatasetSnapshotReady(context, baseUrl, snapshotId);
  const options = buildDatasetRequestOptions({
    baseUrl,
    path: `/dataset-snapshots/${encodeURIComponent(snapshotId)}/download`,
    method: 'GET',
    query: { format },
  });
  const response = await context.helpers.httpRequestWithAuthentication.call(
    context,
    'thordataApi',
    options,
  );
  const urls = matchingDatasetDownloadUrls(context.getNode(), normalizeDatasetResponse(response), format);
  const downloadMode = String(datasetOption(context, itemIndex, 'downloadMode', 'links'));
  if (downloadMode === 'links') {
    return [await datasetDownloadLinksItem(context, itemIndex, snapshotId, format, urls)];
  }
  if (downloadMode !== 'binary') {
    throw new NodeOperationError(context.getNode(), `Unsupported Dataset download mode: ${downloadMode}`, { itemIndex });
  }
  const outputs: INodeExecutionData[] = [];

  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];
    const fileName = datasetDownloadFileName(url, snapshotId, format, index + 1);
    let responseBody: unknown;
    try {
      responseBody = await context.helpers.httpRequest({
        method: 'GET',
        url,
        encoding: 'arraybuffer',
      });
    } catch (error) {
      // The file comes straight from the signed URL, so report a failed fetch as an API error.
      throw new NodeApiError(context.getNode(), error as JsonObject, { itemIndex });
    }
    const binaryData = await context.helpers.prepareBinaryData(
      datasetDownloadBuffer(context.getNode(), responseBody),
      fileName,
      datasetDownloadMimeType(format),
    );
    outputs.push({
      json: {
        delivery_id: snapshotId,
        format,
        part: index + 1,
        file_name: fileName,
      },
      binary: { data: binaryData },
      pairedItem: { item: itemIndex },
    });
  }

  return outputs;
}

async function datasetDownloadLinksItem(
  context: IExecuteFunctions,
  itemIndex: number,
  snapshotId: string,
  format: string,
  urls: readonly string[],
): Promise<INodeExecutionData> {
  const pageFileName = `${safeDatasetDownloadName(snapshotId)}_${safeDatasetDownloadName(format)}_download-links.html`;
  const page = datasetDownloadLinksHtml(urls, snapshotId, format);
  const binaryData = await context.helpers.prepareBinaryData(
    Buffer.from(page, 'utf8'),
    pageFileName,
    'text/html',
  );
  return {
    json: {
      delivery_id: snapshotId,
      format,
      file_count: urls.length,
      urls: [...urls],
    },
    binary: { download_page: binaryData },
    pairedItem: { item: itemIndex },
  };
}

function datasetDownloadLinksHtml(
  urls: readonly string[],
  snapshotId: string,
  format: string,
): string {
  const links = urls.map((url, index) => {
    const fileName = datasetDownloadFileName(url, snapshotId, format, index + 1);
    return `<li><a href="${escapeDatasetDownloadHtml(url)}" target="_blank" rel="noopener noreferrer" download="${escapeDatasetDownloadHtml(fileName)}">Download ${escapeDatasetDownloadHtml(fileName)}</a></li>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dataset downloads</title></head><body><main><h1>Dataset downloads</h1><p>${escapeDatasetDownloadHtml(snapshotId)} (${escapeDatasetDownloadHtml(format)})</p><ol>${links}</ol></main></body></html>`;
}

function escapeDatasetDownloadHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

function safeDatasetDownloadName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/gu, '_');
}

function matchingDatasetDownloadUrls(node: INode, payload: unknown, format: string): string[] {
  const record = recordOrEmpty(payload);
  const urls = Array.isArray(record.urls) ? record.urls : [];
  const suffix = `.${format}`;
  const matching = urls.filter((value): value is string => {
    if (typeof value !== 'string' || value.trim() === '') return false;
    try {
      return new URL(value).pathname.toLowerCase().endsWith(suffix);
    } catch {
      return false;
    }
  });
  if (matching.length === 0) {
    throw new NodeOperationError(node, `Dataset download returned no ${format} files`);
  }
  return matching;
}

function datasetDownloadFileName(
  url: string,
  snapshotId: string,
  format: string,
  part: number,
): string {
  const encodedName = new URL(url).pathname.split('/').pop();
  if (encodedName) {
    try {
      const decodedName = decodeURIComponent(encodedName);
      if (decodedName.trim()) return decodedName;
    } catch {
      // Fall back to a deterministic file name when the URL path is malformed.
    }
  }
  return `${snapshotId}_${part}.${format}`;
}

function datasetDownloadBuffer(node: INode, payload: unknown): Buffer {
  if (Buffer.isBuffer(payload)) return payload;
  if (payload instanceof ArrayBuffer) return Buffer.from(payload);
  if (ArrayBuffer.isView(payload)) {
    return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  }
  throw new NodeOperationError(node, 'Dataset file response is not binary data');
}

function datasetDownloadMimeType(format: string): string {
  if (format.endsWith('.gz')) return 'application/gzip';
  if (format === 'csv') return 'text/csv';
  if (format === 'ndjson') return 'application/x-ndjson';
  if (format === 'json') return 'application/json';
  return 'application/octet-stream';
}

async function requireDatasetSnapshotReady(
  context: IExecuteFunctions,
  baseUrl: string,
  snapshotId: string,
): Promise<void> {
  const options = buildDatasetRequestOptions({
    baseUrl,
    path: `/dataset-snapshots/${encodeURIComponent(snapshotId)}`,
    method: 'GET',
  });
  const response = await context.helpers.httpRequestWithAuthentication.call(
    context,
    'thordataApi',
    options,
  );
  assertDatasetSnapshotReady(normalizeDatasetResponse(response));
}
