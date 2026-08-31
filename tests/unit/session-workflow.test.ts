import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('session-workflow', () => {
  it('src/session-scoring.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'session', 'session-scoring.ts')));
  });

  it('src/session-reference-system.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'session', 'session-reference-system.ts')));
  });
});
