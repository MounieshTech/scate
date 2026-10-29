import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseEnvContent, isExampleEnvFile, discoverEnvFiles } from '../src/discover-env-files.ts';
import { scanSource } from '../src/scan-source.ts';
import { mergeStatus } from '../src/merge-status.ts';
import { renderTable } from '../src/output-table.ts';
import { writeJsonOutput } from '../src/output-json.ts';
import { run } from '../src/cli.ts';
import type { EnvFileResult, UsageResult, ScateRow } from '../src/types.ts';

const execFileAsync = promisify(execFile);

test('1. parseEnvContent handles comments, quotes, exports, and empty values', () => {
  const sampleEnv = `
# A comment line
export APP_PORT=3000 # inline comment
DATABASE_URL="postgres://user:pass@localhost:5432/mydb"
SECRET_KEY='my-secret-value'
EMPTY_VAL=
WHITESPACE_KEY = spaced_value
`;

  const parsed = parseEnvContent(sampleEnv);

  assert.equal(parsed.size, 5);
  assert.equal(parsed.get('APP_PORT')?.rawValue, '3000');
  assert.equal(parsed.get('DATABASE_URL')?.rawValue, 'postgres://user:pass@localhost:5432/mydb');
  assert.equal(parsed.get('SECRET_KEY')?.rawValue, 'my-secret-value');
  assert.equal(parsed.get('EMPTY_VAL')?.rawValue, '');
  assert.equal(parsed.get('WHITESPACE_KEY')?.rawValue, 'spaced_value');
});

test('2. isExampleEnvFile distinguishes example files from real env files', () => {
  assert.equal(isExampleEnvFile('.env.example'), true);
  assert.equal(isExampleEnvFile('.env.sample'), true);
  assert.equal(isExampleEnvFile('.env.local.example'), true);

  assert.equal(isExampleEnvFile('.env'), false);
  assert.equal(isExampleEnvFile('.env.local'), false);
  assert.equal(isExampleEnvFile('.env.production'), false);
  assert.equal(isExampleEnvFile('.env.development'), false);
  assert.equal(isExampleEnvFile('.env.test'), false);
});

test('3. mergeStatus correctly assigns all 5 statuses in priority order', () => {
  const envFiles: EnvFileResult[] = [
    {
      filePath: '.env',
      absolutePath: '/app/.env',
      isExample: false,
      variables: new Map([
        ['OK_VAR', { variable: 'OK_VAR', line: 1, rawValue: 'val' }],
        ['UNUSED_VAR', { variable: 'UNUSED_VAR', line: 2, rawValue: 'val' }],
      ]),
    },
    {
      filePath: '.env.example',
      absolutePath: '/app/.env.example',
      isExample: true,
      variables: new Map([
        ['EXAMPLE_ONLY', { variable: 'EXAMPLE_ONLY', line: 1, rawValue: 'val' }],
        ['MISSING_VAR', { variable: 'MISSING_VAR', line: 2, rawValue: 'val' }],
      ]),
    },
  ];

  const sourceUsage: UsageResult = {
    usages: [
      { variable: 'OK_VAR', file: 'src/main.ts', line: 10 },
      { variable: 'MISSING_VAR', file: 'src/main.ts', line: 15 },
      { variable: 'CODE_ONLY_VAR', file: 'src/api.ts', line: 20 },
    ],
    dynamicUsages: [
      { file: 'src/config.ts', line: 5, expression: 'dynamicKey' },
    ],
    scannedFilesCount: 3,
    candidateFilesCount: 3,
  };

  const rows = mergeStatus(envFiles, sourceUsage);

  const rowMap = new Map(rows.map((r) => [r.variable, r]));

  // 1. Dynamic — review manually
  const dynRow = rowMap.get('[dynamic: dynamicKey]');
  assert.ok(dynRow);
  assert.equal(dynRow.status, 'Dynamic — review manually');

  // 2. OK: defined in real .env and used in code
  const okRow = rowMap.get('OK_VAR');
  assert.ok(okRow);
  assert.equal(okRow.status, 'OK');

  // 3. Missing: referenced in code, not defined in any real .env* file
  const missingRow = rowMap.get('MISSING_VAR');
  assert.ok(missingRow);
  assert.equal(missingRow.status, 'Missing');

  const codeOnlyRow = rowMap.get('CODE_ONLY_VAR');
  assert.ok(codeOnlyRow);
  assert.equal(codeOnlyRow.status, 'Missing');

  // 4. Not filled in locally: present in .env.example only, absent from real .env*
  const exampleRow = rowMap.get('EXAMPLE_ONLY');
  assert.ok(exampleRow);
  assert.equal(exampleRow.status, 'Not filled in locally');

  // 5. Unused: defined in real .env*, never referenced in code
  const unusedRow = rowMap.get('UNUSED_VAR');
  assert.ok(unusedRow);
  assert.equal(unusedRow.status, 'Unused');
});

test('4. AST scanner detects complex patterns: destructuring with rename, rest, computed, and import.meta.env', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scate-ast-'));
  try {
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(
      path.join(srcDir, 'patterns.ts'),
      `
      // Renamed destructuring
      const { API_TOKEN: myToken, REDIS_PORT } = process.env;

      // Destructuring from import.meta.env
      const { VITE_TITLE } = import.meta.env;

      // Rest and computed destructuring
      const key = 'CUSTOM';
      const { [key]: computedVal, ...restOfEnv } = process.env;

      // Assignment destructuring
      let PORT: string | undefined;
      ({ PORT } = process.env);
      `,
    );

    const usageResult = await scanSource(tempDir);

    const usedVars = new Set(usageResult.usages.map((u) => u.variable));
    assert.ok(usedVars.has('API_TOKEN'));
    assert.ok(usedVars.has('REDIS_PORT'));
    assert.ok(usedVars.has('VITE_TITLE'));
    assert.ok(usedVars.has('PORT'));

    // Dynamic usages should capture computed and rest
    assert.ok(usageResult.dynamicUsages.length >= 2);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('5. Discover env files respects .gitignore for directories while discovering .env files', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scate-gitignore-'));
  try {
    // Write a .gitignore that ignores node_modules and .env (standard practice)
    fs.writeFileSync(
      path.join(tempDir, '.gitignore'),
      `node_modules/
dist/
.env
ignored_dir/
`,
    );

    // Write real .env at root
    fs.writeFileSync(path.join(tempDir, '.env'), 'ROOT_KEY=value\n');

    // Write .env.local at root
    fs.writeFileSync(path.join(tempDir, '.env.local'), 'LOCAL_KEY=value\n');

    // Write ignored directory with .env inside it
    const ignoredDir = path.join(tempDir, 'ignored_dir');
    fs.mkdirSync(ignoredDir, { recursive: true });
    fs.writeFileSync(path.join(ignoredDir, '.env'), 'SHOULD_BE_IGNORED=val\n');

    const discovered = await discoverEnvFiles(tempDir);
    const files = discovered.map((f) => f.filePath);

    // .env and .env.local at root MUST be discovered
    assert.ok(files.includes('.env'));
    assert.ok(files.includes('.env.local'));

    // ignored_dir/.env MUST NOT be discovered
    assert.ok(!files.includes('ignored_dir/.env'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('6. Specific file audit mode (--file <path>)', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scate-file-mode-'));
  try {
    fs.writeFileSync(path.join(tempDir, '.env.custom'), 'CUSTOM_PORT=9000\nUNUSED_CUSTOM=val\n');
    fs.writeFileSync(path.join(tempDir, '.env'), 'OTHER_PORT=8000\n');

    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'app.ts'), 'console.log(process.env.CUSTOM_PORT);');

    // Audit only .env.custom
    const envFiles = await discoverEnvFiles(tempDir, path.join(tempDir, '.env.custom'));
    assert.equal(envFiles.length, 1);
    assert.equal(envFiles[0].filePath, '.env.custom');

    const sourceUsage = await scanSource(tempDir);
    const rows = mergeStatus(envFiles, sourceUsage);

    const rowMap = new Map(rows.map((r) => [r.variable, r]));
    assert.equal(rowMap.get('CUSTOM_PORT')?.status, 'OK');
    assert.equal(rowMap.get('UNUSED_CUSTOM')?.status, 'Unused');
    assert.equal(rowMap.has('OTHER_PORT'), false); // Not in .env.custom
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('7. End-to-end fixture: AST scan + .env discovery + CLI output table and JSON', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scate-test-'));

  try {
    fs.writeFileSync(
      path.join(tempDir, '.env'),
      `DATABASE_URL="postgres://localhost/test"
PORT=8080
UNUSED_VAR=secret`,
    );

    fs.writeFileSync(
      path.join(tempDir, '.env.example'),
      `DATABASE_URL=
PORT=
TEMPLATE_ONLY=token`,
    );

    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(
      path.join(srcDir, 'index.ts'),
      `
// 1. Property access
const db = process.env.DATABASE_URL;

// 2. Element access
const port = process.env['PORT'];

// 3. Destructuring
const { MISSING_AUTH_TOKEN } = process.env;

// 4. import.meta.env
const apiUrl = import.meta.env.VITE_API_URL;

// 5. Dynamic non-literal access
const someKey = 'FOO';
const dyn = process.env[someKey];
`,
    );

    const envFiles = await discoverEnvFiles(tempDir);
    assert.equal(envFiles.length, 2);

    const sourceUsage = await scanSource(tempDir);
    assert.equal(sourceUsage.usages.length, 4);
    assert.equal(sourceUsage.dynamicUsages.length, 1);

    const rows = mergeStatus(envFiles, sourceUsage);

    const tableStr = renderTable(rows, { colors: false });
    assert.ok(tableStr.includes('DATABASE_URL'));
    assert.ok(tableStr.includes('PORT'));
    assert.ok(tableStr.includes('OK'));
    assert.ok(tableStr.includes('Missing'));
    assert.ok(tableStr.includes('Not filled in locally'));
    assert.ok(tableStr.includes('Unused'));
    assert.ok(tableStr.includes('Dynamic — review manually'));

    const outJsonPath = path.join(tempDir, 'out.json');
    await writeJsonOutput(outJsonPath, rows);

    const jsonRead = JSON.parse(fs.readFileSync(outJsonPath, 'utf8')) as ScateRow[];
    assert.equal(Array.isArray(jsonRead), true);
    assert.equal(jsonRead.length, rows.length);

    const statusCounts = new Set(jsonRead.map((r) => r.status));
    assert.ok(statusCounts.has('OK'));
    assert.ok(statusCounts.has('Missing'));
    assert.ok(statusCounts.has('Not filled in locally'));
    assert.ok(statusCounts.has('Unused'));
    assert.ok(statusCounts.has('Dynamic — review manually'));

    // Test CLI invocation with --folder and --o
    const cliJsonPath = path.join(tempDir, 'cli-out.json');
    await run(['node', 'scate', '--folder', tempDir, '--o', cliJsonPath]);

    assert.ok(fs.existsSync(cliJsonPath));
    const cliJson = JSON.parse(fs.readFileSync(cliJsonPath, 'utf8'));
    assert.equal(cliJson.length, rows.length);

    // Test executing bin/scate.js directly via child_process
    const binPath = path.resolve(process.cwd(), 'bin/scate.js');
    const childJsonPath = path.join(tempDir, 'child-out.json');
    await execFileAsync('node', [binPath, '--folder', tempDir, '--o', childJsonPath]);

    assert.ok(fs.existsSync(childJsonPath));
    const childJson = JSON.parse(fs.readFileSync(childJsonPath, 'utf8'));
    assert.equal(childJson.length, rows.length);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
