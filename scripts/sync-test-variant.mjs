#!/usr/bin/env node
/**
 * 从正式包再生成测试环境变体。
 *
 * 正式包（本目录）是唯一权威来源；测试变体只是把两个域名换掉：
 *   - SERP 请求端点：https://scraperapi.thordata.com/request
 *                 → http://serp-dev-test.thordata.com/request_testasdadsa
 *   - schema 接口：  https://api.thordata.com/serp/playground/schema?lang=en
 *                 → http://api-dev-test.thordata.com/serp/playground/schema?lang=en
 * 测试/校验脚本里对这两个域名的断言、README 文案会一并改写。
 *
 * 用法：node scripts/sync-test-variant.mjs [--target <目录>]
 * 默认目标：与本包同级的 n8n-nodes-thordata-testenv
 *
 * 注意：目标目录里的 n8n-instance（本地 n8n 实例与数据）不会被删除或覆盖。
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

// 这些是构建产物 / 依赖 / 本地实例，不参与同步
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
  throw new Error(`目标目录不存在：${TARGET_ROOT}（请先创建并放入 n8n-instance/credentials 等本机数据）`);
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

console.log(`测试变体已同步：${TARGET_ROOT}`);
console.log(`  写入/更新 ${written} 个文件，未变化 ${unchanged} 个，域名替换 ${substituted} 处`);
console.log('  接着在变体目录执行：npm run verify（会重新 build + lint + test）');
