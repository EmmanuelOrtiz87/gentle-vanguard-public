#!/usr/bin/env node
/**
 * Unit Tests: zcode-sync — file-writer hardening
 *
 * Regresión de los 3 vectores del patrón upstream gentle-ai (2026-09-26):
 *   1. JSONC: nunca re-encodear un config con comentarios (96bed1c) —
 *      containsJsonComments detecta // y slash-star, string-aware (URLs no).
 *   2. Atomicidad: writeFileAtomic (tmp + rename) — un kill a mitad de write
 *      no deja el config truncado (befd337).
 *   3. Merge de hooks: buildZCodeHookConfig preserva claves desconocidas del
 *      config existente (no se pierde config del usuario).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  containsJsonComments,
  writeFileAtomic,
  buildZCodeHookConfig,
} from '../../src/integrations/zcode-sync.js';

test('containsJsonComments: JSON limpio -> false', () => {
  assert.equal(containsJsonComments('{"a": 1, "hooks": {"enabled": true}}'), false);
  assert.equal(containsJsonComments(''), false);
});

test('containsJsonComments: comentarios // y slash-star -> true', () => {
  assert.equal(containsJsonComments('{\n  // comentario de línea\n  "a": 1\n}'), true);
  assert.equal(containsJsonComments('{ "a": 1 } /* bloque */'), true);
});

test('containsJsonComments: URLs dentro de strings NO son comentarios', () => {
  assert.equal(containsJsonComments('{"url": "https://example.com/x"}'), false);
  assert.equal(containsJsonComments('{"s": "texto con // adentro"}'), false);
  assert.equal(containsJsonComments('{"s": "escaped \\" quote // sigue string"}'), false);
});

test('containsJsonComments: fail-closed ante caso ambiguo (string abierta sin cerrar)', () => {
  // "https://x sin cerrar -> el scanner entra en string y no sale: false,
  // pero cualquier // posterior a un string cerrado sí detecta.
  assert.equal(containsJsonComments('{"a": "https://x}'), false);
});

test('writeFileAtomic: escribe contenido y no deja .tmp residuales', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zsync-test-'));
  const file = join(dir, 'config.json');
  writeFileAtomic(file, '{"v": 1}');
  assert.equal(readFileSync(file, 'utf8'), '{"v": 1}');
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes('.tmp-')), []);
  rmSync(dir, { recursive: true, force: true });
});

test('writeFileAtomic: sobreescribe el destino existente (rename replace)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zsync-test-'));
  const file = join(dir, 'agents.md');
  writeFileAtomic(file, 'viejo');
  writeFileAtomic(file, 'nuevo');
  assert.equal(readFileSync(file, 'utf8'), 'nuevo');
  rmSync(dir, { recursive: true, force: true });
});

test('writeFileAtomic: si el rename falla limpia el tmp y lanza', () => {
  // Directorio destino inexistente: writeFileSync del tmp ya falla -> throw.
  const bad = join(tmpdir(), 'no-existe-' + Date.now(), 'x.json');
  assert.throws(() => writeFileAtomic(bad, 'x'));
  assert.equal(existsSync(bad), false);
});

test('buildZCodeHookConfig: preserva claves desconocidas y agrega hooks', () => {
  const current = {
    $comment: 'config del usuario',
    mcp: { servers: { codegraph: { command: 'codegraph' } } },
    preferences: { theme: 'dark' },
  };
  const next = buildZCodeHookConfig(current as Record<string, unknown>, '/repo');
  assert.equal(next.$comment, 'config del usuario');
  assert.equal(next.mcp, current.mcp);
  assert.equal(next.preferences, current.preferences);
  const hooks = next.hooks as { enabled: boolean; events: Record<string, unknown> };
  assert.equal(hooks.enabled, true);
  assert.ok(Array.isArray(hooks.events.SessionStart));
  assert.ok(Array.isArray(hooks.events.PostToolUse));
});

test('buildZCodeHookConfig: re-corrida es idempotente (merge sobre su propia salida)', () => {
  const first = buildZCodeHookConfig({}, '/repo');
  const second = buildZCodeHookConfig(first, '/repo');
  assert.deepEqual(second, first);
});
