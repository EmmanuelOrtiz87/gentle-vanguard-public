#!/usr/bin/env node
/**
 * Unit Tests: hidden-spawns sobre scripts Windows versionados (.ps1/.cmd/.bat).
 *
 * Clase 2026-11-26: un agente abría ventanas de validación con
 * `Start-Process powershell` y el owner las atribuía al stack. El gate ahora
 * audita los launchers versionados (root + tools/scripts/apps/docs), no solo
 * el código TS.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectWindowsScripts,
  scanWindowsScript,
} from '../../src/core/watchtower/checks-security.js';

test('scanWindowsScript: Start-Process visible se flaggea; Hidden/NoNewWindow no', () => {
  const bad = 'Start-Process powershell -ArgumentList "-NoProfile"';
  const ok1 = 'Start-Process node -WindowStyle Hidden -ArgumentList "x.ts"';
  const ok2 = 'Start-Process npx -NoNewWindow -PassThru';
  assert.deepEqual(
    scanWindowsScript(bad).map((h) => h.issue),
    ['Start-Process sin -WindowStyle Hidden'],
  );
  assert.deepEqual(scanWindowsScript(ok1), []);
  assert.deepEqual(scanWindowsScript(ok2), []);
});

test("scanWindowsScript: 'start' sin /B se flaggea; con /B o URL no", () => {
  const flagged = scanWindowsScript('start node server.js');
  assert.equal(flagged.length, 1);
  assert.match(flagged[0].issue, /sin \/B/);
  assert.deepEqual(scanWindowsScript('start /B node server.js'), []);
  assert.deepEqual(scanWindowsScript('start "" https://localhost:5173'), []);
});

test('scanWindowsScript: comentarios (#, ::, REM) no cuentan; número de línea 1-based', () => {
  const content = ['REM start node x', '# Start-Process pwsh', ':: start y', 'start z.cmd'].join(
    '\n',
  );
  const hits = scanWindowsScript(content);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 4);
});

test('collectWindowsScripts: root + stack dirs, ignora .archive/node_modules/build raíz', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-scripts-'));
  const w = (rel: string) => {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, '@echo off\n');
  };
  w('start.bat');
  w('tools/auto.cmd');
  w('apps/x/start.cmd');
  w('docs/presentations/decks/build/export.ps1');
  w('.archive/legacy/old.ps1');
  w('build/out.cmd');
  w('apps/x/node_modules/pkg/install.ps1');
  const found = collectWindowsScripts(root).map((f) =>
    f.slice(root.length + 1).replace(/\\/g, '/'),
  );
  assert.deepEqual(found.sort(), [
    'apps/x/start.cmd',
    'docs/presentations/decks/build/export.ps1',
    'start.bat',
    'tools/auto.cmd',
  ]);
});
