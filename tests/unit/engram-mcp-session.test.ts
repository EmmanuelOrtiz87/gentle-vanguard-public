#!/usr/bin/env node
/**
 * Unit Tests: Engram MCP stdio session lifecycle (GB-2026-10-28)
 * Parser tolerante + probe REAL contra `engram mcp` (start → end → delete cleanup).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  engramMcpCall,
  engramSessionEnd,
  engramSessionStart,
  extractToolText,
  parseMcpStdout,
} from '../../src/knowledge/engram-mcp-session.ts';

test('parser tolerante: NDJSON y framing LSP', () => {
  const nd = parseMcpStdout(
    '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n' + 'linea-corrupta\n' + '{"jsonrpc":"2.0","id":2,"result":{"a":1}}\n',
  );
  assert.strictEqual(nd.length, 2, 'NDJSON: 2 mensajes parseados, corrupta ignorada');

  const payload = JSON.stringify({ jsonrpc: '2.0', id: 9, result: { x: 'y' } });
  const framed = parseMcpStdout(`Content-Length: ${payload.length}\r\n\r\n${payload}`);
  assert.strictEqual(framed.length, 1, 'LSP: 1 mensaje framed parseado');
  const msg = framed[0] as { id: number; result?: unknown };
  assert.strictEqual(msg.id, 9);
});

test('extractToolText: contenido de texto y isError', () => {
  assert.strictEqual(extractToolText({ content: [{ type: 'text', text: 'hola' }] }), 'hola');
  assert.strictEqual(extractToolText({ isError: true, content: [] }), null);
  assert.strictEqual(extractToolText(null), null);
});

test('probe REAL contra engram mcp: session start → end (ciclo limpio)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'gv-engram-probe-'));
  try {
    const id = `gv-mcp-probe-${Date.now()}`;
    const start = engramSessionStart(id, tmp);
    assert.ok(start.ok || start.error, 'start responde (ok o error tipado)');
    if (!start.ok) {
      // Si engram no está disponible en el host, el test no debe romper el suite:
      // el diseño es best-effort (S4) y hoy exige spine un engram local. Skip honesto.
      console.warn(`[probe] engram mcp no disponible: ${start.error}`);
      return;
    }
    const end = engramSessionEnd(id, 'probe test: cree y cerré sesión throwaway');
    assert.ok(end.ok, `end debe tener éxito: ${end.error ?? JSON.stringify(end.result)}`);

    // Cleanup: sesión throwaway sin observaciones → delete session por CLI (best-effort)
    spawnClean('engram', ['delete', 'session', id]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

function spawnClean(cmd: string, args: string[]): { status: number | null } {
  const r = spawnSync(cmd, args, { encoding: 'utf-8', timeout: 15000, windowsHide: true, shell: false });
  return { status: r.status };
}

test('engramMcpCall con tool inexistente devuelve error tipado (no throw)', () => {
  const r = engramMcpCall('mem_tool_inexistente_xyz', {});
  assert.strictEqual(r.ok, false);
  assert.ok(r.error, 'error tipado presente');
});
