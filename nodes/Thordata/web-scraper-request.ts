import type { IHttpRequestOptions } from 'n8n-workflow';
import { THORDATA_WEB_SCRAPER_DOWNLOAD_URL } from '../../endpoints';
import { WebScraperError } from './web-scraper-result';

export function createWebScraperRequestAbort(timeoutMs: number, executionSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const timeoutSignal = AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs)));
  const controller = new AbortController();
  const fromTimeout = (): void => controller.abort(timeoutSignal.reason);
  const fromExecution = (): void => controller.abort(executionSignal?.reason);
  timeoutSignal.addEventListener('abort', fromTimeout, { once: true });
  executionSignal?.addEventListener('abort', fromExecution, { once: true });
  if (executionSignal?.aborted) fromExecution();
  return {
    signal: controller.signal,
    cleanup: () => {
      timeoutSignal.removeEventListener('abort', fromTimeout);
      executionSignal?.removeEventListener('abort', fromExecution);
    },
  };
}

export function webScraperFormRequest(url: string, fields: Record<string, string>, timeout: number, sign?: string): IHttpRequestOptions {
  return {
    method: 'POST', url, timeout, json: false, disableFollowRedirect: true,
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', ...(sign ? { sign } : {}) },
    body: new URLSearchParams({ ...fields, api_source: 'sdk', source_platform: 'n8n' }).toString(),
  };
}

export function validateWebScraperDownloadUrl(value: unknown, taskId: string, spiderId: string): URL {
  const fail = (): never => { throw new WebScraperError('protocol_error', 'download_url', taskId, spiderId); };
  if (typeof value !== 'string' || value.trim() !== value) return fail();
  let url: URL;
  try { url = new URL(value); } catch { return fail(); }
  const trusted = new URL(THORDATA_WEB_SCRAPER_DOWNLOAD_URL);
  if (url.protocol !== trusted.protocol || url.origin !== trusted.origin || url.pathname !== trusted.pathname || url.username || url.password || url.hash) return fail();
  const seen = new Set<string>();
  for (const key of url.searchParams.keys()) { if (seen.has(key) || !['task_id', 'type', 'api_key'].includes(key)) return fail(); seen.add(key); }
  if (url.searchParams.get('task_id') !== taskId || url.searchParams.get('type') !== 'json') return fail();
  return url;
}
