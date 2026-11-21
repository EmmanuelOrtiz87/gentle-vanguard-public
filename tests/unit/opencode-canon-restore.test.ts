#!/usr/bin/env node
/**
 * Unit Tests: opencode-canon-restore — el canon se verifica contra el árbol
 * que se push-ea (bitácora 2026-11-21).
 *
 * Contratest del incidente real: el working-tree de opencode.json se drift-eó
 * EN VIVO (perdió e2e-agent) con flota "sana" — el heal del autostart no
 * dispara (solo reacciona a modelos sin tools) y el push cayó en
 * agent-reachability leyendo un árbol que el propio stack desvió. Invariante
 * fijado aquí: diff working-tree vs HEAD → snapshot forense + restauración
 * desde HEAD; ilegible en HEAD → NO se destruye nada.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restoreOpencodeCanon } from '../../src/tools/opencode-canon-restore.ts';

const CANON = JSON.stringify({
  agent: {
    orchestrator: { model: 'opencode-zen-C/big-pickle' },
    'e2e-agent': { model: 'ollama/qwen3-14b-32k' },
  },
});

function fixture(opencodeJson: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'gv-canon-restore-'));
  if (opencodeJson !== null) writeFileSync(join(root, 'opencode.json'), opencodeJson);
  return root;
}

test('working-tree idéntico a HEAD → clean, sin snapshot, archivo intacto', () => {
  const root = fixture(CANON);
  const report = restoreOpencodeCanon(root, () => CANON);
  assert.equal(report.action, 'clean');
  assert.equal(report.snapshotPath, undefined);
  assert.equal(readFileSync(join(root, 'opencode.json'), 'utf8'), CANON);
});

test('diff de SOLO EOL (autocrlf) no es drift → clean', () => {
  const root = fixture(CANON.replaceAll('\n', '\r\n'));
  const report = restoreOpencodeCanon(root, () => CANON);
  assert.equal(report.action, 'clean');
});

test('drift estructural (agente perdido) → snapshot forense + restauración desde HEAD', () => {
  const drifted = JSON.stringify({
    agent: { orchestrator: { model: 'opencode-zen-C/big-pickle' } },
  });
  const root = fixture(drifted);
  const report = restoreOpencodeCanon(root, () => CANON);
  assert.equal(report.action, 'restored');
  assert.ok(report.snapshotPath, 'el snapshot debe existir antes de tocar');
  assert.ok(readFileSync(report.snapshotPath!, 'utf8').length > 0, 'snapshot vacío');
  // el árbol quedó con el canon de HEAD (e2e-agent de vuelta)
  assert.equal(readFileSync(join(root, 'opencode.json'), 'utf8'), CANON);
});

test('archivo AUSENTE en el árbol pero en HEAD → recreado desde HEAD', () => {
  const root = fixture(null);
  const report = restoreOpencodeCanon(root, () => CANON);
  assert.equal(report.action, 'restored');
  assert.equal(readFileSync(join(root, 'opencode.json'), 'utf8'), CANON);
});

test('HEAD ilegible NO destruye el árbol (fallo honesto)', () => {
  const drifted = JSON.stringify({ agent: { whatever: true } });
  const root = fixture(drifted);
  const report = restoreOpencodeCanon(root, () => null);
  assert.equal(report.action, 'failed');
  // el archivo drifted sigue en disco (no se pierde evidencia sin copia)
  assert.ok(readFileSync(join(root, 'opencode.json'), 'utf8').includes('whatever'));
});

test('sin opencode.json ni en HEAD ni en el árbol → clean (repo sin canon aún)', () => {
  const root = fixture(null);
  const report = restoreOpencodeCanon(root, () => null);
  assert.equal(report.action, 'clean');
  assert.ok(!existsSync(join(root, 'opencode.json')));
});

// ─── detectOpencodeCanonDrift (cadencia de sesión, watchtower) ───────────────

import { detectOpencodeCanonDrift } from '../../src/tools/opencode-canon-restore.ts';

test('detect: drift → snapshot drift-session sin tocar el árbol', () => {
  const drifted = JSON.stringify({
    agent: { orchestrator: { model: 'ollama/qwen3-14b-32k' } },
  });
  const root = fixture(drifted);
  const report = detectOpencodeCanonDrift(root, () => CANON);
  assert.equal(report.action, 'drift');
  assert.ok(report.snapshotPath, 'el snapshot de sesión debe existir');
  assert.ok(report.snapshotPath!.includes('drift-session-'), 'snapshot con prefijo de sesión');
  assert.ok(readFileSync(report.snapshotPath!, 'utf8').includes('qwen3-14b-32k'));
  // NUNCA toca el árbol: el drift sigue ahí para el humano
  assert.equal(readFileSync(join(root, 'opencode.json'), 'utf8'), drifted);
});

test('detect: clean → sin snapshot, sin tocar', () => {
  const root = fixture(CANON);
  const report = detectOpencodeCanonDrift(root, () => CANON);
  assert.equal(report.action, 'clean');
  assert.equal(report.snapshotPath, undefined);
});

test('detect: HEAD ilegible → failed sin tocar nada', () => {
  const root = fixture(CANON);
  const report = detectOpencodeCanonDrift(root, () => null);
  assert.equal(report.action, 'failed');
  assert.equal(readFileSync(join(root, 'opencode.json'), 'utf8'), CANON);
});
