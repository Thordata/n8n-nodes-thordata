const { deepStrictEqual } = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} = require('node:fs');
const { dirname, join, relative, resolve, sep } = require('node:path');

const packageRoot = resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function exists(file) {
  return existsSync(resolve(packageRoot, file));
}

function readJson(file) {
  return JSON.parse(readFileSync(resolve(packageRoot, file), 'utf8'));
}

function readSource(file) {
  return readFileSync(resolve(packageRoot, file), 'utf8');
}

function assertNotSymlink(fileStat) {
  if (fileStat.isSymbolicLink()) {
    throw new Error('symlinks are not allowed in package artifacts');
  }
}

function listFiles(directory) {
  const absoluteDirectory = resolve(packageRoot, directory);

  let directoryStat;
  try {
    directoryStat = lstatSync(absoluteDirectory);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  assertNotSymlink(directoryStat);

  return readdirSync(absoluteDirectory).flatMap((entry) => {
    const absoluteEntry = join(absoluteDirectory, entry);
    const entryStat = lstatSync(absoluteEntry);
    assertNotSymlink(entryStat);
    if (entryStat.isDirectory()) {
      return listFiles(relative(packageRoot, absoluteEntry));
    }
    return [relative(packageRoot, absoluteEntry).split(sep).join('/')];
  });
}

function isDeepFrozen(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return true;
  if (seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Reflect.ownKeys(value).every((key) => isDeepFrozen(value[key], seen));
}

const credentialPattern = /[a-f0-9]{32}/i;
const legacyBrandPattern = new RegExp(
  [
    ['ta', 'lor'].join(''),
    ['bright', '\\s*', 'data'].join(''),
  ].join('|'),
  'i',
);

function isRunnableNpmCli(candidate) {
  if (typeof candidate !== 'string' || candidate.trim() === '') return false;
  try {
    const resolvedCandidate = realpathSync(candidate);
    return /\.(?:c?js|mjs)$/i.test(resolvedCandidate)
      && statSync(resolvedCandidate).isFile();
  } catch {
    return false;
  }
}

function npmCliCandidatesFromExecutable(executable) {
  const candidates = [
    executable,
    resolve(dirname(executable), 'node_modules/npm/bin/npm-cli.js'),
    resolve(dirname(executable), '..', 'lib/node_modules/npm/bin/npm-cli.js'),
  ];
  try {
    candidates.unshift(realpathSync(executable));
  } catch {
    // 平台定位器返回启动器时，下面的相邻路径仍可能解析到 npm CLI。
  }
  return candidates;
}

function resolveNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    resolve(dirname(process.execPath), '..', 'lib/node_modules/npm/bin/npm-cli.js'),
  ];
  for (const candidate of candidates) {
    if (isRunnableNpmCli(candidate)) return realpathSync(candidate);
  }

  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const located = spawnSync(locator, ['npm'], {
    cwd: packageRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (located.error === undefined && located.status === 0) {
    const executables = located.stdout.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean);
    for (const executable of executables) {
      for (const candidate of npmCliCandidatesFromExecutable(executable)) {
        if (isRunnableNpmCli(candidate)) return realpathSync(candidate);
      }
    }
  }
  throw new Error('Unable to locate a runnable npm CLI for package validation');
}

function validateTrackedText() {
  const trackedResult = spawnSync('git', ['ls-files', '-z'], {
    cwd: packageRoot,
    shell: false,
  });
  assert(trackedResult.error === undefined, 'Unable to inspect tracked files with git');
  assert(trackedResult.status === 0, 'Unable to inspect tracked files with git');

  const trackedPaths = trackedResult.stdout.toString('utf8').split('\0').filter(Boolean);
  for (const trackedPath of trackedPaths) {
    if (trackedPath.startsWith('docs/superpowers/')) continue;
    const absolutePath = resolve(packageRoot, trackedPath);
    const trackedStat = lstatSync(absolutePath);
    assertNotSymlink(trackedStat);
    if (!trackedStat.isFile()) continue;
    const trackedBuffer = readFileSync(absolutePath);
    if (trackedBuffer.includes(0)) continue;
    const trackedText = trackedBuffer.toString('utf8');
    assert(!credentialPattern.test(trackedText), `${trackedPath} contains credential-shaped material`);
    assert(!legacyBrandPattern.test(trackedText), `${trackedPath} contains legacy branding`);
  }
}

const expectedFiles = ['dist', 'README.md', 'LICENSE'];
const expectedDistFiles = [
  'dist/index.js',
  'dist/credentials/ThordataApi.credentials.js',
  'dist/nodes/Thordata/Thordata.node.js',
  'dist/nodes/Thordata/Thordata.node.json',
  'dist/nodes/Thordata/thordata.svg',
  'dist/nodes/Thordata/schema.js',
  'dist/nodes/Thordata/schema-client.js',
  'dist/nodes/Thordata/schema-snapshot.js',
  'dist/nodes/Thordata/serp-schema.snapshot.json',
  'dist/nodes/Thordata/request.js',
  'dist/nodes/Thordata/response.js',
].sort();
const expectedRegistration = {
  n8nNodesApiVersion: 1,
  credentials: ['dist/credentials/ThordataApi.credentials.js'],
  nodes: ['dist/nodes/Thordata/Thordata.node.js'],
};
const packageJson = readJson('package.json');

assert(packageJson.name === 'n8n-nodes-thordata', 'Unexpected package name');
assert(/^\d+\.\d+\.\d+$/.test(packageJson.version), 'Package version must be valid semver');
assert(packageJson.version === '0.1.1', 'Unexpected package version');
assert(packageJson.description === 'Thordata SERP API community node for n8n', 'Unexpected package description');
assert(packageJson.license === 'MIT', 'Package license must be MIT');
assert(packageJson.author?.name === 'Thordata', 'Unexpected package author');
assert(packageJson.homepage === 'https://www.thordata.com', 'Unexpected package homepage');
assert(packageJson.main === 'dist/index.js', 'Package main must be dist/index.js');
for (const keyword of ['n8n-community-node-package', 'n8n', 'serp', 'thordata']) {
  assert(packageJson.keywords.includes(keyword), `Missing package keyword: ${keyword}`);
}
assert(JSON.stringify(packageJson.files) === JSON.stringify(expectedFiles), 'Unexpected published files');
deepStrictEqual(packageJson.n8n, expectedRegistration, 'Unexpected n8n registration');
assert(
  packageJson.dependencies && Object.keys(packageJson.dependencies).length === 0,
  'Runtime dependencies are not allowed',
);
deepStrictEqual(packageJson.peerDependencies, { 'n8n-workflow': '*' }, 'Unexpected peer dependencies');
assert(packageJson.scripts.verify === 'npm run build && npm run lint && npm test', 'Unexpected verify script');
assert(packageJson.scripts.prepack === 'npm run verify', 'Unexpected prepack script');

const sourceDirectories = ['credentials', 'nodes', 'scripts', 'test'];
assert(
  packageJson.files.every(
    (entry) => !sourceDirectories.some((directory) => entry === directory || entry.startsWith(`${directory}/`)),
  ),
  'TypeScript source directories must not be published',
);

assert(exists('package-lock.json'), 'package-lock.json is required');
const packageLock = readJson('package-lock.json');
assert(packageLock.version === packageJson.version, 'Lockfile version does not match package version');
assert(
  packageLock.packages && packageLock.packages['']?.version === packageJson.version,
  'Root lockfile package version does not match package version',
);

const credentialPath = 'credentials/ThordataApi.credentials.ts';
const compiledCredentialPath = 'dist/credentials/ThordataApi.credentials.js';
const nodeSourcePath = 'nodes/Thordata/Thordata.node.ts';
const compiledNodePath = 'dist/nodes/Thordata/Thordata.node.js';
const nodeMetadataPath = 'nodes/Thordata/Thordata.node.json';
const iconPath = 'nodes/Thordata/thordata.svg';
const snapshotPath = 'nodes/Thordata/serp-schema.snapshot.json';
const requiredSourcePaths = [
  'README.md',
  credentialPath,
  nodeSourcePath,
  nodeMetadataPath,
  iconPath,
  snapshotPath,
];

for (const requiredSource of requiredSourcePaths) {
  assert(exists(requiredSource), `Missing required source: ${requiredSource}`);
}

for (const requiredRuntime of expectedDistFiles) {
  assert(exists(requiredRuntime), `Missing built runtime: ${requiredRuntime}`);
}
deepStrictEqual(listFiles('dist').sort(), expectedDistFiles, 'Unexpected dist artifact set');

const credentialSource = readSource(credentialPath);
assert(
  !/ICredentialTestRequest/.test(credentialSource),
  'Credential test request imports are not allowed',
);

const { ThordataApi } = require(resolve(packageRoot, compiledCredentialPath));
const credential = new ThordataApi();
assert(credential.name === 'thordataApi', 'Unexpected credential name');
assert(credential.displayName === 'Thordata API', 'Unexpected credential display name');
assert(credential.documentationUrl === 'https://doc.thordata.com', 'Unexpected credential documentation URL');
deepStrictEqual(
  credential.properties.map((property) => ({
    name: property.name,
    type: property.type,
    default: property.default,
    required: property.required,
    password: property.typeOptions?.password ?? false,
  })),
  [
    {
      name: 'apiKey',
      type: 'string',
      default: '',
      required: true,
      password: true,
    },
    {
      name: 'endpoint',
      type: 'string',
      default: 'https://scraperapi.thordata.com/request',
      required: true,
      password: false,
    },
  ],
  'Unexpected credential properties',
);
deepStrictEqual(
  credential.authenticate,
  {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.apiKey}}',
      },
    },
  },
  'Unexpected credential authentication',
);
assert(!('test' in credential), 'Credential must not declare an automatic test request');

const { BUNDLED_SERP_SCHEMA } = require(
  resolve(packageRoot, 'dist/nodes/Thordata/schema-snapshot.js'),
);
assert(BUNDLED_SERP_SCHEMA.audience === 'is_serp_old=0', 'Unexpected schema audience');
assert(BUNDLED_SERP_SCHEMA.defaultEngine === 'google', 'Unexpected default SERP engine');
assert(BUNDLED_SERP_SCHEMA.engines.length === 34, 'Bundled schema must contain 34 engines');
assert(
  new Set(BUNDLED_SERP_SCHEMA.engines.map(({ key }) => key)).size === 34,
  'Bundled schema engine keys must be distinct',
);
assert(isDeepFrozen(BUNDLED_SERP_SCHEMA), 'Bundled schema must be deeply frozen');

const { buildSerpParams, buildSerpRequestOptions } = require(
  resolve(packageRoot, 'dist/nodes/Thordata/request.js'),
);
const protectedParams = buildSerpParams({
  schema: BUNDLED_SERP_SCHEMA,
  engine: 'google',
  values: { q: 'n8n' },
  extraParameters: { engine: 'bing', isjson: 0, json: '4' },
});
deepStrictEqual(
  {
    engine: protectedParams.engine,
    isjson: protectedParams.isjson,
    json: protectedParams.json,
    q: protectedParams.q,
  },
  { engine: 'google', isjson: 1, json: '4', q: 'n8n' },
  'Protected SERP controls or Extra Parameters precedence changed',
);
deepStrictEqual(
  buildSerpRequestOptions({
    endpoint: 'https://example.test/request',
    params: protectedParams,
  }),
  {
    method: 'POST',
    url: 'https://example.test/request',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'n8n',
      platform: 'n8n',
      'api-source': 'sdk',
    },
    body: 'gl=us&hl=en&start=0&q=n8n&json=4&engine=google&isjson=1',
    json: true,
    timeout: 120_000,
  },
  'Unexpected compiled SERP request options',
);

const { SERP_SCHEMA_URL, buildSchemaRequestOptions } = require(
  resolve(packageRoot, 'dist/nodes/Thordata/schema-client.js'),
);
assert(
  SERP_SCHEMA_URL === 'https://api.thordata.com/serp/playground/schema?lang=en',
  'Unexpected public SERP schema URL',
);
deepStrictEqual(
  buildSchemaRequestOptions(),
  {
    method: 'GET',
    url: 'https://api.thordata.com/serp/playground/schema?lang=en',
    json: true,
    timeout: 5_000,
  },
  'Unexpected schema request options',
);

const { Thordata } = require(resolve(packageRoot, compiledNodePath));
const node = new Thordata();
const nodeDescription = node.description;
deepStrictEqual(
  {
    displayName: nodeDescription.displayName,
    name: nodeDescription.name,
    icon: nodeDescription.icon,
    group: nodeDescription.group,
    version: nodeDescription.version,
    description: nodeDescription.description,
    defaults: nodeDescription.defaults,
    inputs: nodeDescription.inputs,
    outputs: nodeDescription.outputs,
    usableAsTool: nodeDescription.usableAsTool,
    credentials: nodeDescription.credentials,
  },
  {
    displayName: 'Thordata',
    name: 'thordata',
    icon: 'file:thordata.svg',
    group: ['transform'],
    version: 1,
    description: 'Search with Thordata SERP API',
    defaults: { name: 'Thordata' },
    inputs: ['main'],
    outputs: ['main'],
    usableAsTool: true,
    credentials: [{ name: 'thordataApi', required: true }],
  },
  'Unexpected node identity or credentials',
);

deepStrictEqual(
  nodeDescription.properties.map(({ name }) => name),
  ['resource', 'operation', 'parameters', 'encodedLocationValue', 'cr', 'lr', 'options'],
  'Unexpected top-level node properties',
);
const [
  resourceProperty,
  operationProperty,
  parametersProperty,
  encodedLocationProperty,
  multiCountriesProperty,
  multiLanguagesProperty,
  optionsProperty,
] = nodeDescription.properties;
deepStrictEqual(
  resourceProperty,
  {
    displayName: 'Resource',
    name: 'resource',
    type: 'options',
    options: [{ name: 'SERP API', value: 'serp' }],
    default: 'serp',
    required: true,
    noDataExpression: true,
  },
  'Unexpected node resource property',
);
deepStrictEqual(
  {
    name: operationProperty.name,
    type: operationProperty.type,
    typeOptions: operationProperty.typeOptions,
    default: operationProperty.default,
    required: operationProperty.required,
    noDataExpression: operationProperty.noDataExpression,
    displayOptions: operationProperty.displayOptions,
  },
  {
    name: 'operation',
    type: 'options',
    typeOptions: { loadOptionsMethod: 'getSerpOperations' },
    default: 'google',
    required: true,
    noDataExpression: true,
    displayOptions: { show: { resource: ['serp'] } },
  },
  'Unexpected node operation property',
);
deepStrictEqual(
  {
    name: parametersProperty.name,
    type: parametersProperty.type,
    default: parametersProperty.default,
    required: parametersProperty.required,
    noDataExpression: parametersProperty.noDataExpression,
    displayOptions: parametersProperty.displayOptions,
    typeOptions: parametersProperty.typeOptions,
  },
  {
    name: 'parameters',
    type: 'resourceMapper',
    default: { mappingMode: 'defineBelow', value: null },
    required: true,
    noDataExpression: true,
    displayOptions: { show: { resource: ['serp'] } },
    typeOptions: {
      loadOptionsDependsOn: ['resource', 'operation'],
      resourceMapper: {
        resourceMapperMethod: 'getSerpParameters',
        mode: 'add',
        fieldWords: { singular: 'parameter', plural: 'parameters' },
        addAllFields: true,
        supportAutoMap: false,
        hideNoDataError: true,
      },
    },
  },
  'Unexpected node parameters property',
);
deepStrictEqual(
  {
    displayName: encodedLocationProperty.displayName,
    name: encodedLocationProperty.name,
    type: encodedLocationProperty.type,
    default: encodedLocationProperty.default,
    required: encodedLocationProperty.required,
    noDataExpression: encodedLocationProperty.noDataExpression,
    displayOptions: encodedLocationProperty.displayOptions,
    typeOptions: encodedLocationProperty.typeOptions,
  },
  {
    displayName: 'Encoded Location',
    name: 'encodedLocationValue',
    type: 'options',
    default: '',
    required: undefined,
    noDataExpression: true,
    displayOptions: {
      show: {
        resource: ['serp'],
        operation: ['google_ai_mode', 'google_web', 'google_local', 'google_jobs'],
      },
    },
    typeOptions: {
      loadOptionsMethod: 'getEncodedLocationOptions',
      loadOptionsDependsOn: ['operation', 'parameters.value.location'],
    },
  },
  'Unexpected node UULE linkage property',
);
deepStrictEqual(
  {
    displayName: multiCountriesProperty.displayName,
    name: multiCountriesProperty.name,
    type: multiCountriesProperty.type,
    typeOptions: multiCountriesProperty.typeOptions,
    default: multiCountriesProperty.default,
    displayOptions: multiCountriesProperty.displayOptions,
  },
  {
    displayName: 'Set Multiple Countries',
    name: 'cr',
    type: 'multiOptions',
    typeOptions: { loadOptionsMethod: 'getMultiCountries' },
    default: [],
    displayOptions: { show: { resource: ['serp'], operation: ['google_web'] } },
  },
  'Unexpected multi-select countries property',
);
deepStrictEqual(
  {
    displayName: multiLanguagesProperty.displayName,
    name: multiLanguagesProperty.name,
    type: multiLanguagesProperty.type,
    typeOptions: multiLanguagesProperty.typeOptions,
    default: multiLanguagesProperty.default,
    displayOptions: multiLanguagesProperty.displayOptions,
  },
  {
    displayName: 'Set Multiple Languages',
    name: 'lr',
    type: 'multiOptions',
    typeOptions: { loadOptionsMethod: 'getMultiLanguages' },
    default: [],
    displayOptions: { show: { resource: ['serp'], operation: ['google_web'] } },
  },
  'Unexpected multi-select languages property',
);
deepStrictEqual(
  {
    name: optionsProperty.name,
    type: optionsProperty.type,
    default: optionsProperty.default,
    placeholder: optionsProperty.placeholder,
    displayOptions: optionsProperty.displayOptions,
    options: optionsProperty.options.map(({ displayName, name, type, default: defaultValue }) => ({
      displayName,
      name,
      type,
      default: defaultValue,
    })),
  },
  {
    name: 'options',
    type: 'collection',
    default: {},
    placeholder: 'Add Option',
    displayOptions: { show: { resource: ['serp'] } },
    options: [{
      displayName: 'Extra Parameters JSON',
      name: 'extraParameters',
      type: 'json',
      default: '{}',
    }],
  },
  'Unexpected node options collection',
);
const extraParametersDescription = optionsProperty.options[0]?.description ?? '';
assert(/override/i.test(extraParametersDescription), 'Extra Parameters description must explain overrides');
assert(/engine/i.test(extraParametersDescription), 'Extra Parameters description must protect engine');
assert(/isjson/i.test(extraParametersDescription), 'Extra Parameters description must protect isjson');
assert(
  typeof node.methods?.loadOptions?.getSerpOperations === 'function',
  'Missing getSerpOperations load-options method',
);
assert(
  typeof node.methods?.loadOptions?.getMultiCountries === 'function',
  'Missing getMultiCountries load-options method',
);
assert(
  typeof node.methods?.loadOptions?.getMultiLanguages === 'function',
  'Missing getMultiLanguages load-options method',
);
assert(
  typeof node.methods?.resourceMapping?.getSerpParameters === 'function',
  'Missing getSerpParameters resource-mapper method',
);
assert(
  typeof node.methods?.loadOptions?.getEncodedLocationOptions === 'function',
  'Missing getEncodedLocationOptions load-options method',
);

const nodeSource = readSource(nodeSourcePath);
const compiledNodeSource = readSource(compiledNodePath);
const serializedDescription = JSON.stringify(nodeDescription);
assert(
  !/NodeConnectionType/.test(compiledNodeSource),
  'Compiled node must not depend on a runtime NodeConnectionType export',
);
for (const [label, source] of [
  ['node source', nodeSource],
  ['compiled node', compiledNodeSource],
  ['compiled node description', serializedDescription],
]) {
  assert(!/web.?scraper|coming\s*soon/i.test(source), `${label} must not contain Web Scraper placeholders`);
}
assert(!/"disabled"/i.test(serializedDescription), 'Compiled node description must not contain disabled resources');
for (const [label, endpoint] of [
  ['credential endpoint', credential.properties.find(({ name }) => name === 'endpoint')?.default],
  ['schema endpoint', SERP_SCHEMA_URL],
]) {
  assert(!/web.?scraper/i.test(String(endpoint)), `${label} must not expose Web Scraper`);
}

const productionTextPaths = [
  'package.json',
  'README.md',
  'LICENSE',
  'index.ts',
  ...listFiles('credentials').filter((file) => file.endsWith('.ts')),
  ...listFiles('nodes').filter((file) => /\.(?:ts|json|svg)$/i.test(file)),
  ...expectedDistFiles,
];
for (const productionPath of productionTextPaths) {
  const source = readSource(productionPath);
  assert(!legacyBrandPattern.test(source), `${productionPath} contains legacy branding`);
  assert(!credentialPattern.test(source), `${productionPath} contains credential-shaped material`);
}

validateTrackedText();

const nodeMetadata = readJson(nodeMetadataPath);
assert(nodeMetadata.node === 'n8n-nodes-thordata.thordata', 'Unexpected node metadata identity');
assert(nodeMetadata.nodeVersion === '1.0', 'Unexpected node metadata version');
assert(nodeMetadata.codexVersion === '1.0', 'Unexpected node codex version');
assert(nodeMetadata.categories?.includes('Data & Storage'), 'Missing node metadata category');
for (const documentationType of ['primaryDocumentation', 'credentialDocumentation']) {
  assert(
    nodeMetadata.resources?.[documentationType]?.some(
      ({ url }) => url === 'https://doc.thordata.com',
    ),
    `Missing ${documentationType} URL`,
  );
}

const iconSource = readSource(iconPath);
assert(/<svg\b/i.test(iconSource), 'Node icon must contain an SVG root');
assert(!/<script\b/i.test(iconSource), 'Node icon must not contain scripts');
assert(
  !/https?:\/\//i.test(iconSource.replace('http://www.w3.org/2000/svg', '')),
  'Node icon must not contain external URLs',
);
assert(!credentialPattern.test(iconSource), 'Node icon must not contain credential-shaped material');
assert(!legacyBrandPattern.test(iconSource), 'Node icon must not contain legacy branding');

for (const assetPath of [nodeMetadataPath, iconPath]) {
  const builtAssetPath = `dist/${assetPath}`;
  assert(exists(builtAssetPath), `Missing built asset: ${builtAssetPath}`);
  deepStrictEqual(
    readFileSync(resolve(packageRoot, builtAssetPath)),
    readFileSync(resolve(packageRoot, assetPath)),
    `Built asset differs from source: ${builtAssetPath}`,
  );
}

const npmCli = resolveNpmCli();
const packResult = spawnSync(
  process.execPath,
  [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts'],
  {
    cwd: packageRoot,
    encoding: 'utf8',
    shell: false,
  },
);
assert(packResult.error === undefined, `npm pack failed to start: ${packResult.error?.message ?? ''}`);
assert(packResult.status === 0, `npm pack exited with status ${String(packResult.status)}`);

let packOutput;
try {
  packOutput = JSON.parse(packResult.stdout.replace(/^\uFEFF/u, '').trim());
} catch {
  throw new Error('npm pack did not return valid JSON');
}
assert(Array.isArray(packOutput) && packOutput.length === 1, 'npm pack must describe one package');
const [packedPackage] = packOutput;
assert(!packedPackage.error, `npm pack reported an error: ${String(packedPackage.error)}`);
assert(packedPackage.size > 0, 'Packed package size must be positive');
assert(packedPackage.unpackedSize > 0, 'Packed unpackedSize must be positive');
assert(Array.isArray(packedPackage.files), 'npm pack file list is missing');

const packedFiles = packedPackage.files
  .map(({ path }) => String(path).replace(/\\/g, '/').replace(/^package\//u, ''))
  .sort();
const expectedPackedFiles = ['package.json', 'README.md', 'LICENSE', ...expectedDistFiles].sort();
deepStrictEqual(packedFiles, expectedPackedFiles, 'Unexpected npm package contents');
for (const packedFile of packedFiles) {
  assert(
    !/^(?:credentials|nodes|scripts|test|tests|docs)(?:\/|$)|(?:^|\/)\.env|\.(?:ts|map|tgz|tmp|temp)$/i.test(packedFile),
    `Forbidden file in npm package: ${packedFile}`,
  );
}
