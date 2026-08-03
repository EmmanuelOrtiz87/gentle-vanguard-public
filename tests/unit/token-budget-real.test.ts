import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('token-budget-real', () => {
  it('src/token-usage-notifier.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'token-usage-notifier.ts')));
  });

  it('src/token-metrics-store.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'token-metrics-store.ts')));
  });
});
