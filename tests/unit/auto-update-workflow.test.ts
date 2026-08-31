import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('auto-update-workflow', () => {
  it('auto-update.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'tools', 'auto-update.ts')));
  });
});
