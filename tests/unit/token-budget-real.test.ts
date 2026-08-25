import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('token-budget-real', () => {
  it('src/tokens/token-usage-notifier.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'tokens', 'token-usage-notifier.ts')));
  });

  it('src/tokens/token-metrics-store.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'tokens', 'token-metrics-store.ts')));
  });
});
