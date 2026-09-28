import { randomUUID } from 'crypto';

export type DatasetHttpMethod = 'GET' | 'POST';

export interface DatasetRequestOptions {
  readonly method: DatasetHttpMethod;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly qs?: Record<string, string | number | boolean>;
  readonly json: true;
  readonly timeout: number;
}

export interface BuildDatasetRequestOptionsInput {
  readonly baseUrl: string;
  readonly path: string;
  readonly method: DatasetHttpMethod;
  readonly body?: unknown;
  readonly query?: Record<string, string | number | boolean | undefined>;
  readonly idempotencyKey?: string;
}

export function buildDatasetRequestOptions(input: BuildDatasetRequestOptionsInput): DatasetRequestOptions {
  const baseUrl = input.baseUrl.trim().replace(/\/$/u, '');
  const path = `/${input.path.replace(/^\/+|\/+$/gu, '')}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Origin: 'n8n',
    platform: 'n8n',
    'api-source': 'sdk',
  };
  if (input.idempotencyKey?.trim()) headers['Idempotency-Key'] = input.idempotencyKey.trim();
  const query = Object.fromEntries(
    Object.entries(input.query ?? {}).filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined),
  );
  return {
    method: input.method,
    url: `${baseUrl}${path}`,
    headers,
    ...(input.method === 'POST' && input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
    ...(Object.keys(query).length ? { qs: query } : {}),
    json: true,
    timeout: 120_000,
  };
}

export function createDatasetIdempotencyKey(scope: string): string {
  return `n8n-${scope}-${randomUUID()}`;
}

export function normalizeDatasetResponse(payload: unknown): unknown {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const response = payload as Record<string, unknown>;
  if (response.code === 0 || response.code === 200) return response.data;
  const message = typeof response.message === 'string'
    ? response.message
    : typeof response.msg === 'string' ? response.msg : 'Dataset request failed';
  throw new Error(message);
}

export function assertDatasetSnapshotReady(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Dataset snapshot status response is invalid');
  }
  const snapshot = payload as Record<string, unknown>;
  if (snapshot.status === 'ready') return snapshot;
  if (snapshot.status === 'failed') {
    const message = typeof snapshot.error_message === 'string' && snapshot.error_message.trim()
      ? snapshot.error_message
      : 'Dataset snapshot failed';
    throw new Error(message);
  }
  throw new Error('Dataset is still being prepared. Please try again later.');
}

// The caller supplies the wait so this module stays free of runtime globals: n8n forbids
// setTimeout inside community nodes and expects the node to pass the platform's sleep helper.
export async function pollDatasetSnapshotUntilReady(
  requestSnapshot: () => Promise<unknown>,
  timeoutSeconds: number,
  pollIntervalSeconds: number,
  sleep: (milliseconds: number) => Promise<unknown>,
): Promise<void> {
  const interval = Number.isFinite(pollIntervalSeconds) && pollIntervalSeconds > 0 ? pollIntervalSeconds : 3;
  const timeout = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds : 120;
  const attempts = Math.max(1, Math.ceil(timeout / interval));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const snapshot = await requestSnapshot();
    const status = snapshot !== null && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? (snapshot as Record<string, unknown>).status : undefined;
    if (status === 'ready' || status === 'failed' || attempt === attempts - 1) {
      assertDatasetSnapshotReady(snapshot);
      return;
    }
    await sleep(interval * 1000);
  }
}
