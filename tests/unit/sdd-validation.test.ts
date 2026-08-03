import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('sdd-validation', () => {
  it('src/check-sdd-gate.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'check-sdd-gate.ts')));
  });

  it('src/sdd-pipeline.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'sdd-pipeline.ts')));
  });
});
