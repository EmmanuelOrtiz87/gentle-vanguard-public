#!/usr/bin/env node
/**
 * Unit Tests: superficies Kimi y Qoder del audit multi-tool (GB-2026-11-15).
 *
 * Contrato de IDENTIFICACIÓN (no de calificación): el PASS exige perfil
 * declarado + runtime en home + bridge MCP presente por ESTRUCTURA — sin leer
 * valores ni credenciales (mcp-router.json de Qoder lleva apiKey de runtime;
 * estos probes jamás la tocan ni la replican).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  auditTools,
  jsonHasServers,
  jsonHasRuntimeBridge,
} from '../../src/integrations/tool-interoperability-audit.ts';

/** Fixture: repo mínimo (perfil + AGENTS.md) y home con la superficie. */
function fixture(opts: {
  kimiMcp?: string | null;
  qoderBridge?: string | null;
  kimiProfile?: boolean;
  qoderProfile?: boolean;
}): { root: string; home: string } {
  const root = mkdtempSync(join(tmpdir(), 'gv-kq-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'gv-kq-home-'));
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
  return { root, home };
}

function statusFor(rows: ReturnType<typeof auditTools>, tool: string): string | undefined {
  return rows.find((r) => r.tool === tool)?.status;
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
  const { root, home } = fixture({});
  const rows = auditTools(root, home, '');
  const kimi = rows.find((r) => r.tool === 'Kimi');
  assert.ok(kimi, 'fila Kimi presente');
  assert.equal(kimi.status, 'PASS');
  assert.equal(kimi.profile, true);
  assert.equal(kimi.runtime, true);
  assert.equal(kimi.engram, 'missing'); // honesto: integración pendiente
  assert.match(kimi.detail, /pendiente de decisión/);
});

test('Kimi WARN si falta el perfil, el runtime o el mcp.json no declara servers', () => {
  const sinPerfil = fixture({ kimiProfile: false });
  assert.equal(statusFor(auditTools(sinPerfil.root, sinPerfil.home, ''), 'Kimi'), 'WARN');
  const sinRuntime = fixture({ kimiMcp: null });
  assert.equal(statusFor(auditTools(sinRuntime.root, sinRuntime.home, ''), 'Kimi'), 'WARN');
  const sinServers = fixture({ kimiMcp: '{"other":1}' });
  assert.equal(statusFor(auditTools(sinServers.root, sinServers.home, ''), 'Kimi'), 'WARN');
});

test('Qoder PASS con el contrato completo y WARN sin bridge', () => {
  const ok = fixture({});
  const rows = auditTools(ok.root, ok.home, '');
  const qoder = rows.find((r) => r.tool === 'Qoder');
  assert.ok(qoder, 'fila Qoder presente');
  assert.equal(qoder.status, 'PASS');
  assert.match(qoder.detail, /credenciales NUNCA leídas/);

  const sinBridge = fixture({ qoderBridge: null });
  assert.equal(statusFor(auditTools(sinBridge.root, sinBridge.home, ''), 'Qoder'), 'WARN');
});

test('auditTools incluye las 8 superficies esperadas', () => {
  const { root, home } = fixture({});
  const rows = auditTools(root, home, '');
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
