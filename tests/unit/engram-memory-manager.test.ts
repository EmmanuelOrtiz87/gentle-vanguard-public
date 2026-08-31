import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('engram-memory-manager', () => {
  it('engram-integrity-check.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'knowledge', 'engram-integrity-check.ts')));
  });

  it('engram-auto-sync.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'knowledge', 'engram-auto-sync.ts')));
  });
});
