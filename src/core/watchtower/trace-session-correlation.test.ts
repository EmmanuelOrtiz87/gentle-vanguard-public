/**
 * CONTRATO del medidor de correlación traza→sesión (BL-MW2SD1LY-BUU1).
 *
 * Reglas que protegen el watchtower de falsos positivos y de falsos verdes:
 *  - Nexus ausente o bloqueada → `available: false` (el caller emite SKIP).
 *  - Solo cuenta trazas dentro de la ventana: la historia pre-fix con NULL no
 *    puede hacer sonar la alarma para siempre.
 *  - `session_id` vacío cuenta como faltante (mismo criterio que el write path).
 *
 * Ejecutar: node --import tsx --test src/core/watchtower/trace-session-correlation.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { readTraceSessionCorrelation } from './checks-data.js';

const HOUR = 60 * 60 * 1000;

describe('readTraceSessionCorrelation', () => {
  let root: string;
  let dbPath: string;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gv-trace-correlation-'));
    const runtime = join(root, '.runtime');
    mkdirSync(runtime, { recursive: true });
    dbPath = join(runtime, 'gentle-vanguard.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE traces (
        span_id TEXT PRIMARY KEY,
        start_time INTEGER,
        session_id TEXT
      );
    `);
    const insert = db.prepare(
      'INSERT INTO traces (span_id, start_time, session_id) VALUES (?, ?, ?)',
    );
    const now = Date.now();
    // Dentro de la ventana: 3 resueltas, 2 sin sesión.
    insert.run('a', now - 1 * HOUR, 'session-current');
    insert.run('b', now - 2 * HOUR, 'session-current');
    insert.run('c', now - 3 * HOUR, 'ses_tool');
    insert.run('d', now - 4 * HOUR, null);
    insert.run('e', now - 5 * HOUR, '');
    // Fuera de la ventana de 24 h: historia pre-fix, NO debe contar.
    insert.run('old-1', now - 30 * HOUR, null);
    insert.run('old-2', now - 30 * HOUR, null);
    db.close();
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('mide solo la ventana y cuenta NULL y vacío como faltantes', () => {
    const result = readTraceSessionCorrelation(root, 24);
    assert.equal(result.available, true);
    assert.equal(result.recent, 5, '3 resueltas + 2 faltantes dentro de 24 h');
    assert.equal(result.missing, 2, 'NULL y cadena vacía cuentan igual');
  });

  it('la historia pre-fix queda fuera de la ventana', () => {
    const wide = readTraceSessionCorrelation(root, 48);
    assert.equal(wide.recent, 7);
    assert.equal(wide.missing, 4, 'las 2 viejas entran solo al ensanchar la ventana');
  });

  it('Nexus ausente no revienta: se reporta como no medible', () => {
    const empty = mkdtempSync(join(tmpdir(), 'gv-trace-correlation-empty-'));
    try {
      const result = readTraceSessionCorrelation(empty, 24);
      assert.equal(result.available, false);
      assert.equal(result.recent, 0);
      assert.equal(result.missing, 0);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('una base sin tabla traces se reporta como no medible', () => {
    const broken = mkdtempSync(join(tmpdir(), 'gv-trace-correlation-broken-'));
    try {
      mkdirSync(join(broken, '.runtime'), { recursive: true });
      const db = new Database(join(broken, '.runtime', 'gentle-vanguard.db'));
      db.exec('CREATE TABLE unrelated (id INTEGER)');
      db.close();
      const result = readTraceSessionCorrelation(broken, 24);
      assert.equal(result.available, false, 'no puede inventar una medición');
    } finally {
      rmSync(broken, { recursive: true, force: true });
    }
  });
});
