import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  auditCodexTokenSafety,
  codexConfigParity,
  repoTrustedInHostConfig,
  auditKimiTokenSafety,
  auditMinimaxTokenSafety,
  auditOpencodeTokenSafety,
  auditZcodeTokenSafety,
  latestCodexWorkspace,
  latestQoderSession,
  minimaxEffectiveness,
  opencodeEffectiveness,
  parseMinimaxConfig,
  parseZcodeConfig,
  qoderEffectiveness,
  workspaceMatchesRoot,
  zcodeEffectiveness,
} from '../../../src/tokens/token-safety.js';

function withFixture(name: string, content: string, run: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'gv-token-safety-'));
  try {
    const path = join(dir, name);
    writeFileSync(path, content);
    run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('codex: perfil seguro y perfil sin límites', () => {
  const safe = [
    'model = "gpt-6.1-sol"',
    'model_context_window = 272000',
    'model_auto_compact_token_limit = 180000',
    'project_doc_max_bytes = 32768',
    '[projects."C:/repo"]',
    'trust_level = "trusted"',
  ].join('\n');
  withFixture('config.toml', safe, (path) => {
    assert.equal(auditCodexTokenSafety(path).status, 'PASS');
  });
  const unsafe = 'model = "x"\n[projects.x]\ntrust_level = "trusted"\n';
  withFixture('config.toml', unsafe, (path) => {
    const report = auditCodexTokenSafety(path);
    assert.equal(report.status, 'WARN');
    assert.ok(report.checks.some((check) => check.includes('model_context_window')));
  });
});

test('codex: config ausente -> WARN (no puede pasar silencioso)', () => {
  assert.equal(auditCodexTokenSafety(join(tmpdir(), 'gv-no-existe-codex.toml')).status, 'WARN');
});

test('kimi: sin config el CLI aplica defaults -> INFO server-managed', () => {
  const report = auditKimiTokenSafety(join(tmpdir(), 'gv-no-existe-kimi.toml'));
  assert.equal(report.status, 'INFO');
  assert.equal(report.surface, 'server-managed');
});

test('kimi: reserved_context_size habilita compactación temprana', () => {
  const safe = [
    '[models.kimi-k2]',
    'max_context_size = 256000',
    '[loop_control]',
    'reserved_context_size = 64000',
  ].join('\n');
  withFixture('config.toml', safe, (path) => {
    assert.equal(auditKimiTokenSafety(path).status, 'PASS');
  });
  const unsafe = '[models.kimi-k2]\nmax_input_size = 128000\n[loop_control]\n';
  withFixture('config.toml', unsafe, (path) => {
    const report = auditKimiTokenSafety(path);
    assert.equal(report.status, 'WARN');
    assert.ok(report.checks.some((check) => check.includes('reserved_context_size')));
  });
});

test('minimax: cada modelo necesita limit.context; la opción 1M se reporta', () => {
  const config = [
    'provider:',
    '  minimax:',
    '    models:',
    '      MiniMax-M3:',
    '        limit:',
    '          context: 512000',
    '          output: 128000',
    '        contextWindowOptions:',
    '          - 512000',
    '          - 1000000',
    '      MiniMax-M2:',
    '        name: M2',
  ].join('\n');
  const profile = parseMinimaxConfig(config);
  assert.equal(profile.models, 2);
  assert.equal(profile.missingContext, 1);
  assert.equal(profile.oneMillionOption, true);
  withFixture('config.yaml', config, (path) => {
    const report = auditMinimaxTokenSafety(path);
    assert.equal(report.status, 'WARN');
    assert.ok(report.notes.some((note) => note.includes('higher_usage')));
  });
});

test('zcode: modelos con y sin limit.context', () => {
  const ok = JSON.stringify({
    provider: { zai: { models: { GLM: { limit: { context: 1000000 } } } } },
  });
  assert.deepEqual(parseZcodeConfig(ok), { models: 1, missingContext: 0, maxContext: 1000000 });
  withFixture('config.json', ok, (path) => {
    assert.equal(auditZcodeTokenSafety(path).status, 'PASS');
  });
  const partial = JSON.stringify({ provider: { zai: { models: { GLM: {} } } } });
  withFixture('config.json', partial, (path) => {
    assert.equal(auditZcodeTokenSafety(path).status, 'WARN');
  });
});

test('opencode: canon del repo exige compaction auto+prune', () => {
  const safe = JSON.stringify({ compaction: { auto: true, prune: true } });
  withFixture('opencode.json', safe, (path) => {
    assert.equal(auditOpencodeTokenSafety(path).status, 'PASS');
  });
  const unsafe = JSON.stringify({ compaction: { auto: true } });
  withFixture('opencode.json', unsafe, (path) => {
    const report = auditOpencodeTokenSafety(path);
    assert.equal(report.status, 'WARN');
    assert.ok(report.checks.some((check) => check.includes('prune')));
  });
});

// ─── Efectividad de sesión (config aplicada, no solo presente) ────────────────

test('workspaceMatchesRoot: igualdad, subdirectorio, backslash y mayúsculas', () => {
  assert.equal(
    workspaceMatchesRoot(
      'C:/Workspace_local/gentle-vanguard',
      'C:/Workspace_local/gentle-vanguard',
    ),
    true,
  );
  const bs = String.fromCharCode(92);
  assert.equal(
    workspaceMatchesRoot(
      `C:${bs}Workspace_local${bs}gentle-vanguard${bs}apps`,
      'C:/Workspace_local/gentle-vanguard',
    ),
    true,
  );
  assert.equal(
    workspaceMatchesRoot(
      'C:/Workspace_local/gentle-vanguard',
      'C:/Workspace_local/gentle-vanguard/apps',
    ),
    true,
  );
  assert.equal(
    workspaceMatchesRoot('C:/Users/emman/Documents/Codex', 'C:/Workspace_local/gentle-vanguard'),
    false,
  );
  assert.equal(
    workspaceMatchesRoot(
      'C:/Workspace_local/gentle-vanguard-other',
      'C:/Workspace_local/gentle-vanguard',
    ),
    false,
  );
  assert.equal(workspaceMatchesRoot(null, 'C:/x'), false);
});

test('codex effectiveness: lee session_meta.cwd del rollout más reciente (archived incluido)', () => {
  const home = mkdtempSync(join(tmpdir(), 'gv-codex-home-'));
  try {
    const dir = join(home, '.codex', 'archived_sessions');
    mkdirSync(dir, { recursive: true });
    const meta = JSON.stringify({
      type: 'session_meta',
      payload: { cwd: 'C:/Workspace_local/gentle-vanguard' },
    });
    writeFileSync(
      join(dir, 'rollout-2026-11-17T07-55-12-01a1e925-82e7-7e83-846d-5fa4747c4e39.jsonl'),
      `${meta}\n`,
    );
    assert.equal(latestCodexWorkspace(home), 'C:/Workspace_local/gentle-vanguard');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

function withSqlite(
  schema: string,
  rows: (db: Database.Database) => void,
  run: (path: string) => void,
): void {
  const dir = mkdtempSync(join(tmpdir(), 'gv-effect-db-'));
  try {
    const path = join(dir, 'state.sqlite');
    const db = new Database(path);
    db.exec(schema);
    rows(db);
    db.close();
    run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('opencode effectiveness: aplica solo si la última sesión es del repo', () => {
  withSqlite(
    'CREATE TABLE session (id TEXT, directory TEXT, time_updated INTEGER);',
    (db) => {
      db.prepare('INSERT INTO session VALUES (?,?,?)').run(
        'old',
        'C:/Workspace_local/gentle-vanguard',
        1,
      );
      db.prepare('INSERT INTO session VALUES (?,?,?)').run('new', 'C:/other/project', 2);
    },
    (path) => {
      const report = opencodeEffectiveness('C:/Workspace_local/gentle-vanguard', path);
      assert.equal(report.status, 'not-applied');
      assert.equal(report.severity, 'warn');
      assert.equal(report.workspace, 'C:/other/project');
    },
  );
});

test('minimax y zcode effectiveness: workspace de la última sesión/tarea', () => {
  withSqlite(
    'CREATE TABLE local_runtime_sessions (session_id TEXT, workspace_dir TEXT, project_workspace_dir TEXT, updated_at_ms INTEGER);',
    (db) => {
      db.prepare('INSERT INTO local_runtime_sessions VALUES (?,?,?,?)').run(
        's1',
        '',
        'C:/Workspace_local/gentle-vanguard',
        10,
      );
    },
    (path) => {
      assert.equal(
        minimaxEffectiveness('C:/Workspace_local/gentle-vanguard', path).status,
        'applied',
      );
    },
  );
  withSqlite(
    'CREATE TABLE tasks (task_id TEXT, workspace_path TEXT, updated_at TEXT);',
    (db) => {
      db.prepare('INSERT INTO tasks VALUES (?,?,?)').run(
        't1',
        'C:/Workspace_local/gentle-vanguard',
        '2026-11-17T10:00:00Z',
      );
    },
    (path) => {
      assert.equal(
        zcodeEffectiveness('C:/Workspace_local/gentle-vanguard', path).status,
        'applied',
      );
    },
  );
});

// ─── Qoder: transcripts con cwd + compactaciones (sin usage por request) ─────

function writeQoderTranscript(
  home: string,
  slug: string,
  name: string,
  lines: unknown[],
  mtimeOffsetSec = 0,
): string {
  const dir = join(home, '.qoder', 'projects', slug);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  if (mtimeOffsetSec !== 0) {
    const t = new Date(Date.now() + mtimeOffsetSec * 1000);
    utimesSync(path, t, t);
  }
  return path;
}

test('qoder effectiveness: lee el cwd del transcript y cuenta compactaciones', () => {
  const home = mkdtempSync(join(tmpdir(), 'gv-qoder-home-'));
  try {
    writeQoderTranscript(home, 'C--Workspace-local-gentle-vanguard', 'session-a.jsonl', [
      { type: 'user', cwd: 'C:/Workspace_local/gentle-vanguard' },
      { type: 'compaction', compactMetadata: { preTokens: 167087, postTokens: 4748 } },
      { type: 'user', cwd: 'C:/Workspace_local/gentle-vanguard' },
    ]);
    const evidence = latestQoderSession(home);
    assert.equal(evidence?.workspace, 'C:/Workspace_local/gentle-vanguard');
    assert.equal(evidence?.compactions, 1);
    assert.deepEqual(evidence?.lastCompaction, { preTokens: 167087, postTokens: 4748 });
    const report = qoderEffectiveness('C:/Workspace_local/gentle-vanguard', home);
    assert.equal(report.status, 'applied');
    assert.equal(report.severity, 'info');
    assert.ok(report.detail.includes('compactación'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('qoder effectiveness: la sesión más reciente manda (fuera del repo = not-applied)', () => {
  const home = mkdtempSync(join(tmpdir(), 'gv-qoder-home-'));
  try {
    writeQoderTranscript(
      home,
      'C--Workspace-local-gentle-vanguard',
      'old.jsonl',
      [{ type: 'user', cwd: 'C:/Workspace_local/gentle-vanguard' }],
      -120,
    );
    writeQoderTranscript(home, 'C--Users-emman-Documents-otro', 'new.jsonl', [
      { type: 'user', cwd: 'C:/Users/emman/Documents/otro' },
    ]);
    const report = qoderEffectiveness('C:/Workspace_local/gentle-vanguard', home);
    assert.equal(report.status, 'not-applied');
    assert.equal(report.workspace, 'C:/Users/emman/Documents/otro');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('qoder effectiveness: compactUsage se reporta como evidencia parcial, no como total', () => {
  const home = mkdtempSync(join(tmpdir(), 'gv-qoder-home-'));
  try {
    writeQoderTranscript(home, 'C--Workspace-local-gentle-vanguard', 'session-b.jsonl', [
      { type: 'user', cwd: 'C:/Workspace_local/gentle-vanguard' },
      {
        type: 'system',
        cwd: 'C:/Workspace_local/gentle-vanguard',
        compactMetadata: { preTokens: 148461, postTokens: 13388 },
        compactUsage: {
          input_tokens: 148461,
          output_tokens: 5970,
          cache_read_input_tokens: 2432,
          credits: 3.24,
        },
      },
      {
        type: 'system',
        cwd: 'C:/Workspace_local/gentle-vanguard',
        compactMetadata: { preTokens: 142892, postTokens: 12000 },
        compactUsage: {
          input_tokens: 142892,
          output_tokens: 7771,
          cache_read_input_tokens: 1000,
          credits: 2.4,
        },
      },
    ]);
    const evidence = latestQoderSession(home);
    assert.equal(evidence?.compactions, 2);
    assert.equal(evidence?.compactionUsage?.events, 2);
    assert.equal(evidence?.compactionUsage?.inputTokens, 291353);
    assert.equal(evidence?.compactionUsage?.outputTokens, 13741);
    assert.equal(evidence?.compactionUsage?.cacheReadTokens, 3432);
    assert.ok(Math.abs((evidence?.compactionUsage?.credits ?? 0) - 5.64) < 1e-9);
    const report = qoderEffectiveness('C:/Workspace_local/gentle-vanguard', home);
    assert.ok(report.detail.includes('parcial'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('qoder effectiveness: sin transcripts -> unknown honesto (no PASS falso)', () => {
  const home = mkdtempSync(join(tmpdir(), 'gv-qoder-home-'));
  try {
    const report = qoderEffectiveness('C:/Workspace_local/gentle-vanguard', home);
    assert.equal(report.status, 'unknown');
    assert.equal(report.severity, 'info');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('codex parity: repo y host coinciden en las claves de seguridad', () => {
  const repo = [
    'model = "gpt-6.1-sol"',
    'model_context_window = 272000',
    'model_auto_compact_token_limit = 180000',
    '[windows]',
    'sandbox = "unelevated"',
  ].join('\n');
  const host = [
    'model = "gpt-6.1-sol"',
    'model_context_window = 272000',
    'model_auto_compact_token_limit = 180000',
    '[windows]',
    'sandbox = "elevated"',
  ].join('\n');
  const parity = codexConfigParity(repo, host, 'C:\Workspace_local\gentle-vanguard');
  assert.equal(parity.hostPresent, true);
  assert.deepEqual(parity.conflicts, [], 'sandbox del host no cuenta: es host-owned');
});

test('codex parity: una divergencia en compactación se reporta como conflicto', () => {
  const repo = 'model_context_window = 272000\nmodel_auto_compact_token_limit = 180000';
  const host = 'model_context_window = 272000\nmodel_auto_compact_token_limit = 260000';
  const parity = codexConfigParity(repo, host, 'C:\repo');
  assert.deepEqual(parity.conflicts, [
    { key: 'model_auto_compact_token_limit', repo: 180000, host: 260000 },
  ]);
});

test('codex parity: sin config de host no se puede afirmar nada', () => {
  const parity = codexConfigParity('model_context_window = 272000', null, 'C:\repo');
  assert.equal(parity.hostPresent, false);
  assert.equal(parity.repoTrusted, null);
});

test('trust del repo en el host: case-insensitive y sin barra final', () => {
  const host = [
    "[projects.'c:/workspace_local/gentle-vanguard']",
    'trust_level = "trusted"',
    "[projects.'c:/otro']",
    'trust_level = "untrusted"',
  ].join('\n');
  assert.equal(repoTrustedInHostConfig(host, 'C:/Workspace_local/gentle-vanguard/'), true);
  assert.equal(repoTrustedInHostConfig(host, 'C:/Workspace_local/otro-repo'), false);
});
