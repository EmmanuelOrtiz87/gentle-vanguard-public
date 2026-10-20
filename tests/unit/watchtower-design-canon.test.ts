import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const CHECK = resolve(ROOT, 'src', 'core', 'watchtower', 'checks-design-canon.ts');

describe('watchtower design canon check', () => {
  it('runs conformance directly through Node without a shell', () => {
    const source = readFileSync(CHECK, 'utf8');

    assert.match(
      source,
      /spawnSync\(process\.execPath,\s*\[\s*'--import',\s*'tsx',\s*'src\/cli\/conformance\.ts'\s*\]/,
    );
    assert.doesNotMatch(source, /shell:\s*process\.platform/);
  });
});
