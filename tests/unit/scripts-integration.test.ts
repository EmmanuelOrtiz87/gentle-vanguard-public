import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('scripts-integration', () => {
  it('src/audit-pipeline.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'infrastructure', 'audit-pipeline.ts')));
  });

  it('src/privacy-gateway.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'security', 'privacy-gateway.ts')));
  });
});
