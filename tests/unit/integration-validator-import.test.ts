import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

test('importing integration-validator does not execute its CLI', () => {
  const output = execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      "await import('./src/security/integration-validator.ts');",
    ],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true },
  );

  assert.strictEqual(output, '');
});
