#!/usr/bin/env node
/**
 * Unit Tests: superficies Kimi y Qoder del audit multi-tool (GB-2026-11-15).
 *
 * El PASS acredita configuración persistente, no ejecución del host. El bridge
 * MCP de Qoder es efímero y su ausencia con el IDE cerrado no degrada el perfil.
 * Los probes verifican solo estructura; nunca acceden a credenciales.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { cpSync, mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  auditTools,
  jsonHasServers,
  jsonHasRuntimeBridge,
} from '../../src/integrations/tool-interoperability-audit.ts';
import { CRITICAL_SKILLS } from '../../src/integrations/zcode-sync.ts';

/** Fixture: repo mínimo (perfil + AGENTS.md) y home con la superficie. */
function fixture(opts: {
  kimiMcp?: string | null;
  qoderMcp?: string;
  qoderBridge?: string | null;
  kimiProfile?: boolean;
  qoderProfile?: boolean;
}): { root: string; home: string; appData: string } {
  const root = mkdtempSync(join(tmpdir(), 'gv-kq-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'gv-kq-home-'));
  const appData = mkdtempSync(join(tmpdir(), 'gv-kq-appdata-'));
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'AGENTS.md'), '# canon\n');
  if (opts.kimiProfile !== false)
    writeFileSync(join(root, 'config', 'tool-kimi.json'), '{"tool":"kimi"}');
  if (opts.qoderProfile !== false)
    writeFileSync(join(root, 'config', 'tool-qoder.json'), '{"tool":"qoder"}');
  if (opts.kimiMcp !== null) {
    mkdirSync(join(home, '.kimi-code'), { recursive: true });
    writeFileSync(
      join(home, '.kimi-code', 'mcp.json'),
      opts.kimiMcp ?? '{"mcpServers":{"rea":{}}}',
    );
  }
  if (opts.qoderBridge !== null) {
    mkdirSync(join(home, '.qoder'), { recursive: true });
    writeFileSync(
      join(home, '.qoder', 'mcp-router.json'),
      opts.qoderBridge ??
        '{"schemaVersion":2,"pid":1,"baseUrl":"http://127.0.0.1:0","apiKey":"REDACTED","startedAt":1}',
    );
  }
  if (opts.qoderMcp) {
    mkdirSync(join(home, '.qoder'), { recursive: true });
    writeFileSync(join(home, '.qoder', 'settings.json'), opts.qoderMcp);
  }
  return { root, home, appData };
}

function statusFor(rows: ReturnType<typeof auditTools>, tool: string): string | undefined {
  return rows.find((r) => r.tool === tool)?.status;
}

function addCriticalProjectSkills(root: string): void {
  for (const skill of CRITICAL_SKILLS) {
    const sourceRoot =
      skill.root === 'opencode' ? join(root, '.opencode', 'skills') : join(root, 'skills');
    const source = join(sourceRoot, skill.dir);
    const content = `---\nname: ${skill.dir}\ndescription: ${skill.dir} capability\n---\n`;
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'SKILL.md'), content);
    cpSync(source, join(root, '.kimi-code', 'skills', skill.dir), { recursive: true });
    cpSync(source, join(root, '.qoder', 'skills', skill.dir), { recursive: true });
  }
}

function fakeEngramCommandPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gv-kq-path-'));
  writeFileSync(join(dir, 'engram.exe'), 'engram shim');
  return dir;
}

test('jsonHasServers: mcpServers y servers no vacíos, sin leer valores', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gv-kq-json-'));
  const ok1 = join(dir, 'a.json');
  const ok2 = join(dir, 'b.json');
  const empty = join(dir, 'c.json');
  const broken = join(dir, 'd.json');
  writeFileSync(ok1, '{"mcpServers":{"rea":{"command":"node"}}}');
  writeFileSync(ok2, '{"servers":{"x":{}}}');
  writeFileSync(empty, '{"mcpServers":{}}');
  writeFileSync(broken, '{oops');
  assert.equal(jsonHasServers(ok1), true);
  assert.equal(jsonHasServers(ok2), true);
  assert.equal(jsonHasServers(empty), false);
  assert.equal(jsonHasServers(broken), false);
  assert.equal(jsonHasServers(join(dir, 'no-existe.json')), false);
});

test('jsonHasRuntimeBridge: schemaVersion numérico presente, apiKey jamás inspeccionada', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gv-kq-bridge-'));
  const ok = join(dir, 'a.json');
  const broken = join(dir, 'b.json');
  writeFileSync(ok, '{"schemaVersion":2,"apiKey":"secreto-no-leido"}');
  writeFileSync(broken, '{"pid":1}');
  assert.equal(jsonHasRuntimeBridge(ok), true);
  assert.equal(jsonHasRuntimeBridge(broken), false);
  assert.equal(jsonHasRuntimeBridge(join(dir, 'no-existe.json')), false);
});

test('Kimi PASS con el contrato completo de identificación', () => {
  const { root, home, appData } = fixture({});
  addCriticalProjectSkills(root);
  mkdirSync(join(root, '.kimi-code'), { recursive: true });
  writeFileSync(
    join(root, '.kimi-code', 'mcp.json'),
    '{"mcpServers":{"engram":{"command":"engram","args":["mcp","--tools=agent"]}}}',
  );
  const rows = auditTools(root, home, appData);
  const kimi = rows.find((r) => r.tool === 'Kimi');
  assert.ok(kimi, 'fila Kimi presente');
  assert.equal(kimi.status, 'PASS');
  assert.equal(kimi.profile, true);
  assert.equal(kimi.hostConfig, true);
  assert.equal(kimi.skills, CRITICAL_SKILLS.length);
  assert.equal(kimi.assets, 'fresh');
  assert.equal(kimi.engram, 'mcp');
});

test('Kimi WARN si falta el perfil, el runtime o el mcp.json no declara servers', () => {
  const sinPerfil = fixture({ kimiProfile: false });
  assert.equal(statusFor(auditTools(sinPerfil.root, sinPerfil.home, sinPerfil.appData), 'Kimi'), 'WARN');
  const sinRuntime = fixture({ kimiMcp: null });
  assert.equal(statusFor(auditTools(sinRuntime.root, sinRuntime.home, sinRuntime.appData), 'Kimi'), 'WARN');
  const sinServers = fixture({ kimiMcp: '{"other":1}' });
  assert.equal(statusFor(auditTools(sinServers.root, sinServers.home, sinServers.appData), 'Kimi'), 'WARN');
});

test('Qoder runtime bridge alone does not qualify persistent IDE MCP configuration', () => {
  const ok = fixture({});
  addCriticalProjectSkills(ok.root);
  const rows = auditTools(ok.root, ok.home, ok.appData);
  const qoder = rows.find((r) => r.tool === 'Qoder');
  assert.ok(qoder, 'fila Qoder presente');
  assert.equal(qoder.status, 'WARN');
  assert.equal(qoder.skills, CRITICAL_SKILLS.length);
  assert.equal(qoder.assets, 'fresh');
  assert.equal(qoder.engram, 'unverified');
  assert.match(qoder.detail, /persistent Engram MCP not verified/i);

  const sinBridge = fixture({ qoderBridge: null });
  mkdirSync(join(sinBridge.home, '.qoder'), { recursive: true });
  addCriticalProjectSkills(sinBridge.root);
  const bridgeInactivo = auditTools(
    sinBridge.root,
    sinBridge.home,
    sinBridge.appData,
  ).find((row) => row.tool === 'Qoder');
  assert.equal(bridgeInactivo?.status, 'WARN');
  assert.match(bridgeInactivo?.detail ?? '', /runtime bridge not active/i);
});

test('Qoder PASS requires the persistent Engram MCP server in IDE settings', () => {
  const configured = fixture({
    qoderMcp: '{"mcpServers":{"engram":{}}}',
  });
  addCriticalProjectSkills(configured.root);

  const qoder = auditTools(configured.root, configured.home, configured.appData)
    .find((row) => row.tool === 'Qoder');
  assert.equal(qoder?.status, 'PASS');
  assert.equal(qoder?.engram, 'mcp');
});

test('Qoder IDE configuration does not depend on an external product CLI', () => {
  const fixtureState = fixture({});
  addCriticalProjectSkills(fixtureState.root);
  const originalPath = process.env.PATH;
  process.env.PATH = fakeEngramCommandPath();
  try {
    const qoder = auditTools(fixtureState.root, fixtureState.home, fixtureState.appData)
      .find((row) => row.tool === 'Qoder');
    assert.equal(qoder?.status, 'WARN');
    assert.equal(qoder?.engram, 'unverified');
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }
});

test('Kimi y Qoder audit project-level critical skills for count and freshness', () => {
  const { root, home, appData } = fixture({});
  addCriticalProjectSkills(root);
  const kimiRoot = join(root, '.kimi-code', 'skills');
  const qoderRoot = join(root, '.qoder', 'skills');
  const rows = auditTools(root, home, appData);
  for (const tool of ['Kimi', 'Qoder']) {
    const row = rows.find((candidate) => candidate.tool === tool);
    assert.ok(row, `${tool} row exists`);
    assert.equal(row.skills, CRITICAL_SKILLS.length);
    assert.equal(row.assets, 'fresh');
  }
  writeFileSync(join(kimiRoot, CRITICAL_SKILLS[0].dir, 'SKILL.md'), 'stale');
  const staleKimi = auditTools(root, home, appData).find((row) => row.tool === 'Kimi');
  assert.equal(staleKimi?.assets, 'stale');
});

test('auditTools incluye las 8 superficies esperadas', () => {
  const { root, home, appData } = fixture({});
  const rows = auditTools(root, home, appData);
  const names = rows.map((r) => r.tool);
  for (const expected of [
    'OpenCode',
    'Codex',
    'ZCode',
    'MiniMax Code',
    'GitHub Copilot',
    'Antigravity',
    'Kimi',
    'Qoder',
  ]) {
    assert.ok(names.includes(expected), `falta superficie ${expected}`);
  }
});
