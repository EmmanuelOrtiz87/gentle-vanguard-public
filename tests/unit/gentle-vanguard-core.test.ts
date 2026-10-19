import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('gentle-vanguard-core', () => {
  it('src/core/session-autostart.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'core', 'session-autostart.ts')));
  });

  it('src/health-check.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'core', 'health-check.ts')));
  });

  it('src/maintenance-watchtower.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'core', 'maintenance-watchtower.ts')));
  });

  it('health-check skips direct Engram doctor when MCP is active', () => {
    const src = readFileSync(resolve(ROOT, 'src', 'core', 'health-check.ts'), 'utf-8');

    assert.match(src, /function isEngramMcpRunning/);
    assert.match(src, /CLI doctor skipped to avoid DB lock/);
    assert.match(src, /'--project', 'gentle-vanguard'/);
  });

  it('MCP quickstart templates do not reference unverified packages', () => {
    const src = readFileSync(resolve(ROOT, 'config', 'mcp-templates.json'), 'utf-8');

    assert.doesNotMatch(src, /@modelcontextprotocol\/server-sqlite/);
    assert.doesNotMatch(src, /@modelcontextprotocol\/server-git/);
  });
});
