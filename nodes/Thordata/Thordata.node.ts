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

// n8n's resourceMapper cannot store arrays (the editor writes null for any value that is not a
// string, number or boolean), so multi-value fields have to be top-level multiOptions properties;
// their options are still loaded dynamically from the backend schema.
// Only google_web currently exposes visible multi-value fields (cr / lr).
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
        options: [{ name: 'SERP API', value: 'serp' }],
        default: 'serp',
        required: true,
        noDataExpression: true,
      },
      {
        displayName: 'Operation Name or ID',
        name: 'operation',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getSerpOperations' },
        // n8n's guidelines require this standard wording for dynamic dropdowns
        // (options + loadOptionsMethod)
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
        // The option value is always an empty string and the label is the computed UULE: the parameter
        // stays unset, yet the empty string still matches this option, so n8n renders the dynamic
        // label in the input field (resourceMapper cannot do this).
        typeOptions: {
          loadOptionsMethod: 'getEncodedLocationOptions',
          loadOptionsDependsOn: ['operation', 'parameters.value.location'],
        },
        // n8n's guidelines require this standard wording for dynamic dropdowns
        // (options + loadOptionsMethod)
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
        // The option value is always an empty string (the parameter stays unset); the label is the
        // computed UULE, and n8n renders the matched option's label in the input field so the encoded
        // result is visible directly in the UI.
        return [{
          name: uule === '' ? 'No Location Selected' : uule,
          value: '',
        }];
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

    let schema: SerpSchema;
    try {
      schema = await serpSchemaRepository.getForExecution(
        () => this.helpers.httpRequest(buildSchemaRequestOptions()),
      );
    } catch (error) {
      throw normalizeNodeError(this.getNode(), error);
    }

    const returnData: INodeExecutionData[] = [];
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      try {
        const resource = this.getNodeParameter('resource', itemIndex);
        if (resource !== 'serp') {
          throw new NodeOperationError(
            this.getNode(),
            `Unsupported Thordata resource: ${String(resource)}`,
            { itemIndex },
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
        // uule is derived from location automatically by buildSerpParams; encodedLocationValue is
        // display-only.
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
