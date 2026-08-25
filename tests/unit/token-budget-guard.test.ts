import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('token-budget-guard', () => {
  it('src/tokens/token-budget-guard.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'tokens', 'token-budget-guard.ts')));
  });

  it('src/tokens/token-usage-auto.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'tokens', 'token-usage-auto.ts')));
  });
});
