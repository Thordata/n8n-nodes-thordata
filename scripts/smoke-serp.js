'use strict';

const ENDPOINT = 'https://scraperapi.thordata.com/request';
const TIMEOUT_MS = 120_000;
const RESULT_KEYS = ['result', 'results', 'organic', 'items', 'output', 'response'];
const BUSINESS_KEYS = ['code', 'error_code', 'status_code'];

function isSuccessfulBusinessCode(code) {
  return code === undefined || code === 0 || code === '0' || code === 200 || code === '200';
}

function own(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function firstBusinessCode(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  for (const key of BUSINESS_KEYS) {
    if (own(payload, key) && payload[key] !== undefined) return payload[key];
  }
  return undefined;
}

function hasTaskId(payload) {
  if (payload === null || typeof payload !== 'object') return false;
  for (const key of ['task_id', 'taskId']) {
    if (own(payload, key) && typeof payload[key] === 'string' && payload[key].trim() !== '') {
      return true;
    }
  }
  if (own(payload, 'data') && payload.data !== null && typeof payload.data === 'object') {
    return hasTaskId(payload.data);
  }
  return false;
}

function hasResult(payload) {
  if (payload === null || payload === undefined) return false;
  if (typeof payload !== 'object' || Array.isArray(payload)) return true;
  if (own(payload, 'data') && payload.data !== null && typeof payload.data === 'object'
    && !Array.isArray(payload.data) && own(payload.data, 'result')) {
    return payload.data.result !== null && payload.data.result !== undefined;
  }
  for (const key of RESULT_KEYS) {
    if (own(payload, key) && payload[key] !== null && payload[key] !== undefined) return true;
  }
  return false;
}

function summarizeSmokeResponse(payload) {
  return { engine: 'google', hasResult: hasResult(payload), hasTaskId: hasTaskId(payload) };
}

function safeSummary(httpStatus, payload, ok) {
  const summary = summarizeSmokeResponse(payload);
  return {
    ok: Boolean(ok),
    httpStatus: typeof httpStatus === 'number' ? httpStatus : null,
    engine: summary.engine,
    hasResult: Boolean(summary.hasResult),
    hasTaskId: Boolean(summary.hasTaskId),
  };
}

function printSummary(summary) {
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

function parseApiKeyInput(input) {
  let key = String(input);
  if (key.endsWith('\n')) {
    key = key.slice(0, -1);
    if (key.endsWith('\r')) key = key.slice(0, -1);
  }
  if (key === '' || /[\r\n]/u.test(key)
    || /^[\x09-\x0D\x20]/u.test(key) || /[\x09-\x0D\x20]$/u.test(key)) {
    throw new Error('invalid input');
  }
  return key;
}

function readApiKey() {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => {
      try {
        const key = parseApiKeyInput(input);
        input = '';
        resolve(key);
      } catch {
        input = '';
        reject(new Error('invalid input'));
      }
    });
    process.stdin.on('error', () => reject(new Error('input error')));
  });
}

async function runSmoke() {
  let httpStatus = null;
  let timeout;
  try {
    const apiKey = await readApiKey();
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const body = new URLSearchParams();
    body.set('engine', 'google');
    body.set('q', 'n8n smoke test');
    body.set('json', '1');
    body.set('isjson', '1');
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        platform: 'n8n',
        'api-source': 'sdk',
      },
      body: body.toString(),
      signal: controller.signal,
    });
    httpStatus = response.status;
    let payload;
    try {
      payload = await response.json();
    } catch {
      printSummary(safeSummary(httpStatus, null, false));
      return 1;
    }
    const businessCode = firstBusinessCode(payload);
    if (!response.ok || !isSuccessfulBusinessCode(businessCode)) {
      printSummary(safeSummary(httpStatus, null, false));
      return 1;
    }
    const summary = summarizeSmokeResponse(payload);
    const ok = summary.hasResult;
    printSummary(safeSummary(httpStatus, payload, ok));
    return ok ? 0 : 1;
  } catch {
    printSummary(safeSummary(httpStatus, null, false));
    return 1;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

if (require.main === module) {
  runSmoke().then((code) => { process.exitCode = code; }).catch(() => {
    printSummary(safeSummary(null, null, false));
    process.exitCode = 1;
  });
}

module.exports = { isSuccessfulBusinessCode, parseApiKeyInput, summarizeSmokeResponse };
