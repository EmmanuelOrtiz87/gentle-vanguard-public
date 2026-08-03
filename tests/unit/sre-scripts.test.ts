import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('sre-scripts', () => {
  it('src/enforce-error-budget.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'enforce-error-budget.ts')));
  });

  it('src/resilience-handler.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'resilience-handler.ts')));
  });
});
