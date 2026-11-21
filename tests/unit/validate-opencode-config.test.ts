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

test('validate-opencode-config accepts nested OpenCode MCP servers with argv commands', () => {
  const result = runValidator({
    ...baseConfig({
      servers: {
        harness: { type: 'local', command: ['node', '--import', 'tsx', 'server.ts'] },
      },
    }),
    tools: { bash: true, read: true, write: true, edit: true, list: true },
  });
  assert.equal(result.status, 0, result.stdout);
});

test('validate-opencode-config rejects invalid argv in a nested MCP server', () => {
  const result = runValidator(
    baseConfig({
      servers: { broken: { type: 'local', command: ['node', 3] } },
    }),
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /MCP service broken with type local requires command/);
});

// Canon 2026-11-21 (commit f54ee2a07): los agentes SIN pin heredan el modelo de
// la sesión. El validador no debe exigir `model` — exigirlo rompía la herencia
// y fallaba el step required opencode-config-validate en cada autostart.
test('validate-opencode-config accepts the inheritance canon (orchestrator without model pin)', () => {
  const config = baseConfig({});
  const agent = config.agent as Record<string, Record<string, unknown>>;
  delete agent.orchestrator.model;
  const result = runValidator(config);
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stdout, /PASS/);
});

test('validate-opencode-config rejects a non-string model when a pin is present', () => {
  const config = baseConfig({});
  const agent = config.agent as Record<string, Record<string, unknown>>;
  agent.orchestrator.model = 42;
  const result = runValidator(config);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /model must be a string/);
});

// Finding interrogate 2026-11-21 #1: la forma PURA del canon (cero pins,
// todos heredan) es válida — exigir "al menos un pin" rompía el canon.
test('validate-opencode-config accepts pure-heritage canon (zero model pins anywhere)', () => {
  const config = baseConfig({});
  const agent = config.agent as Record<string, Record<string, unknown>>;
  for (const a of Object.values(agent)) delete a.model;
  const result = runValidator(config);
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stdout, /PASS/);
  assert.match(result.stdout, /herencia pura/);
});

// Finding interrogate 2026-11-21 #2: un pin inválido en un SUBAGENTE no pasa
// en silencio — era invisible para el validador Y para el guard a la vez.
test('validate-opencode-config rejects a non-string model pin on a subagent', () => {
  const config = baseConfig({});
  const agent = config.agent as Record<string, Record<string, unknown>>;
  agent.orchestrator = { mode: 'primary', steps: 12 };
  agent['sdd-explore'].model = 42;
  const result = runValidator(config);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /sdd-explore.model must be a string/);
});

// Consistencia con el guard: `""` se clasifica como herencia en ambas
// herramientas (finding interrogate #3 — la asimetría era el defecto).
test('validate-opencode-config accepts an empty-string model as inheritance (guard-consistent)', () => {
  const config = baseConfig({});
  const agent = config.agent as Record<string, Record<string, unknown>>;
  agent['sdd-verify'].model = '';
  const result = runValidator(config);
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stdout, /PASS/);
});

// ─── Findings del juez A (review release v4.6.0) ─────────────────────────────

import { validateOpencodeConfigObject } from '../../src/tools/validate-opencode-config.ts';

test('rejects a non-string top-level model (session model corrupto por mutación)', () => {
  const config = baseConfig({});
  config.model = 42;
  const result = runValidator(config);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /model must be a string/);
});

test('rejects a non-string small_model', () => {
  const config = baseConfig({});
  config.small_model = null;
  const result = runValidator(config);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /small_model must be a string/);
});

test('rejects a non-string mode on any agent (simetría con orchestrator)', () => {
  const config = baseConfig({});
  const agent = config.agent as Record<string, Record<string, unknown>>;
  agent['sdd-verify'].mode = 42;
  const result = runValidator(config);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /sdd-verify\.mode must be a string/);
});

test('rejects an empty remote MCP url (pasa typeof-string pero deja el servicio roto)', () => {
  const result = runValidator(
    baseConfig({
      broken: { type: 'remote', url: '', enabled: true },
    }),
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /requires url/);
});

test('exported validateOpencodeConfigObject does NOT leak INFO as errors (stack-doctor contract)', () => {
  const config = baseConfig({});
  const agent = config.agent as Record<string, Record<string, unknown>>;
  for (const a of Object.values(agent)) delete a.model;
  const errors = validateOpencodeConfigObject(config);
  assert.equal(
    errors.filter((e) => e.startsWith('INFO:')).length,
    0,
    'INFO no debe aparecer como error',
  );
});
