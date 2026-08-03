import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('optimize-engram-usage', () => {
  it('src/engram-rag-reindex.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'engram-rag-reindex.ts')));
  });

  it('src/engram-auto-update.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'engram-auto-update.ts')));
  });
});
