import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('routing-flow', () => {
  it('src/ml-router.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'ml-router.ts')));
  });

  it('src/adaptive-router.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'adaptive-router.ts')));
  });
});
