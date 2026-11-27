#!/usr/bin/env node
/**
 * Unit Tests: console-flash-watch (parsers + guard de auto-amplificación).
 *
 * Incidente 2026-11-26: el observador lanzado por el autostart de cada sesión
 * generaba la tormenta que investigaba (233 PowerShell + 1035 conhost en 150 s)
 * y el parser de `tasklist /v` registraba toda consola oculta como ventana
 * visible (cells[8] conservaba la comilla: `N/D"` no matcheaba). Ambas cosas
 * tienen que quedar clavadas por test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseTasklist, parseTasklistVerbose } from '../../src/ops/console-flash-watch.js';

const ROOT = resolve(import.meta.dirname, '..', '..');

test('parseTasklistVerbose: consola oculta (N/D con comilla) => visible=false', () => {
  const csv = '"cmd.exe","1234","Console","1","2.345 K","Running","PC\\user","0:00:01","N/D"';
  const rows = parseTasklistVerbose(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].image, 'cmd.exe');
  assert.equal(rows[0].pid, 1234);
  assert.equal(rows[0].windowTitle, 'N/D');
  assert.equal(rows[0].visible, false);
});

test('parseTasklistVerbose: N/A en inglés tambien es oculta; título real es visible', () => {
  const csv = [
    '"powershell.exe","200","Console","1","50 K","Running","PC\\user","0:00:01","N/A"',
    '"powershell.exe","201","Console","1","50 K","Running","PC\\user","0:00:02","Windows PowerShell 5.1"',
  ].join('\n');
  const rows = parseTasklistVerbose(csv);
  assert.deepEqual(
    rows.map((r) => r.visible),
    [false, true],
  );
  assert.equal(rows[1].windowTitle, 'Windows PowerShell 5.1');
});

test('parseTasklistVerbose: filas sin pid numérico (headers/ruido) se descartan', () => {
  const csv = '"Nombre de imagen","PID","Sesión"\n"cmd.exe","abc","Console","1","1 K","","",""';
  assert.deepEqual(parseTasklistVerbose(csv), []);
});

test('parseTasklist: variante simple devuelve los pids', () => {
  const csv = '"cmd.exe","111","Console","1","1 K"\n"conhost.exe","222","Console","1","1 K"';
  assert.deepEqual(parseTasklist(csv), [111, 222]);
});

test('regresión: el autostart NO lanza console-flash-watch por sesión', () => {
  const launcher = readFileSync(resolve(ROOT, 'src/session/session-autostart-detached.ts'), 'utf8');
  const code = launcher.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(
    !code.includes('console-flash-watch'),
    'el launcher volvió a spawnear el observador: medido 2026-11-26, lanzarlo por sesión crea la tormenta que investiga',
  );
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.match(pkg.scripts['windows:flash-watch'] ?? '', /console-flash-watch/);
});
