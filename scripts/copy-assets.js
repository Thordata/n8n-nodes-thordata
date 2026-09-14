const { copyFileSync, mkdirSync } = require('node:fs');
const { dirname, resolve } = require('node:path');

const packageRoot = resolve(__dirname, '..');
const assetMappings = [
  {
    source: resolve(packageRoot, 'nodes', 'Thordata', 'thordata.svg'),
    target: resolve(packageRoot, 'dist', 'nodes', 'Thordata', 'thordata.svg'),
  },
  {
    source: resolve(packageRoot, 'nodes', 'Thordata', 'Thordata.node.json'),
    target: resolve(packageRoot, 'dist', 'nodes', 'Thordata', 'Thordata.node.json'),
  },
];

for (const { source, target } of assetMappings) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}
