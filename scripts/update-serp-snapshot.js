const { readFile, realpath, rename, unlink, writeFile } = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_SCHEMA_URL = 'https://api.thordata.com/serp/playground/schema?lang=en';
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_PATH = path.join(PACKAGE_ROOT, 'nodes', 'Thordata', 'serp-schema.snapshot.json');
const COMPILED_SCHEMA_PATH = path.join(PACKAGE_ROOT, 'dist', 'nodes', 'Thordata', 'schema.js');
const SENSITIVE_QUERY_FRAGMENTS = ['auth', 'token', 'secret', 'password', 'apikey', 'credential'];

function parseSource(args) {
  if (args.length === 0) return { kind: 'url', value: DEFAULT_SCHEMA_URL };
  if (args.length !== 2) throw new Error('usage: update-serp-snapshot.js [--url <url> | --file <path>]');
  const [flag, value] = args;
  if (flag !== '--url' && flag !== '--file') throw new Error('unknown option');
  if (value.trim() === '' || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return { kind: flag.slice(2), value };
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function loadCompiledNormalizer() {
  try {
    const compiledSchema = require(COMPILED_SCHEMA_PATH);
    if (typeof compiledSchema.normalizeSerpSchema !== 'function') throw new Error('missing export');
    return compiledSchema.normalizeSerpSchema;
  } catch {
    throw new Error('compiled schema normalizer is unavailable; run npm run build');
  }
}

function validatePayload(payload, normalizer) {
  if (!isPlainObject(payload)) throw new Error('payload must be a plain object');
  if (payload.code !== 0) throw new Error('payload.code must equal 0');
  if (!isPlainObject(payload.data)) throw new Error('payload.data must be a plain object');
  if (payload.data.audience !== 'is_serp_old=0') {
    throw new Error('payload.data.audience must equal is_serp_old=0');
  }
  if (typeof payload.data.default_engine !== 'string' || payload.data.default_engine.trim() === '') {
    throw new Error('payload.data.default_engine must be nonblank');
  }
  if (!Array.isArray(payload.data.categories) || payload.data.categories.length === 0) {
    throw new Error('payload.data.categories must be a nonempty array');
  }
  const strictNormalizer = normalizer === undefined ? loadCompiledNormalizer() : normalizer;
  try {
    strictNormalizer(payload);
  } catch {
    throw new Error('schema payload failed strict validation');
  }
}

function parseJson(text, sourceName) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${sourceName} is not valid JSON`);
  }
}

function assertPathInsidePackage(packageRoot, candidatePath) {
  const relativePath = path.relative(packageRoot, candidatePath);
  if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error('schema file path must stay inside package');
  }
}

async function resolveSchemaFilePath(value) {
  const lexicalPath = path.resolve(PACKAGE_ROOT, value);
  assertPathInsidePackage(PACKAGE_ROOT, lexicalPath);
  let realPackageRoot;
  let realSourcePath;
  try {
    [realPackageRoot, realSourcePath] = await Promise.all([
      realpath(PACKAGE_ROOT),
      realpath(lexicalPath),
    ]);
  } catch {
    throw new Error('schema file could not be read');
  }
  assertPathInsidePackage(realPackageRoot, realSourcePath);
  return realSourcePath;
}

function validateSchemaUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('schema URL is invalid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('schema URL protocol must be http or https');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('schema URL user information is not allowed');
  }
  for (const parameterName of url.searchParams.keys()) {
    const normalizedName = parameterName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const isSensitive = normalizedName === 'key'
      || SENSITIVE_QUERY_FRAGMENTS.some((fragment) => normalizedName.includes(fragment));
    if (isSensitive) {
      if (/^[a-z0-9._-]+$/i.test(parameterName)) {
        throw new Error(`schema URL query parameter ${parameterName} is not allowed`);
      }
      throw new Error('schema URL contains a disallowed query parameter');
    }
  }
  return url;
}

function requestFailure(error, signal) {
  if (signal.aborted || (error && error.name === 'AbortError')) {
    return new Error('schema request timed out');
  }
  return new Error('schema request failed');
}

async function readUrl(value, fetchImplementation = globalThis.fetch, timeoutMs = 5_000) {
  const url = validateSchemaUrl(value);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImplementation(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (error) {
      throw requestFailure(error, controller.signal);
    }
    if (!response.ok) {
      if (typeof response.status === 'number' && Number.isInteger(response.status)) {
        throw new Error(`schema request failed with HTTP ${response.status}`);
      }
      throw new Error('schema request failed');
    }
    let responseText;
    try {
      responseText = await response.text();
    } catch (error) {
      throw requestFailure(error, controller.signal);
    }
    return parseJson(responseText, 'schema response');
  } finally {
    clearTimeout(timeout);
  }
}

async function readSource(source, fetchImplementation, timeoutMs) {
  if (source.kind === 'url') return readUrl(source.value, fetchImplementation, timeoutMs);
  const sourcePath = await resolveSchemaFilePath(source.value);
  let sourceText;
  try {
    sourceText = await readFile(sourcePath, 'utf8');
  } catch {
    throw new Error('schema file could not be read');
  }
  return parseJson(sourceText, 'schema file');
}

async function writeSnapshot(payload, destination = SNAPSHOT_PATH) {
  const temporaryPath = `${destination}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, destination);
  } catch {
    await unlink(temporaryPath).catch(() => undefined);
    throw new Error('schema snapshot could not be written');
  }
}

async function updateSnapshot({
  source,
  normalizer,
  fetchImplementation,
  timeoutMs,
  destination = SNAPSHOT_PATH,
}) {
  const payload = await readSource(source, fetchImplementation, timeoutMs);
  validatePayload(payload, normalizer);
  await writeSnapshot(payload, destination);
}

async function main(args = process.argv.slice(2)) {
  const source = parseSource(args);
  await updateSnapshot({ source });
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to update SERP schema: ${message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  isPlainObject,
  parseSource,
  readUrl,
  updateSnapshot,
  validatePayload,
  validateSchemaUrl,
};
