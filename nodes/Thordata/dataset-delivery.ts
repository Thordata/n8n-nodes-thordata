import type { INodePropertyOptions } from 'n8n-workflow';

// n8n labels node-panel actions as "<resource> <operation>", which reads as "Dataset List
// Datasets". The action field overrides that label in the node panel only; the Operation
// dropdown in the editor keeps using name.
export const DATASET_OPERATIONS: INodePropertyOptions[] = [
  { name: 'List Datasets', value: 'listDatasets', action: 'Dataset: List Datasets' },
  { name: 'Purchase Dataset', value: 'purchaseDataset', action: 'Dataset: Purchase Dataset' },
  { name: 'Download Dataset', value: 'downloadDataset', action: 'Dataset: Download Dataset' },
  { name: 'Deliver Dataset', value: 'deliverDataset', action: 'Dataset: Deliver Dataset' },
  { name: 'Video Data', value: 'videoData', action: 'Dataset: Video Data' },
];

export const VIDEO_DATA_CONTACT = {
  name: 'Video Data',
  contact_us: 'Contact Us',
  email: 'support@thordata.com',
  website: 'thordata.com',
  website_url: 'https://www.thordata.com/?ls=video&lk=video',
  purchase_supported: false,
} as const;

export const DATASET_PURCHASE_TYPES: INodePropertyOptions[] = [
  { name: 'One-Time Snapshot', value: 'snapshot' },
  { name: 'Wallet Subscription', value: 'subscription' },
];

export const DATASET_FORMATS: INodePropertyOptions[] = [
  'csv', 'json', 'ndjson', 'csv.gz', 'json.gz', 'ndjson.gz',
].map((value) => ({ name: value, value }));

export const DATASET_DELIVERY_TYPES: INodePropertyOptions[] = [
  { name: 'Amazon S3', value: 's3' },
  { name: 'Snowflake', value: 'snowflake' },
];
