// This package talks only to Thordata's own two service endpoints, so the URLs are compile-time
// constants rather than credential fields: n8n's review rules do not allow a node to become a
// generic proxy that can be pointed at arbitrary hosts.
export const THORDATA_SERP_ENDPOINT = 'https://scraperapi.thordata.com/request';
export const THORDATA_DATASET_API_BASE_URL = 'https://api.thordata.com/api/n8n';
