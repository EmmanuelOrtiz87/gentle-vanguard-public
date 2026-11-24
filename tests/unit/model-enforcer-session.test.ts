import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runSync } from '../../src/core/run-command.js';

test('enforcer CLI selects a model without rewriting the canonical OpenCode config', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-enforcer-session-'));
  const source = resolve(import.meta.dirname, '../..');
  const selected = 'ollama/test-tools';
  const canonical = JSON.stringify({
    agent: { pinned: { model: 'old/model' }, inherited: { description: 'keep' } },
  });
  try {
    mkdirSync(join(root, 'config'));
    mkdirSync(join(root, '.runtime'));
    writeFileSync(join(root, 'opencode.json'), canonical);
    writeFileSync(
      join(root, 'config/model-preference.json'),
      JSON.stringify({ preferredModel: selected, preferredProvider: 'ollama' }),
    );
    writeFileSync(
      join(root, 'config/model-health-registry.json'),
      JSON.stringify({
        models: {
          [selected]: {
            provider: 'ollama',
            capabilities: ['tools'],
            health: { status: 'available' },
            costPer1kTokens: { input: 0, output: 0 },
          },
        },
        routingRules: { orchestrator: { primary: selected }, subagents: { default: selected } },
      }),
    );
    const result = runSync(
      process.execPath,
      [
        '--import',
        pathToFileURL(join(source, 'node_modules/tsx/dist/loader.mjs')).href,
        join(source, 'src/ml/model-enforcer.ts'),
        '--apply',
      ],
      { cwd: root, timeout: 20000 },
    );
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(readFileSync(join(root, 'opencode.json'), 'utf8'), canonical);
    assert.equal(
      JSON.parse(readFileSync(join(root, '.runtime/model-active.json'), 'utf8')).model,
      selected,
    );
    const session = JSON.parse(
      readFileSync(join(root, '.runtime/opencode/session-opencode.json'), 'utf8'),
    );
    assert.equal(session.model, selected);
    assert.equal(session.agent.pinned.model, selected);
    assert.deepEqual(session.agent.inherited, { description: 'keep' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
