#!/usr/bin/env node
/**
 * Regenerates the test-environment variant from the production package.
 *
 * The production package (this directory) is the single source of truth; the test variant only
 * swaps two domains:
 *   - SERP request endpoint: https://scraperapi.thordata.com/request
 *                 -> http://serp-dev-test.thordata.com/request_testasdadsa
 *   - schema endpoint:       https://api.thordata.com/serp/playground/schema?lang=en
 *                 -> http://api-dev-test.thordata.com/serp/playground/schema?lang=en
 * Assertions on these two domains in the test/validation scripts, and the README wording, are
 * rewritten as well.
 *
 * Usage: node scripts/sync-test-variant.mjs [--target <dir>]
 * Default target: n8n-nodes-thordata-testenv, a sibling of this package
 *
 * Note: n8n-instance (the local n8n instance and its data) inside the target directory is never
 * deleted or overwritten.
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

// Build output, dependencies and the local instance are not part of the sync
const SKIP_ENTRIES = new Set(['node_modules', 'dist', '.git', 'n8n-instance', 'coverage']);
const SKIP_FILE = /\.tgz$/;

const SUBSTITUTIONS = [
  [
    'https://scraperapi.thordata.com/request',
    'http://serp-dev-test.thordata.com/request_testasdadsa',
  ],
  [
    'https://api.thordata.com/serp/playground/schema?lang=en',
    'http://api-dev-test.thordata.com/serp/playground/schema?lang=en',
  ],
  [
    'community node for Thordata.',
    "community node for Thordata's test environment.",
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
  throw new Error(
    `Target directory does not exist: ${TARGET_ROOT} ` +
      '(create it first and add local data such as n8n-instance/credentials inside)',
  );
}

let written = 0;
let unchanged = 0;
let substituted = 0;

for (const rel of walkFiles(PACKAGE_ROOT)) {
  const source = readFileSync(join(PACKAGE_ROOT, rel), 'utf8').split('\r\n').join('\n');
  let next = source;
  for (const [from, to] of SUBSTITUTIONS) {
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
console.log(`  ${written} files written or updated, ${unchanged} unchanged, ${substituted} domain replacements`);
console.log('  Next, run npm run verify inside the variant directory (rebuilds and reruns lint + test)');
