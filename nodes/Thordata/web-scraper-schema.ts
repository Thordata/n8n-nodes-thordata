import type { INodePropertyOptions, ResourceMapperFields } from 'n8n-workflow';
import { isRecord, parseJsonValue, WebScraperError } from './web-scraper-result';

export const WEB_SCRAPER_PRODUCTS = [
  // Names mirror the Thordata scraper store: the scraper product name plus the scraping method it
  // runs, so users can match the same action on both sides.
  // Actions of one platform stay adjacent so a platform is never split in the dropdown.
  { id: 'linkedin_company_information_by-url', domain: 'linkedin.com', name: 'LinkedIn Company Information Scraper: URL', fields: ['url'] },
  { id: 'linkedin_job_listings_information_by-job-url', domain: 'linkedin.com', name: 'LinkedIn Job Listing Scraper: Job URL', fields: ['job_url'] },
  { id: 'youtube_video-post_by-keyword', domain: 'youtube.com', name: 'YouTube Video Post Scraper: Keyword', fields: ['keyword', 'num_of_posts'] },
  { id: 'youtube_video-post_by-explore', domain: 'youtube.com', name: 'YouTube Video Post Scraper: Explore', fields: ['url', 'all_tabs'] },
  { id: 'facebook_profile_by-profiles-url', domain: 'facebook.com', name: 'Facebook Profile Scraper: Profile URL', fields: ['url'] },
  { id: 'twitter_profile_by-profileurl', domain: 'x.com', name: 'Twitter(X) Profile Scraper: Profile URL', fields: ['url'] },
  { id: 'amazon_product_by-category-url', domain: 'amazon.com', name: 'Amazon Product Details Scraper: Category URL', fields: ['url', 'page_turning', 'sort_by'] },
] as const;
export const WEB_SCRAPER_OPERATIONS: INodePropertyOptions[] = WEB_SCRAPER_PRODUCTS.map(product => ({ name: product.name, value: product.id, action: `Web Scraper: ${product.name}` }));
export interface WebScraperField {
  key: string; label: string; type: 'string' | 'number' | 'options'; required: boolean;
  options: { name: string; value: string }[];
  defaultValue?: string | number | boolean;
  description?: string;
}
export interface WebScraperSchema { spiderId: string; spiderName: string; fields: WebScraperField[] }

export function assertWebScraperProduct(id: unknown): typeof WEB_SCRAPER_PRODUCTS[number] {
  const product = WEB_SCRAPER_PRODUCTS.find(entry => entry.id === id);
  if (!product) throw new WebScraperError('invalid_parameters', 'validate');
  return product;
}
function invalid(): never { throw new WebScraperError('schema_unavailable', 'schema'); }
function strictKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).some(key => !keys.includes(key))) invalid();
}
function envelope(payload: unknown): Record<string, unknown> {
  const root = parseJsonValue(payload);
  if (!isRecord(root)) invalid();
  if (typeof root.code !== 'number' || !Number.isFinite(root.code)) invalid();
  if (root.code !== 0) throw new WebScraperError('product_unavailable', 'schema');
  const data = root.data;
  if (!isRecord(data) || data.schema_version !== '1' || data.resource !== 'web_scraper') invalid();
  return data;
}
function metadata(data: Record<string, unknown>, id: string): void {
  const product = assertWebScraperProduct(id);
  if (data.spider_id !== id || data.spider_name !== product.domain || data.product_type !== 'text' || data.execution_path !== '/builder') invalid();
  if (data.scraper_id !== undefined && (!Number.isSafeInteger(data.scraper_id) || Number(data.scraper_id) < 1)) invalid();
  if (data.product_id !== undefined && (!Number.isSafeInteger(data.product_id) || Number(data.product_id) < 1)) invalid();
}

export function normalizeWebScraperOperations(payload: unknown): INodePropertyOptions[] {
  const data = envelope(payload);
  strictKeys(data, ['schema_version', 'resource', 'operations']);
  if (!Array.isArray(data.operations)) invalid();
  const available = new Set<string>();
  for (const product of WEB_SCRAPER_PRODUCTS) {
    const matches = data.operations.filter(entry => isRecord(entry) && (entry.spider_id === product.id || entry.value === product.id));
    if (matches.length === 0) continue;
    if (matches.length !== 1 || !isRecord(matches[0])) invalid();
    const operation = matches[0];
    strictKeys(operation, ['value', 'name', 'spider_id', 'spider_name', 'scraper_id', 'product_id', 'product_type', 'execution_path']);
    if (operation.value !== product.id || typeof operation.name !== 'string' || !operation.name.trim()) invalid();
    metadata(operation, product.id);
    available.add(product.id);
  }
  return WEB_SCRAPER_OPERATIONS.filter(option => available.has(String(option.value))).map(option => ({ ...option }));
}

function normalizeSchema(payload: unknown, id: string): WebScraperSchema {
  const product = assertWebScraperProduct(id);
  const data = envelope(payload);
  strictKeys(data, ['schema_version', 'resource', 'spider_id', 'spider_name', 'scraper_id', 'product_id', 'product_type', 'execution_path', 'parameters', 'general_parameters', 'validation_rules', 'warnings']);
  metadata(data, id);
  for (const key of ['general_parameters', 'validation_rules']) if (!Array.isArray(data[key]) || data[key].length) invalid();
  if (!Array.isArray(data.warnings) || !Array.isArray(data.parameters)) invalid();
  const warnings = data.warnings;
  for (const warning of warnings) {
    if (!isRecord(warning) || warning.key !== 'num_of_posts' || warning.message !== 'invalid string default' || id !== 'youtube_video-post_by-keyword') invalid();
    strictKeys(warning, ['key', 'message']);
  }
  const seen = new Set<string>();
  const fields: WebScraperField[] = data.parameters.map(raw => {
    if (!isRecord(raw)) invalid();
    strictKeys(raw, ['key', 'label', 'type', 'control', 'required', 'default_value', 'placeholder', 'description', 'options', 'operators']);
    if (typeof raw.key !== 'string' || !(product.fields as readonly string[]).includes(raw.key) || seen.has(raw.key)) invalid();
    seen.add(raw.key);
    const key = raw.key;
    const expectedType = key === 'page_turning' ? 'number' : ['all_tabs', 'sort_by'].includes(key) ? 'options' : 'string';
    if (raw.type !== expectedType || raw.control !== ({ string: 'input', number: 'number', options: 'select' })[expectedType]) invalid();
    const required = !['all_tabs', 'sort_by', 'num_of_posts'].includes(key);
    if (raw.required !== required || typeof raw.label !== 'string' || !raw.label.trim()) invalid();
    for (const name of ['description', 'placeholder']) if (raw[name] !== undefined && typeof raw[name] !== 'string') invalid();
    if (!Array.isArray(raw.operators) || raw.operators.length || !Array.isArray(raw.options)) invalid();
    const values = new Set<string>();
    const options = raw.options.map(option => {
      if (!isRecord(option)) invalid();
      strictKeys(option, ['label', 'value']);
      if (typeof option.label !== 'string' || typeof option.value !== 'string' || !option.value || values.has(option.value)) invalid();
      values.add(option.value);
      return { name: option.label, value: option.value };
    });
    if (expectedType === 'options' ? options.length === 0 : options.length !== 0) invalid();
    const field: WebScraperField = { key, label: raw.label, type: expectedType, required, options, ...(typeof raw.description === 'string' ? { description: raw.description } : {}) };
    if (raw.default_value !== null && raw.default_value !== undefined) {
      if (key === 'num_of_posts' && warnings.some(warning => isRecord(warning) && warning.key === key)) return field;
      if (key === 'num_of_posts' && (typeof raw.default_value !== 'string' || !/^\d+$/u.test(raw.default_value) || !Number.isSafeInteger(Number(raw.default_value)) || Number(raw.default_value) < 1)) invalid();
      if (expectedType === 'options' ? !values.has(raw.default_value as string) : expectedType === 'number' ? !Number.isSafeInteger(raw.default_value) || Number(raw.default_value) < 1 : typeof raw.default_value !== 'string') invalid();
      field.defaultValue = raw.default_value as string | number;
    }
    return field;
  });
  if (product.fields.some(key => !seen.has(key))) invalid();
  return { spiderId: id, spiderName: product.domain, fields };
}

function selectedSchemaError(id: string, error: unknown): never {
  throw new WebScraperError(error instanceof WebScraperError ? error.error_code : 'schema_unavailable', 'schema', undefined, id);
}
export function normalizeWebScraperSchema(payload: unknown, id: string): WebScraperSchema {
  assertWebScraperProduct(id);
  try { return normalizeSchema(payload, id); }
  catch (error) { return selectedSchemaError(id, error); }
}

export function webScraperMapperFields(schema: WebScraperSchema): ResourceMapperFields {
  return { fields: schema.fields.map(field => ({ id: field.key, displayName: `${field.label}${field.defaultValue !== undefined ? ` (default: ${field.defaultValue})` : ''}`, required: field.required, defaultMatch: false, display: true, canBeUsedToMatch: false, type: field.type, ...(field.options.length ? { options: field.options } : {}) })) };
}

export function validateWebScraperParameters(schema: WebScraperSchema, input: unknown): Record<string, string | number | boolean> {
  assertWebScraperProduct(schema.spiderId);
  const fail = (): never => { throw new WebScraperError('invalid_parameters', 'validate', undefined, schema.spiderId); };
  if (!isRecord(input) || Object.keys(input).some(key => !schema.fields.some(field => field.key === key))) fail();
  const values: Record<string, string | number | boolean> = {};
  for (const field of schema.fields) {
    const value = Object.prototype.hasOwnProperty.call(input, field.key) ? (input as Record<string, unknown>)[field.key] : field.defaultValue;
    if (value === undefined || value === null || value === '') { if (field.required) fail(); else continue; }
    if (['page_turning', 'num_of_posts'].includes(field.key)) {
      if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d+$/u.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) fail();
      values[field.key] = field.key === 'num_of_posts' ? String(Number(value)) : Number(value);
    } else {
      if (typeof value !== 'string' || !value.trim() || (field.type === 'options' && !field.options.some(option => option.value === value))) fail();
      if (['url', 'job_url'].includes(field.key)) {
        let parsed: URL;
        try { parsed = new URL(value as string); } catch { return fail(); }
        if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || value !== (value as string).trim()) fail();
      }
      values[field.key] = value as string;
    }
  }
  return values;
}
