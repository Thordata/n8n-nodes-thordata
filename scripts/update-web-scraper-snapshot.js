const { readFile, writeFile, rename, unlink, mkdtemp, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const ts = require('typescript');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const PUBLIC_BASES = ['https://api.thordata.com/web-scraper/schema', 'http://api-dev-test.thordata.com/web-scraper/schema'];

async function loadBaseUrl(packageRoot = PACKAGE_ROOT) {
  const source = await readFile(path.join(packageRoot, 'endpoints.ts'), 'utf8');
  const base = source.match(/export const THORDATA_WEB_SCRAPER_SCHEMA_BASE_URL\s*=\s*['"]([^'"]+)['"]/u)?.[1];
  if (!PUBLIC_BASES.includes(base)) throw new Error('Package Web Scraper schema source endpoint is invalid');
  return base;
}

async function loadValidators(packageRoot = PACKAGE_ROOT) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const directory = await mkdtemp(path.join(temporaryRoot, 'thordata-web-scraper-schema-'));
  const modules = ['web-scraper-result', 'web-scraper-schema'];
  try {
    for (const name of modules) {
      const source = await readFile(path.join(packageRoot, 'nodes', 'Thordata', `${name}.ts`), 'utf8');
      const compiled = ts.transpileModule(source, {
        fileName: `${name}.ts`, reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
      });
      if (compiled.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) throw new Error('Current schema validator could not be compiled');
      await writeFile(path.join(directory, `${name}.js`), compiled.outputText, 'utf8');
    }
    return require(path.join(directory, 'web-scraper-schema.js'));
  } finally {
    for (const name of modules) delete require.cache[path.join(directory, `${name}.js`)];
    if (path.dirname(path.resolve(directory)) !== temporaryRoot || !path.basename(directory).startsWith('thordata-web-scraper-schema-')) throw new Error('Unexpected temporary validator directory');
    await rm(directory, { recursive: true, force: true });
  }
}

async function fetchSnapshot(baseUrl, fetcher = fetch, validators) {
  if (!PUBLIC_BASES.includes(baseUrl)) throw new Error('Only the package public schema endpoint is allowed');
  const schema = validators ?? await loadValidators();
  const get = async (url) => {
    const response = await fetcher(url, { redirect: 'error', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Public schema request failed');
    return response.json();
  };
  const operations = await get(`${baseUrl}/operations`);
  const available = schema.normalizeWebScraperOperations(operations);
  if (available.length !== schema.WEB_SCRAPER_PRODUCTS.length) throw new Error('All seven selected products must be available to update the snapshot');
  const ids = schema.WEB_SCRAPER_PRODUCTS.map(product => product.id);
  const snapshot = {
    operations: { code: 0, data: { schema_version: '1', resource: 'web_scraper', operations: operations.data.operations.filter(operation => ids.includes(operation.spider_id)) } },
    parameters: {},
  };
  for (const id of ids) {
    const payload = await get(`${baseUrl}/parameters?spider_id=${encodeURIComponent(id)}`);
    schema.normalizeWebScraperSchema(payload, id);
    snapshot.parameters[id] = { code: 0, data: payload.data };
  }
  const serialized = JSON.stringify(snapshot);
  if (/api[_-]?key\s*[=:]|Bearer\s+\S+|[a-f0-9]{32}/iu.test(serialized)) throw new Error('Public schema contains unexpected sensitive content');
  return snapshot;
}

async function main() {
  if (process.argv.length !== 2) throw new Error('Usage: node scripts/update-web-scraper-snapshot.js');
  const snapshot = await fetchSnapshot(await loadBaseUrl());
  const destination = path.join(PACKAGE_ROOT, 'nodes', 'Thordata', 'web-scraper-schema.snapshot.json');
  const temporary = `${destination}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  process.stdout.write('Updated seven public Web Scraper schemas.\n');
}

module.exports = { fetchSnapshot, loadBaseUrl, loadValidators };
if (require.main === module) main().catch(() => {
  process.stderr.write('Web Scraper snapshot update failed. Check the public schema and current package sources.\n');
  process.exitCode = 1;
});
