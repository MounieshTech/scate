#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distCli = path.resolve(__dirname, '../dist/cli.js');

if (existsSync(distCli)) {
  const { run } = await import(distCli);
  await run(process.argv);
} else {
  const { register } = await import('tsx/esm/api');
  register();
  const { run } = await import('../src/cli.ts');
  await run(process.argv);
}
