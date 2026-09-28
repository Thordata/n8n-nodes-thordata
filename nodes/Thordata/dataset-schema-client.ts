import type { ILoadOptionsFunctions, INodePropertyOptions, ResourceMapperFields } from 'n8n-workflow';
import { buildDatasetRequestOptions } from './dataset-request';
import { toDatasetFilterMapperFields, toDatasetOptions, type DatasetSchema } from './dataset-schema';

export const DATASET_SCHEMA_TIMEOUT_MS = 5_000;
export const DATASET_SCHEMA_CACHE_TTL_MS = 300_000;

function unwrap(payload: unknown): unknown {
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const response = payload as Record<string, unknown>;
    if (response.code === 0 || response.code === 200) return response.data;
  }
  return payload;
}

export async function loadDatasetCatalog(context: ILoadOptionsFunctions, baseUrl: string): Promise<INodePropertyOptions[]> {
  const options = buildDatasetRequestOptions({ baseUrl, path: '/datasets', method: 'GET' });
  const payload = await context.helpers.httpRequestWithAuthentication.call(context, 'thordataApi', options);
  return toDatasetOptions(unwrap(payload));
}

export async function loadDatasetSchema(context: ILoadOptionsFunctions, baseUrl: string, datasetId: string): Promise<DatasetSchema> {
  if (!datasetId) return { dataset_id: '', fields: [] };
  const options = buildDatasetRequestOptions({ baseUrl, path: `/datasets/${encodeURIComponent(datasetId)}/schema`, method: 'GET' });
  const payload = await context.helpers.httpRequestWithAuthentication.call(context, 'thordataApi', options);
  const value = unwrap(payload);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid dataset schema response');
  const schema = value as DatasetSchema;
  return { dataset_id: String(schema.dataset_id || datasetId), version: schema.version, fields: Array.isArray(schema.fields) ? schema.fields : [] };
}

export async function loadDatasetFilterFields(context: ILoadOptionsFunctions, baseUrl: string, datasetId: string): Promise<ResourceMapperFields> {
  return toDatasetFilterMapperFields(await loadDatasetSchema(context, baseUrl, datasetId));
}
