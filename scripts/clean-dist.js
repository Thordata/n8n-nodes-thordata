const { rmSync } = require('node:fs');
const { resolve } = require('node:path');

const packageRoot = resolve(__dirname, '..');
const distDirectory = resolve(packageRoot, 'dist');

rmSync(distDirectory, { recursive: true, force: true });
