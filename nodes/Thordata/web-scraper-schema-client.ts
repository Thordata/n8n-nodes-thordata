import type { ILoadOptionsFunctions, INodePropertyOptions, ResourceMapperFields } from 'n8n-workflow';
import { THORDATA_WEB_SCRAPER_SCHEMA_BASE_URL } from '../../endpoints';
import bundled from './web-scraper-schema.snapshot.json';
import { assertWebScraperProduct, normalizeWebScraperOperations, normalizeWebScraperSchema, WEB_SCRAPER_PRODUCTS, webScraperMapperFields, type WebScraperSchema } from './web-scraper-schema';
import { isRecord, parseJsonValue, WebScraperError } from './web-scraper-result';
export { WEB_SCRAPER_OPERATIONS } from './web-scraper-schema';

export interface WebScraperSnapshot { operations: unknown; parameters: Record<string, unknown> }
export const WEB_SCRAPER_SNAPSHOT: WebScraperSnapshot = bundled;
type Fetcher = (url: string) => Promise<unknown>;

function publicResponse(value: unknown): unknown {
  const response = parseJsonValue(value);
  if (isRecord(response) && typeof response.code === 'number' && (response.code === 408 || response.code === 429 || response.code >= 500 && response.code < 600)) throw { statusCode: response.code };
  return response;
}

function temporary(error: unknown): boolean {
  if (error instanceof WebScraperError) return false;
  const source = error as { httpCode?: unknown; statusCode?: unknown; status?: unknown; code?: unknown; response?: { status?: unknown; statusCode?: unknown }; cause?: { code?: unknown } } | null;
  const status = Number(source?.statusCode ?? source?.status ?? source?.httpCode ?? source?.response?.status ?? source?.response?.statusCode);
  if (status) return status === 408 || status === 429 || status >= 500 && status < 600;
  return ['ECONNABORTED', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(String(source?.code ?? source?.cause?.code));
}

export class WebScraperSchemaRepository {
  private readonly cache = new Map<string, { schema: WebScraperSchema; time: number; revision: number }>();
  private readonly lastSuccess = new Map<string, WebScraperSchema>();
  private readonly inFlight = new Map<string, Promise<WebScraperSchema>>();
  private readonly unavailable = new Map<string, WebScraperError>();
  private catalog?: INodePropertyOptions[];
  private sequence = 0;
  private catalogRevision = 0;
  private readonly revisions = new Map<string, number>();

  constructor(private readonly baseUrl: string, private readonly snapshot: WebScraperSnapshot = WEB_SCRAPER_SNAPSHOT, private readonly now: () => number = Date.now) {}

  async get(id: string, fetcher: Fetcher, editor = false): Promise<WebScraperSchema> {
    assertWebScraperProduct(id);
    const cached = this.cache.get(id);
    if (!editor && cached && this.now() - cached.time < 300_000) return cached.schema;
    if (!editor && this.inFlight.has(id)) return this.inFlight.get(id)!;
    const revision = ++this.sequence;
    this.revisions.set(id, revision);
    const refresh = this.refresh(id, fetcher, revision);
    if (editor) return refresh;
    this.inFlight.set(id, refresh);
    try { return await refresh; } finally { this.inFlight.delete(id); }
  }

  private async refresh(id: string, fetcher: Fetcher, revision: number): Promise<WebScraperSchema> {
    try {
      const operations = this.applyOperations(publicResponse(await fetcher(`${this.baseUrl}/operations`)), revision);
      if (this.revisions.get(id) !== revision) return this.latest(id);
      if (!operations.some(option => option.value === id)) throw new WebScraperError('product_unavailable', 'schema', undefined, id);
      const schema = normalizeWebScraperSchema(publicResponse(await fetcher(`${this.baseUrl}/parameters?spider_id=${encodeURIComponent(id)}`)), id);
      if (this.revisions.get(id) !== revision) return this.latest(id);
      if (this.catalog && !this.catalog.some(option => option.value === id)) throw new WebScraperError('product_unavailable', 'schema', undefined, id);
      this.unavailable.delete(id);
      this.lastSuccess.set(id, schema);
      this.cache.set(id, { schema, time: this.now(), revision });
      return schema;
    } catch (error) {
      if (this.revisions.get(id) !== revision) return this.latest(id);
      if (!temporary(error)) {
        this.cache.delete(id);
        this.lastSuccess.delete(id);
        const safe = new WebScraperError(error instanceof WebScraperError ? error.error_code : 'schema_unavailable', 'schema', undefined, id);
        this.unavailable.set(id, safe);
        throw safe;
      }
      if (this.unavailable.has(id)) throw this.unavailable.get(id);
      const previous = this.lastSuccess.get(id);
      if (previous) return previous;
      normalizeWebScraperOperations(this.snapshot.operations);
      return normalizeWebScraperSchema(this.snapshot.parameters[id], id);
    }
  }

  async operations(fetcher: Fetcher): Promise<INodePropertyOptions[]> {
    const revision = ++this.sequence;
    try { return this.applyOperations(publicResponse(await fetcher(`${this.baseUrl}/operations`)), revision); }
    catch (error) {
      if (revision < this.catalogRevision && this.catalog) return this.catalog;
      if (!temporary(error)) throw error instanceof WebScraperError ? error : new WebScraperError('schema_unavailable', 'schema');
      return this.catalog ?? normalizeWebScraperOperations(this.snapshot.operations);
    }
  }

  private latest(id: string): WebScraperSchema {
    const unavailable = this.unavailable.get(id);
    if (unavailable) throw unavailable;
    const cached = this.cache.get(id);
    if (cached && cached.revision === this.revisions.get(id)) return cached.schema;
    throw new WebScraperError('schema_unavailable', 'schema', undefined, id);
  }

  private applyOperations(payload: unknown, revision: number): INodePropertyOptions[] {
    if (revision < this.catalogRevision && this.catalog) return this.catalog;
    const operations = normalizeWebScraperOperations(payload);
    this.catalogRevision = revision;
    this.catalog = operations;
    for (const product of WEB_SCRAPER_PRODUCTS) {
      if (!operations.some(option => option.value === product.id)) {
        if ((this.revisions.get(product.id) ?? 0) > revision) continue;
        this.revisions.set(product.id, revision);
        this.cache.delete(product.id);
        this.lastSuccess.delete(product.id);
        this.unavailable.set(product.id, new WebScraperError('product_unavailable', 'schema', undefined, product.id));
      }
    }
    return operations;
  }
}

export const webScraperSchemaRepository = new WebScraperSchemaRepository(THORDATA_WEB_SCRAPER_SCHEMA_BASE_URL);
export function schemaFetcher(context: Pick<ILoadOptionsFunctions, 'helpers'>): Fetcher {
  return async url => {
    return context.helpers.httpRequest({ method: 'GET', url, json: true, timeout: 5_000, disableFollowRedirect: true });
  };
}
export async function getWebScraperOperations(context: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
  return webScraperSchemaRepository.operations(schemaFetcher(context));
}
export async function getWebScraperFields(context: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
  const selected = context.getCurrentNodeParameter('operation');
  const id = WEB_SCRAPER_PRODUCTS.find(product => product.id === selected)?.id ?? WEB_SCRAPER_PRODUCTS[0].id;
  return webScraperMapperFields(await webScraperSchemaRepository.get(id, schemaFetcher(context), true));
}
