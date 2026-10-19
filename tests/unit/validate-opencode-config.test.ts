import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..', '..');
const VALIDATOR = join(ROOT, 'src', 'tools', 'validate-opencode-config.ts');

function baseConfig(mcp: Record<string, unknown>): Record<string, unknown> {
  const agent = {
    orchestrator: { mode: 'primary', model: 'opencode/test-model', steps: 12 },
    'sdd-explore': { mode: 'subagent', model: 'opencode/test-model', steps: 8 },
    'sdd-design': { mode: 'subagent', model: 'opencode/test-model', steps: 8 },
    'sdd-apply': { mode: 'subagent', model: 'opencode/test-model', steps: 8 },
    'sdd-verify': { mode: 'subagent', model: 'opencode/test-model', steps: 8 },
  };
  return {
    agent,
    mcp,
    tools: {
      bash: true,
      readFile: true,
      writeFile: true,
      editFile: true,
      listFiles: true,
    },
    compaction: { auto: true },
    watcher: { ignore: ['node_modules/**'] },
  };
}

function runValidator(config: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'gv-opencode-config-'));
  const configPath = join(dir, 'opencode.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  try {
    return spawnSync(process.execPath, ['--import', 'tsx', VALIDATOR, '--config', configPath], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('validate-opencode-config accepts remote MCP services with a URL', () => {
  const result = runValidator(
    baseConfig({
      mercadopago: {
        type: 'remote',
        url: 'https://mcp.mercadopago.com/mcp',
        enabled: true,
      },
    }),
  );

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stdout, /PASS/);
});

test('validate-opencode-config rejects remote MCP services without a URL', () => {
  const result = runValidator(
    baseConfig({
      broken: {
        type: 'remote',
        enabled: true,
      },
    }),
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /MCP service broken with type remote requires url/);
});
