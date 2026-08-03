import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('scripts', () => {
  it('src/session-start-optimized.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'session-start-optimized.ts')));
  });

  it('src/token-budget-guard.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'token-budget-guard.ts')));
  });
});
