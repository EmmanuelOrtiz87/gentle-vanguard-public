import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('sdd-validation', () => {
  it('src/sdd/check-sdd-gate.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'sdd', 'check-sdd-gate.ts')));
  });

  it('src/sdd/sdd-pipeline.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'sdd', 'sdd-pipeline.ts')));
  });
});
