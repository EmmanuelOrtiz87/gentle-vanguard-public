/**
 * Retención de sesión: la política vive en config/session-autostart.config.json
 * (`retention`); los valores del código son solo fallback. Antes de esto el
 * bloque `retention` del config era decorativo (el script hardcodeaba todo).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadRetentionConfig,
  retentionEnabled,
  pruneCloseReports,
} from '../../src/session/session-retention.js';
import { setContinuationBaseDir, stageAck } from '../../src/core/continuation.js';

function fixture(retention?: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'gv-retention-'));
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(
    join(root, 'config', 'session-autostart.config.json'),
    JSON.stringify(retention === undefined ? {} : { retention }),
  );
  return root;
}

test('sin config: usa los defaults del código', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-retention-empty-'));
  try {
    const cfg = loadRetentionConfig(root);
    assert.equal(cfg.maxSessionFiles, 10);
    assert.equal(cfg.maxBackups, 14);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('config válido sobreescribe defaults y conserva claves ausentes', () => {
  const root = fixture({ maxSessionFiles: 3, maxBackups: 7, bogus: 'x' });
  try {
    const cfg = loadRetentionConfig(root);
    assert.equal(cfg.maxSessionFiles, 3);
    assert.equal(cfg.maxBackups, 7);
    assert.equal(cfg.maxCheckpointsPerSession, 5);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('valores inválidos (0, negativos, string) no pisan el default', () => {
  const root = fixture({ maxSessionFiles: 0, maxBackups: -1, maxCloseReports: '20' });
  try {
    const cfg = loadRetentionConfig(root);
    assert.equal(cfg.maxSessionFiles, 10);
    assert.equal(cfg.maxBackups, 14);
    assert.equal(cfg.maxCloseReports, 20);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retention.enabled=false desactiva prune; ausente o true lo permite', () => {
  const off = fixture({ enabled: false });
  const on = fixture({ enabled: true });
  const none = fixture(undefined);
  try {
    assert.equal(retentionEnabled(off), false);
    assert.equal(retentionEnabled(on), true);
    assert.equal(retentionEnabled(none), true);
  } finally {
    for (const root of [off, on, none]) rmSync(root, { recursive: true, force: true });
  }
});

test('repo real: el config vigente se lee y coincide con la política declarada', () => {
  const cfg = loadRetentionConfig(join(import.meta.dirname, '..', '..'));
  assert.equal(cfg.maxSessionFiles, 10);
  assert.equal(cfg.sessionAgeThresholdDays, 30);
  assert.equal(retentionEnabled(join(import.meta.dirname, '..', '..')), true);
});

test('un reporte respaldado por un ack pendiente no se poda (evidencia del cierre)', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-retention-reports-'));
  const ackRoot = mkdtempSync(join(tmpdir(), 'gv-retention-acks-'));
  setContinuationBaseDir(ackRoot);
  try {
    // 22 reportes, ordenados newest-first como los devuelve getCloseReports().
    const reports: string[] = [];
    for (let i = 0; i < 22; i++) {
      const id = `case${String(i).padStart(2, '0')}`;
      const file = join(root, `close-report-${id}.json`);
      writeFileSync(file, JSON.stringify({ overall: 'FAIL' }), 'utf-8');
      reports.push(file);
    }
    stageAck('session.close.case21', 'FAIL'); // el más viejo espera review

    const result = pruneCloseReports(false, reports);

    assert.equal(result.heldBack, 1);
    assert.ok(existsSync(reports[21]), 'el reporte del ack pendiente sobrevive');
    assert.ok(!existsSync(reports[20]), 'el candidato más viejo sí se poda');
    assert.equal(result.removed, 1); // solo se poda el candidato más viejo
    assert.equal(result.kept, 21);
  } finally {
    setContinuationBaseDir(null);
    rmSync(root, { recursive: true, force: true });
    rmSync(ackRoot, { recursive: true, force: true });
  }
});
