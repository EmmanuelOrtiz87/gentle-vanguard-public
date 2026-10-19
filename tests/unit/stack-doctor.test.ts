import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectStackDoctorReport } from '../../src/ops/stack-doctor.js';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'gv-stack-doctor-'));
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(join(root, '.runtime'), { recursive: true });
  mkdirSync(join(root, 'graphify-out'), { recursive: true });
  mkdirSync(join(root, '.atl'), { recursive: true });
  mkdirSync(join(root, '.codex'), { recursive: true });
  mkdirSync(join(root, '.codex', 'skills', 'gv-shorts-skill'), { recursive: true });
  writeFileSync(join(root, 'config', 'model-router.json'), '{}');
  writeFileSync(join(root, 'config', 'session-autostart.config.json'), '{}');
  writeFileSync(
    join(root, 'opencode.json'),
    JSON.stringify({
      agent: {
        orchestrator: { mode: 'primary', model: 'opencode/test-model', steps: 12 },
        'sdd-explore': { mode: 'subagent', model: 'opencode/test-model', steps: 8 },
        'sdd-design': { mode: 'subagent', model: 'opencode/test-model', steps: 8 },
        'sdd-apply': { mode: 'subagent', model: 'opencode/test-model', steps: 8 },
        'sdd-verify': { mode: 'subagent', model: 'opencode/test-model', steps: 8 },
      },
      mcp: {
        engram: { type: 'stdio', command: 'engram', args: 'mcp --tools=agent' },
        mercadopago: { type: 'remote', url: 'https://mcp.mercadopago.com/mcp' },
      },
      tools: {
        bash: true,
        readFile: true,
        writeFile: true,
        editFile: true,
        listFiles: true,
      },
      compaction: { auto: true },
      watcher: { ignore: ['node_modules/**'] },
    }),
  );
  for (const tool of ['opencode', 'codex', 'zcode', 'minimax', 'vscode', 'antigravity']) {
    writeFileSync(join(root, 'config', `tool-${tool}.json`), '{}');
  }
  writeFileSync(join(root, '.runtime', 'gentle-vanguard.db'), 'fixture');
  writeFileSync(join(root, 'graphify-out', 'graph.json'), '{}');
  writeFileSync(join(root, '.atl', 'skill-registry.md'), '# skills');
  writeFileSync(
    join(root, '.codex', 'config.toml'),
    [
      '# engram-windows-hook-command-v1: "C:\\\\Users\\\\emman\\\\bin\\\\engram.exe"',
      'model = "gpt-5.5"',
      '[mcp_servers.engram]',
      'command = "C:\\\\Users\\\\emman\\\\bin\\\\engram.exe"',
      'args = ["mcp", "--tools=agent"]',
      '',
    ].join('\n'),
  );
  return root;
}

function doctor(root: string) {
  return collectStackDoctorReport(root, {
    codexConfigPath: join(root, '.codex', 'config.toml'),
    codexSkillsRoot: join(root, '.codex', 'skills'),
    checkCodexEngramRuntime: false,
  });
}

test('stack doctor is read-only, fast scoped, and reports external catalogs as unverified', () => {
  const root = fixture();
  const report = doctor(root);
  assert.equal(report.readOnly, true);
  assert.equal(report.scope, 'local-fast');
  assert.equal(report.status, 'WARN');
  assert.equal(report.checks.find((check) => check.id === 'model-router')?.state, 'healthy');
  assert.equal(report.checks.find((check) => check.id === 'opencode-config')?.state, 'healthy');
  assert.equal(report.checks.find((check) => check.id === 'codex-engram')?.state, 'healthy');
  assert.equal(report.checks.find((check) => check.id === 'model-catalog')?.state, 'unverified');
});

test('stack doctor trusts a fresh healthy model catalog probe cache', () => {
  const root = fixture();
  mkdirSync(join(root, 'reports', 'audits'), { recursive: true });
  writeFileSync(
    join(root, 'reports', 'audits', 'model-catalog-latest.json'),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      summary: {
        totalProviders: 10,
        providersWithAuth: 9,
        providersReachable: 6,
        totalConfiguredModels: 264,
        totalUpstreamModels: 252,
        missingInUpstream: 0,
        brokenModelProbes: 0,
      },
    }),
  );
  const report = doctor(root);
  const modelCatalog = report.checks.find((check) => check.id === 'model-catalog');
  assert.equal(report.status, 'PASS');
  assert.equal(modelCatalog?.state, 'healthy');
  assert.match(modelCatalog?.message ?? '', /fresh/);
});

test('stack doctor fails on fresh model catalog evidence with stale configured models', () => {
  const root = fixture();
  mkdirSync(join(root, 'reports', 'audits'), { recursive: true });
  writeFileSync(
    join(root, 'reports', 'audits', 'model-catalog-latest.json'),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      summary: {
        totalProviders: 10,
        providersWithAuth: 9,
        providersReachable: 6,
        totalConfiguredModels: 264,
        totalUpstreamModels: 252,
        missingInUpstream: 1,
        brokenModelProbes: 0,
      },
    }),
  );
  const report = doctor(root);
  assert.equal(report.status, 'FAIL');
  assert.equal(report.checks.find((check) => check.id === 'model-catalog')?.state, 'conflict');
});

test('stack doctor fails when Codex Engram hook marker is missing', { skip: process.platform !== 'win32' }, () => {
  const root = fixture();
  writeFileSync(
    join(root, '.codex', 'config.toml'),
    ['model = "gpt-5.5"', '[mcp_servers.engram]', 'command = "engram"', 'args = ["mcp", "--tools=agent"]', ''].join(
      '\n',
    ),
  );
  const report = doctor(root);
  const check = report.checks.find((item) => item.id === 'codex-engram');
  assert.equal(report.status, 'FAIL');
  assert.equal(check?.state, 'conflict');
  assert.match(check?.message ?? '', /missing Windows hook marker/);
});

test('stack doctor fails when Codex Engram config overrides the base prompt', () => {
  const root = fixture();
  writeFileSync(
    join(root, '.codex', 'config.toml'),
    [
      '# engram-windows-hook-command-v1: "C:\\\\Users\\\\emman\\\\bin\\\\engram.exe"',
      'model_instructions_file = "C:\\\\Users\\\\emman\\\\.codex\\\\engram-instructions.md"',
      '[mcp_servers.engram]',
      'command = "C:\\\\Users\\\\emman\\\\bin\\\\engram.exe"',
      'args = ["mcp", "--tools=agent"]',
      '',
    ].join('\n'),
  );
  const report = doctor(root);
  const check = report.checks.find((item) => item.id === 'codex-engram');
  assert.equal(report.status, 'FAIL');
  assert.equal(check?.state, 'conflict');
  assert.match(check?.message ?? '', /prompt override present/);
});

test('stack doctor catches Codex Engram binary/server version drift', () => {
  const root = fixture();
  const report = collectStackDoctorReport(root, {
    codexConfigPath: join(root, '.codex', 'config.toml'),
    codexSkillsRoot: join(root, '.codex', 'skills'),
    commandRunner: () => 'engram 3.4.0',
    jsonReader: () => ({
      status: 'ok',
      version: '3.3.2',
      capabilities: {
        isolated_session_registration: true,
        root_session_resume: true,
        runtime_session_resolution: true,
      },
    }),
  });
  const check = report.checks.find((item) => item.id === 'codex-engram');
  assert.equal(report.status, 'FAIL');
  assert.equal(check?.state, 'conflict');
  assert.match(check?.message ?? '', /version mismatch/);
});

test('stack doctor catches Codex Engram runtime without session resolution', () => {
  const root = fixture();
  const report = collectStackDoctorReport(root, {
    codexConfigPath: join(root, '.codex', 'config.toml'),
    codexSkillsRoot: join(root, '.codex', 'skills'),
    commandRunner: () => 'engram 3.4.0',
    jsonReader: () => ({
      status: 'ok',
      version: '3.4.0',
      capabilities: {
        isolated_session_registration: true,
        root_session_resume: true,
        runtime_session_resolution: false,
      },
    }),
  });
  const check = report.checks.find((item) => item.id === 'codex-engram');
  assert.equal(report.status, 'FAIL');
  assert.equal(check?.state, 'conflict');
  assert.match(check?.message ?? '', /runtime_session_resolution/);
});

test('stack doctor verifies the current Codex session binding when runtime is healthy', () => {
  const root = fixture();
  const report = collectStackDoctorReport(root, {
    codexConfigPath: join(root, '.codex', 'config.toml'),
    codexSkillsRoot: join(root, '.codex', 'skills'),
    commandRunner: () => 'engram 3.4.0',
    jsonReader: () => ({
      status: 'ok',
      version: '3.4.0',
      capabilities: {
        isolated_session_registration: true,
        root_session_resume: true,
        runtime_session_resolution: true,
      },
    }),
    jsonRequester: (url, method, body) => {
      if (method === 'GET' && url.includes('/project/current')) {
        return { project: 'gentle-vanguard', project_source: 'config' };
      }
      if (method === 'POST' && url.includes('/runtime-sessions/resolve')) {
        assert.deepEqual(body, {
          id: 'codex-session',
          directory: root,
          project: 'gentle-vanguard',
        });
        return { id: 'codex-session', status: 'resolved' };
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    },
    currentCodexSessionId: 'codex-session',
    currentCodexCwd: root,
  });
  const check = report.checks.find((item) => item.id === 'codex-engram');
  assert.equal(check?.state, 'healthy');
  assert.match(check?.message ?? '', /current session registered/);
});

test('stack doctor fails when the current Codex session is not registered in Engram', () => {
  const root = fixture();
  const report = collectStackDoctorReport(root, {
    codexConfigPath: join(root, '.codex', 'config.toml'),
    codexSkillsRoot: join(root, '.codex', 'skills'),
    commandRunner: () => 'engram 3.4.0',
    jsonReader: () => ({
      status: 'ok',
      version: '3.4.0',
      capabilities: {
        isolated_session_registration: true,
        root_session_resume: true,
        runtime_session_resolution: true,
      },
    }),
    jsonRequester: (url, method) => {
      if (method === 'GET' && url.includes('/project/current')) {
        return { project: 'gentle-vanguard', project_source: 'config' };
      }
      if (method === 'POST' && url.includes('/runtime-sessions/resolve')) {
        throw new Error('not registered');
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    },
    currentCodexSessionId: 'codex-session',
    currentCodexCwd: root,
  });
  const check = report.checks.find((item) => item.id === 'codex-engram-session');
  assert.equal(report.status, 'FAIL');
  assert.equal(check?.state, 'conflict');
  assert.match(check?.message ?? '', /not registered/);
});

test('stack doctor fails only for missing or conflicting local foundations', () => {
  const root = fixture();
  writeFileSync(join(root, 'config', 'model-router.json'), '{invalid');
  const report = doctor(root);
  assert.equal(report.status, 'FAIL');
  assert.equal(report.checks.find((check) => check.id === 'model-router')?.state, 'conflict');
});

test('stack doctor fails when opencode config would break autostart', () => {
  const root = fixture();
  writeFileSync(
    join(root, 'opencode.json'),
    JSON.stringify({
      agent: {
        orchestrator: { mode: 'primary', model: 'opencode/test-model', steps: 12 },
        'sdd-explore': { mode: 'subagent', model: 'opencode/test-model', steps: 8 },
        'sdd-design': { mode: 'subagent', model: 'opencode/test-model', steps: 8 },
        'sdd-apply': { mode: 'subagent', model: 'opencode/test-model', steps: 8 },
        'sdd-verify': { mode: 'subagent', model: 'opencode/test-model', steps: 8 },
      },
      mcp: {
        mercadopago: { type: 'remote' },
      },
      tools: {
        bash: true,
        readFile: true,
        writeFile: true,
        editFile: true,
        listFiles: true,
      },
      compaction: { auto: true },
    }),
  );
  const report = doctor(root);
  assert.equal(report.status, 'FAIL');
  assert.equal(report.checks.find((check) => check.id === 'opencode-config')?.state, 'conflict');
});
