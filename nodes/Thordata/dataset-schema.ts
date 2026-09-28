import type { INodePropertyOptions, ResourceMapperFields } from 'n8n-workflow';

export interface DatasetCatalogItem {
  readonly dataset_id: string;
  readonly name: string;
  readonly domain?: string;
  readonly total_records?: number;
  readonly refresh_rate?: string;
  readonly field_num?: number;
  readonly dataset_version?: string;
  readonly purchase_supported?: boolean;
}

export interface DatasetSchemaField {
  readonly key: string;
  readonly label?: string;
  readonly description?: string;
  readonly type?: string;
  readonly filterable?: boolean;
  readonly operators?: string[];
}

export interface DatasetSchema {
  readonly dataset_id: string;
  readonly version?: string;
  readonly fields: DatasetSchemaField[];
}

export function toDatasetOptions(items: unknown): INodePropertyOptions[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is DatasetCatalogItem => item !== null && typeof item === 'object' && typeof (item as DatasetCatalogItem).dataset_id === 'string' && (item as DatasetCatalogItem).purchase_supported !== false)
    .map((item) => ({ name: item.name ? `${item.name} (${item.dataset_id})` : item.dataset_id, value: item.dataset_id, description: item.domain }));
}

export function toDatasetFilterMapperFields(schema: DatasetSchema): ResourceMapperFields {
  const fields = schema.fields
    .filter((field) => field.filterable !== false && field.key)
    .map((field) => ({
      id: field.key,
      displayName: field.label || field.key,
      defaultMatch: false,
      canBeUsedToMatch: false,
      required: false,
      display: true,
      type: mapFieldType(field.type),
      description: field.description,
    }));
  return { fields };
}

function mapFieldType(type: string | undefined): 'string' | 'number' | 'boolean' | 'dateTime' {
  switch (type) {
    case 'number':
    case 'boolean':
    case 'dateTime':
      return type;
    default:
      return 'string';
  }
}
