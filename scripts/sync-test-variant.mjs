#!/usr/bin/env node
/**
 * Regenerate the test-environment variant from the production package.
 *
 * The production package is the source of truth for code; public Web Scraper snapshots remain environment-specific:
 *   - SERP request endpoint: https://scraperapi.thordata.com/request
 *                 → http://serp-dev-test.thordata.com/request_testasdadsa
 *   - schema API:          https://api.thordata.com/serp/playground/schema?lang=en
 *                 → http://api-dev-test.thordata.com/serp/playground/schema?lang=en
 *   - Dataset API base URL: https://api.thordata.com/api/n8n
 *                 → http://api-dev-test.thordata.com/api/n8n
 * Assertions on those domains in the test/validation scripts and the README wording are rewritten too.
 *
 * Usage: node scripts/sync-test-variant.mjs [--target <directory>]
 * Default target: n8n-nodes-thordata-testenv, next to this package
 *
 * Note: n8n-instance (the local n8n instance and its data) inside the target is never deleted or overwritten.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const targetFlag = args.indexOf('--target');
const TARGET_ROOT = targetFlag >= 0 && args[targetFlag + 1]
  ? resolve(args[targetFlag + 1])
  : resolve(PACKAGE_ROOT, '..', 'n8n-nodes-thordata-testenv');

// Build artifacts, dependencies and the local instance are not synced
const SKIP_ENTRIES = new Set(['node_modules', 'dist', '.git', 'n8n-instance', '8n-instance', 'coverage']);
const SKIP_FILE = /\.tgz$/;

const SUBSTITUTIONS = [
  ['This source adds seven Web Scraper actions', 'This test-environment source adds seven Web Scraper actions'],
  ['https://api.thordata.com/web-scraper/schema', 'http://api-dev-test.thordata.com/web-scraper/schema'],
  ['https://api.thordata.com/api/web-scraper-api', 'http://api-dev-test.thordata.com/api/web-scraper-api'],
  ['https://scraperapi.thordata.com/builder', 'http://serp-dev-test.thordata.com/builder'],
  ['https://scraperapi.thordata.com/download', 'http://serp-dev-test.thordata.com/download'],
  [
    'https://scraperapi.thordata.com/request',
    'http://serp-dev-test.thordata.com/request_testasdadsa',
  ],
  [
    'https://api.thordata.com/serp/playground/schema?lang=en',
    'http://api-dev-test.thordata.com/serp/playground/schema?lang=en',
  ],
  [
    'https://api.thordata.com/api/n8n',
    'http://api-dev-test.thordata.com/api/n8n',
  ],
  [
    'community node for Thordata.',
    "community node for Thordata's test environment.",
  ],
  [
    'uses the production Dataset API host',
    'uses the test Dataset API host',
  ],
];

function walkFiles(root, dir = root, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_ENTRIES.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(root, full, out);
    else if (!SKIP_FILE.test(entry)) out.push(relative(root, full).split('\\').join('/'));
  }
  return out.sort();
}

if (!existsSync(TARGET_ROOT)) {
  throw new Error(`Target directory does not exist: ${TARGET_ROOT} (create it and put the local n8n-instance/credentials data there first)`);
}

let written = 0;
let unchanged = 0;
let substituted = 0;

for (const rel of walkFiles(PACKAGE_ROOT)) {
  // Each environment generates its own public schema snapshot; the production one must not
  // overwrite the test one.
  if (rel === 'nodes/Thordata/web-scraper-schema.snapshot.json') continue;
  // Keep the test environment's dependency lock; dependency changes are installed there explicitly.
  if (rel === 'package-lock.json' && existsSync(join(TARGET_ROOT, rel))) continue;
  const source = readFileSync(join(PACKAGE_ROOT, rel), 'utf8').split('\r\n').join('\n');
  let next = source;
  // The sync script keeps its original substitution rules so that replacing its own strings never
  // breaks quotes or mappings.
  const substitutions = rel === 'scripts/sync-test-variant.mjs' ? [] : SUBSTITUTIONS;
  for (const [from, to] of substitutions) {
    if (next.includes(from)) {
      next = next.split(from).join(to);
      substituted += 1;
    }
  }
  const destination = join(TARGET_ROOT, rel);
  mkdirSync(dirname(destination), { recursive: true });
  if (existsSync(destination) && readFileSync(destination, 'utf8').split('\r\n').join('\n') === next) {
    unchanged += 1;
    continue;
  }
  writeFileSync(destination, next, 'utf8');
  written += 1;
}

console.log(`Test variant synced: ${TARGET_ROOT}`);
console.log(`  wrote/updated ${written} files, ${unchanged} unchanged, ${substituted} domain replacements`);
console.log('  Next, run npm run verify in the variant directory (rebuilds, lints and tests).');
console.log('  Refresh the test Web Scraper snapshot first: npm run update:web-scraper-schema');
