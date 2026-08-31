import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('cli-tools', () => {
  it('detect-tool.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'core', 'detect-tool.ts')));
  });

  it('pre-process-input.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'tools', 'pre-process-input.ts')));
  });
});
