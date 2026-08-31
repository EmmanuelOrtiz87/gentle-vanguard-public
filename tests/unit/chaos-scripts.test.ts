import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('chaos-scripts', () => {
  it('resilience-handler.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'resilience', 'resilience-handler.ts')));
  });

  it('session-scoring.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'session', 'session-scoring.ts')));
  });
});
