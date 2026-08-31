import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('gv-init', () => {
  it('src/infrastructure/bootstrap.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'infrastructure', 'bootstrap.ts')));
  });

  it('src/ops/setup-complete.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'ops', 'setup-complete.ts')));
  });
});
