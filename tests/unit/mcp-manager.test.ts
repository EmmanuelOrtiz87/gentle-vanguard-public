import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('mcp-manager', () => {
  it('src/mcp-manager.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'mcp', 'mcp-manager.ts')));
  });

  it('src/mcp-bridge.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'mcp', 'mcp-bridge.ts')));
  });
});
