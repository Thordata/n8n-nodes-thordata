import { sleep, type IDataObject, type IExecuteFunctions, type IHttpRequestOptions } from 'n8n-workflow';
import { THORDATA_WEB_SCRAPER_BUILDER_URL, THORDATA_WEB_SCRAPER_TASK_API_BASE_URL } from '../../endpoints';
import { assertWebScraperProduct, validateWebScraperParameters, type WebScraperSchema } from './web-scraper-schema';
import { schemaFetcher, webScraperSchemaRepository } from './web-scraper-schema-client';
import { createWebScraperRequestAbort, webScraperFormRequest, validateWebScraperDownloadUrl } from './web-scraper-request';
import { isRecord, parseJsonValue, parseWebScraperResult, WebScraperError, type WebScraperStage } from './web-scraper-result';

interface LifecycleDependencies {
  now: () => number;
  sleep: (milliseconds: number) => Promise<unknown>;
  request: (options: IHttpRequestOptions, authenticated: boolean) => Promise<unknown>;
  cancelSignal?: AbortSignal;
}
interface LifecycleInput {
  schema: WebScraperSchema; parameters: unknown; apiKey: string;
  maxWaitSeconds: number; includeErrors: boolean; fileName: string;
}

function businessCode(code: unknown, fallback: string): string {
  if ([401, 10013, 10014, 10047, 10048].includes(Number(code))) return 'authentication_failed';
  if (Number(code) === 402) return 'insufficient_balance';
  if (Number(code) === 403) return 'permission_denied';
  return fallback;
}
function raise(error: WebScraperError): never { throw error; }
function httpStatus(error: unknown): unknown {
  const value = error as { httpCode?: unknown; statusCode?: unknown; status?: unknown; response?: { status?: unknown; statusCode?: unknown } } | null;
  return value?.statusCode ?? value?.status ?? value?.httpCode ?? value?.response?.status ?? value?.response?.statusCode;
}
function reason(value: Record<string, unknown>): unknown { return value.msg ?? value.message ?? value.error ?? (typeof value.data === 'string' ? value.data : undefined); }

export async function executeWebScraperLifecycle(deps: LifecycleDependencies, input: LifecycleInput): Promise<IDataObject> {
  const { schema } = input;
  assertWebScraperProduct(schema.spiderId);
  const parameters = validateWebScraperParameters(schema, input.parameters);
  if (!Number.isInteger(input.maxWaitSeconds) || input.maxWaitSeconds < 30 || input.maxWaitSeconds > 900 || typeof input.includeErrors !== 'boolean' || typeof input.fileName !== 'string' || !input.fileName.trim() || typeof input.apiKey !== 'string' || !input.apiKey.trim()) throw new WebScraperError('invalid_parameters', 'validate', undefined, schema.spiderId);
  const deadline = deps.now() + input.maxWaitSeconds * 1_000;
  let taskId = '';
  const check = (stage: WebScraperStage): number => {
    const remaining = deadline - deps.now();
    if (remaining <= 0) throw new WebScraperError('wait_timeout', stage, taskId, schema.spiderId);
    return remaining;
  };
  const request = async (stage: WebScraperStage, cap: number, options: IHttpRequestOptions, auth = true): Promise<unknown> => {
    const remaining = check(stage);
    if (deps.cancelSignal?.aborted) throw new WebScraperError('request_failed', stage, taskId, schema.spiderId);
    const timeout = Math.min(cap, remaining);
    const abort = createWebScraperRequestAbort(timeout, deps.cancelSignal);
    let result: unknown;
    try { result = await deps.request({ ...options, timeout, abortSignal: abort.signal, ...(auth ? { ignoreHttpStatusErrors: true, returnFullResponse: true } : {}) }, auth); }
    catch (error) {
      // The server may already have accepted the submission, so it must never be retried.
      if (stage === 'submit') return raise(new WebScraperError(businessCode(httpStatus(error), 'submission_unknown'), stage, taskId, schema.spiderId));
      check(stage);
      return raise(new WebScraperError(businessCode(httpStatus(error), 'request_failed'), stage, taskId, schema.spiderId));
    }
    finally { abort.cleanup(); }
    if (stage !== 'submit') check(stage);
    if (auth) {
      if (!isRecord(result) || !Number.isInteger(result.statusCode) || Number(result.statusCode) < 100 || Number(result.statusCode) > 599 || !Object.prototype.hasOwnProperty.call(result, 'body')) throw new WebScraperError('protocol_error', stage, taskId, schema.spiderId);
      if (Number(result.statusCode) < 200 || Number(result.statusCode) >= 300) {
        const body = parseJsonValue(result.body);
        const submissionCode = Number(result.statusCode) >= 500 || result.statusCode === 408 ? 'submission_unknown' : 'submission_failed';
        throw new WebScraperError(businessCode(result.statusCode, stage === 'submit' ? submissionCode : 'request_failed'), stage, taskId, schema.spiderId, isRecord(body) ? reason(body) : undefined, [input.apiKey]);
      }
      return result.body;
    }
    return result;
  };
  const submission = parseJsonValue(await request('submit', 40_000, webScraperFormRequest(THORDATA_WEB_SCRAPER_BUILDER_URL, {
    spider_name: schema.spiderName, spider_id: schema.spiderId, spider_parameters: JSON.stringify([parameters]),
    spider_errors: String(input.includeErrors), file_name: input.fileName,
  }, 40_000)));
  if (!isRecord(submission) || submission.code !== 200) throw new WebScraperError(isRecord(submission) && typeof submission.code === 'number' ? businessCode(submission.code, 'submission_failed') : 'submission_unknown', 'submit', undefined, schema.spiderId, isRecord(submission) ? reason(submission) : undefined, [input.apiKey]);
  if (!isRecord(submission.data) || typeof submission.data.task_id !== 'string' || !/^[\w-]{1,200}$/u.test(submission.data.task_id) || submission.data.task_id.includes(input.apiKey)) throw new WebScraperError('submission_unknown', 'submit', undefined, schema.spiderId);
  taskId = submission.data.task_id;
  check('submit');
  for (;;) {
    const poll = parseJsonValue(await request('poll', 15_000, webScraperFormRequest(`${THORDATA_WEB_SCRAPER_TASK_API_BASE_URL}/tasks-status`, { tasks_ids: taskId }, 15_000, input.apiKey)));
    if (!isRecord(poll) || poll.code !== 200 || !Array.isArray(poll.data)) throw new WebScraperError(isRecord(poll) ? businessCode(poll.code, 'protocol_error') : 'protocol_error', 'poll', taskId, schema.spiderId, isRecord(poll) ? reason(poll) : undefined, [input.apiKey]);
    const matches = poll.data.filter(row => isRecord(row) && row.task_id === taskId);
    if (matches.length !== 1 || !isRecord(matches[0]) || !['Running', 'Ready', 'Failed'].includes(matches[0].status as string)) throw new WebScraperError('protocol_error', 'poll', taskId, schema.spiderId);
    if (matches[0].status === 'Failed') throw new WebScraperError('scrape_failed', 'poll', taskId, schema.spiderId, reason(matches[0]), [input.apiKey]);
    if (matches[0].status === 'Ready') break;
    await deps.sleep(Math.min(5_000, check('poll')));
    check('poll');
  }
  const address = parseJsonValue(await request('download_url', 15_000, webScraperFormRequest(`${THORDATA_WEB_SCRAPER_TASK_API_BASE_URL}/tasks-download`, { tasks_id: taskId, type: 'json' }, 15_000, input.apiKey)));
  if (!isRecord(address) || address.code !== 200 || !isRecord(address.data) || address.data.tasks_ids !== taskId) throw new WebScraperError(isRecord(address) ? businessCode(address.code, 'protocol_error') : 'protocol_error', 'download_url', taskId, schema.spiderId, isRecord(address) ? reason(address) : undefined, [input.apiKey]);
  const url = validateWebScraperDownloadUrl(address.data.download, taskId, schema.spiderId);
  const file = await request('download', 60_000, { method: 'GET', url: url.toString(), headers: { Accept: 'application/json' }, json: false, disableFollowRedirect: true }, false);
  const result = parseWebScraperResult(file, taskId, schema.spiderId, schema.fields.map(field => field.key), [input.apiKey, url.searchParams.get('api_key') ?? '']);
  check('parse');
  return result;
}

export async function executeWebScraper(context: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const operation = context.getNodeParameter('operation', itemIndex) as string;
  assertWebScraperProduct(operation);
  const schema = await webScraperSchemaRepository.get(operation, schemaFetcher(context));
  const mapper = context.getNodeParameter('webScraperParameters', itemIndex, {}) as { value?: unknown };
  const options = context.getNodeParameter('webScraperOptions', itemIndex, {}) as Record<string, unknown>;
  let apiKey: unknown;
  try { apiKey = (await context.getCredentials('thordataDatasetApi')).apiKey; }
  catch { return raise(new WebScraperError('authentication_failed', 'validate', undefined, operation)); }
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new WebScraperError('authentication_failed', 'validate', undefined, operation);
  return executeWebScraperLifecycle({
    now: Date.now, sleep, cancelSignal: context.getExecutionCancelSignal?.(),
    request: async (requestOptions, authenticated) => context.helpers.httpRequest({ ...requestOptions, headers: { ...requestOptions.headers, ...(authenticated ? { Authorization: `Bearer ${apiKey}` } : {}) } }),
  }, { schema, parameters: mapper.value ?? {}, apiKey, maxWaitSeconds: (options.maxWaitSeconds ?? 300) as number, includeErrors: (options.includeErrors ?? true) as boolean, fileName: (options.fileName ?? '{{TasksID}}') as string });
}
