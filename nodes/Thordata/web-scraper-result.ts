import type { IDataObject } from 'n8n-workflow';

export type WebScraperStage = 'schema' | 'validate' | 'submit' | 'poll' | 'download_url' | 'download' | 'parse';
const messages: Record<string, string> = {
  schema_invalid: 'Web Scraper schema is incompatible. Refresh the fields or update the node.',
  product_unavailable: 'This Web Scraper product is unavailable.',
  schema_unavailable: 'Web Scraper schema could not be loaded.',
  invalid_parameters: 'Web Scraper parameters are invalid. Check the required fields and permitted values.',
  submission_unknown: 'Submission outcome is unknown. Check the Thordata task list before submitting again.',
  submission_failed: 'Web Scraper submission was rejected.',
  poll_failed: 'Web Scraper task status could not be verified.',
  scrape_failed: 'Web Scraper returned only failed records or the task failed.',
  download_url_invalid: 'Web Scraper returned an invalid download address.',
  download_failed: 'Web Scraper results could not be downloaded.',
  invalid_result: 'Web Scraper results are not valid JSON records.',
  wait_timeout: 'Web Scraper exceeded the maximum wait time. Check the task in Thordata.',
  protocol_error: 'Web Scraper returned an incompatible response.',
  authentication_failed: 'Web Scraper authentication failed. Check the API key.',
  permission_denied: 'Web Scraper permission was denied.',
  insufficient_balance: 'Web Scraper account balance is insufficient.',
  request_failed: 'Web Scraper request failed.',
};

export class WebScraperError extends Error {
  readonly error_code: string;
  readonly stage: WebScraperStage;
  readonly task_id?: string;
  readonly spider_id?: string;

  constructor(code: string, stage: WebScraperStage, taskId?: string, spiderId?: string, reason?: unknown, secrets: string[] = []) {
    const knownCode = Object.prototype.hasOwnProperty.call(messages, code) ? code : 'request_failed';
    const safeId = taskId && /^[\w-]{1,200}$/u.test(taskId) && !secrets.some(secret => secret && taskId.includes(secret)) ? taskId : undefined;
    const detail = typeof reason === 'string' ? String(redactWebScraperValue(reason, secrets)).replace(/https?:\/\/\S+/giu, '[redacted URL]').replace(/[\r\n\t]+/gu, ' ').slice(0, 250).trim() : '';
    super(`${messages[knownCode]}${detail ? ` ${detail}` : ''}${safeId ? ` Task ID: ${safeId}.` : ''}`);
    this.name = 'WebScraperError';
    this.error_code = knownCode;
    this.stage = stage;
    if (safeId) this.task_id = safeId;
    if (spiderId && /^[\w-]{1,120}$/u.test(spiderId)) this.spider_id = spiderId;
  }
}

export function sanitizeWebScraperError(error: unknown, secret?: string): { message: string; error_code: string; stage: WebScraperStage; task_id?: string; spider_id?: string } {
  const safe = error instanceof WebScraperError ? error : new WebScraperError('request_failed', 'submit');
  return {
    message: String(redactWebScraperValue(safe.message, secret ? [secret] : [])),
    error_code: safe.error_code,
    stage: safe.stage,
    ...(safe.task_id && (!secret || !safe.task_id.includes(secret)) ? { task_id: safe.task_id } : {}),
    ...(safe.spider_id && (!secret || !safe.spider_id.includes(secret)) ? { spider_id: safe.spider_id } : {}),
  };
}

export function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return undefined; }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function redactWebScraperValue(value: unknown, secrets: string[]): unknown {
  if (typeof value === 'string') {
    let text = value.replace(/https?:\/\/[^\s"<>]*(?:api_key|access_token|authorization|sign|token)=[^\s"<>]*/giu, '[redacted URL]');
    text = text.replace(/\bauthorization\s*:\s*Bearer\s+[^\s,;"}]+/giu, 'Authorization: [redacted]');
    text = text.replace(/\b(api[_-]?key|authorization|sign|token)\s*[:=]\s*[^\s,;"}]+/giu, '$1: [redacted]');
    for (const secret of secrets.filter(Boolean)) {
      for (const spelling of [secret, encodeURIComponent(secret)]) text = text.split(spelling).join('[redacted]');
    }
    return text;
  }
  if (Array.isArray(value)) return value.map(entry => redactWebScraperValue(entry, secrets));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/^(?:api[_-]?key|access[_-]?token|authorization|sign|password|secret|__proto__|constructor|prototype)$/iu.test(key))
    .map(([key, entry]) => [String(redactWebScraperValue(key, secrets)), redactWebScraperValue(entry, secrets)]));
  return value;
}

function meaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(meaningfulValue);
  if (isRecord(value)) return Object.values(value).some(meaningfulValue);
  return true;
}
function failureCode(value: unknown): boolean {
  if (value === null || value === undefined || typeof value === 'string' && !value.trim()) return false;
  if (typeof value !== 'number' && typeof value !== 'string') return true;
  const numeric = Number(value);
  return !Number.isFinite(numeric) || numeric !== 0 && numeric !== 200;
}
function failedRecord(record: Record<string, unknown>): boolean {
  return record.success === false
    || (record.error !== false && record.error !== 0 && meaningfulValue(record.error))
    || failureCode(record.error_code);
}

export function parseWebScraperResult(payload: unknown, taskId: string, spiderId: string, inputKeys: string[], secrets: string[]): IDataObject {
  const value = parseJsonValue(payload);
  if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'data') && (typeof value.msg === 'string' || typeof value.message === 'string') && (typeof value.code === 'number' || typeof value.code === 'string') && failureCode(value.code)) {
    const code = Number(value.code);
    const category = [401, 10013, 10014, 10047, 10048].includes(code) ? 'authentication_failed' : code === 403 ? 'permission_denied' : code === 402 ? 'insufficient_balance' : 'scrape_failed';
    throw new WebScraperError(category, 'parse', taskId, spiderId, value.msg ?? value.message, secrets);
  }
  const rows = Array.isArray(value) ? value : isRecord(value) ? [value] : undefined;
  if (!rows || rows.some(row => !isRecord(row))) throw new WebScraperError('protocol_error', 'parse', taskId, spiderId);
  const records = rows as Record<string, unknown>[];
  const meaningful = records.some(row => {
    if (failedRecord(row)) return false;
    const content = Object.entries(row).filter(([key]) => !inputKeys.includes(key) && !['input', 'input_url', 'url', 'job_url', 'keyword', 'success', 'error', 'error_code'].includes(key));
    return content.some(([, entry]) => meaningfulValue(entry));
  });
  const errors = records.filter(failedRecord).length;
  if (records.length > 0 && errors === records.length) throw new WebScraperError('scrape_failed', 'parse', taskId, spiderId, records[0].error, secrets);
  return {
    task_id: taskId, spider_id: spiderId,
    status: errors ? 'partial' : meaningful ? 'completed' : 'empty',
    record_count: records.length,
    ...(errors ? { error_record_count: errors } : {}),
    result: redactWebScraperValue(records, secrets) as IDataObject[],
  };
}
