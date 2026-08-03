import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('agent-router', () => {
  it('agent-message-bus.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'agent-message-bus.ts')));
  });

  it('adaptive-router.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'adaptive-router.ts')));
  });
});
