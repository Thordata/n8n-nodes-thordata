import { BUNDLED_SERP_SCHEMA } from './schema-snapshot';
import {
  SerpSchemaValidationError,
  normalizeSerpSchema,
  type SerpSchema,
} from './schema';

export const SERP_SCHEMA_URL = 'https://api.thordata.com/serp/playground/schema?lang=en';
export const SERP_SCHEMA_TIMEOUT_MS = 5_000;
export const SERP_SCHEMA_CACHE_TTL_MS = 300_000;

export type SerpSchemaFetcher = () => Promise<unknown>;

export function buildSchemaRequestOptions(): {
  method: 'GET';
  url: string;
  json: true;
  timeout: number;
} {
  return {
    method: 'GET',
    url: SERP_SCHEMA_URL,
    json: true,
    timeout: SERP_SCHEMA_TIMEOUT_MS,
  };
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const clone: Record<string, unknown> = {};
    Object.keys(value).forEach((key) => {
      clone[key] = cloneValue((value as Record<string, unknown>)[key]);
    });
    return clone as T;
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach((entry) => deepFreeze(entry));
    Object.freeze(value);
  }
  return value;
}

function cloneAndFreeze(schema: SerpSchema): SerpSchema {
  return deepFreeze(cloneValue(schema));
}

// This module deliberately has no n8n runtime dependency so it stays unit-testable: non-validation
// errors are re-thrown as-is and execute() wraps them as NodeOperationError via normalizeNodeError.
function rethrow(error: unknown): never {
  throw error;
}

interface ExecutionCache {
  readonly schema: SerpSchema;
  readonly fetchedAt: number;
}

export class SerpSchemaRepository {
  private readonly snapshot: SerpSchema;

  private lastSuccess?: SerpSchema;

  private executionCache?: ExecutionCache;

  private executionRefresh?: Promise<SerpSchema>;

  private executionRefreshId = 0;

  constructor(snapshot: SerpSchema) {
    this.snapshot = cloneAndFreeze(snapshot);
  }

  async getForEditor(fetcher: SerpSchemaFetcher): Promise<SerpSchema> {
    const schema = await this.fetchAndNormalize(fetcher);
    if (schema) {
      this.lastSuccess = schema;
      return schema;
    }
    return this.lastSuccess ?? this.snapshot;
  }

  getForExecution(fetcher: SerpSchemaFetcher, now = Date.now()): Promise<SerpSchema> {
    if (this.executionRefresh) return this.executionRefresh;
    if (this.executionCache) {
      const elapsed = now - this.executionCache.fetchedAt;
      if (elapsed >= 0 && elapsed < SERP_SCHEMA_CACHE_TTL_MS) {
        return Promise.resolve(this.executionCache.schema);
      }
    }

    // An incrementing token decides whether the cleanup in finally belongs to this refresh:
    // referencing the task itself trips TypeScript's "used before assigned" check.
    const refreshId = (this.executionRefreshId += 1);
    const task = (async () => {
      try {
        const schema = await this.fetchAndNormalize(fetcher);
        if (schema) {
          this.lastSuccess = schema;
          this.executionCache = { schema, fetchedAt: now };
          return schema;
        }
        return this.lastSuccess ?? this.snapshot;
      } finally {
        if (this.executionRefreshId === refreshId) this.executionRefresh = undefined;
      }
    })();
    this.executionRefresh = task;
    return task;
  }

  private async fetchAndNormalize(fetcher: SerpSchemaFetcher): Promise<SerpSchema | undefined> {
    let payload: unknown;
    try {
      payload = await fetcher();
    } catch {
      return undefined;
    }

    try {
      return normalizeSerpSchema(payload);
    } catch (error) {
      if (error instanceof SerpSchemaValidationError) return undefined;
      rethrow(error);
    }
  }
}

export const serpSchemaRepository = new SerpSchemaRepository(BUNDLED_SERP_SCHEMA);
