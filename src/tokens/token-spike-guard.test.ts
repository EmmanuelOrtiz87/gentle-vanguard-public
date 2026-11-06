/**
 * CONTRATO del token-spike-guard: la medicion tiene que EXISTIR y los umbrales
 * tienen que estar calibrados contra el volumen real.
 *
 * Reproduce el fallo real (2026-11-06):
 *
 *   1) El fallback contra Nexus consultaba `WHERE date(timestamp) = ...`, pero
 *      `token_transactions` NO tiene columna `timestamp` (es `created_at`).
 *      SQLite tiraba "no such column", el catch devolvia 0 y el guard NUNCA
 *      media nada: un guard que no mide no puede avisar.
 *
 *   2) La metrica era DIARIA mientras la alerta dice "tokens en la sesion": con
 *      el p50 diario real (23,5M) el umbral "emergency 15M" se habria disparado
 *      en el 99% de los dias.
 *
 *   3) Los umbrales estaban sin calibrar contra el volumen real: "critical 12M"
 *      y "emergency 15M" caian por DEBAJO del p99 real por sesion (78,5M).
 *
 * Corre con:  node --import tsx --test src/tokens/token-spike-guard.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import {
  NEXUS_TOKEN_SQL,
  TOKEN_GUARD_CONFIG,
  TOKEN_THRESHOLDS,
  parseTokenSource,
  pickMostComplete,
  readSessionTokens,
} from './token-spike-guard.js';

const require_ = createRequire(import.meta.url);

const REAL_SCHEMA = `
  CREATE TABLE token_transactions (
    id INTEGER PRIMARY KEY,
    message_id TEXT,
    session_id TEXT,
    agent TEXT,
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    reasoning_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_write_tokens INTEGER,
    cost REAL,
    created_at TEXT,
    tenant_id TEXT,
    agent_name TEXT
  );
`;

async function makeDb(): Promise<{
  db: import('better-sqlite3').Database;
  close: () => void;
}> {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(REAL_SCHEMA);
  return { db, close: () => db.close() };
}

describe('token-spike-guard: la medicion existe', () => {
  it('POSITIVO: parsea la forma real de token-usage.json (falla con el parser viejo)', () => {
    const real = {
      sessionId: 'mvs_abc',
      totalInputTokens: 4743,
      totalOutputTokens: 1526,
      totalTokens: 6269,
      cost_usd: 0,
      model: 'minimax/MiniMax-M3.1-Flash',
    };
    const parsed = parseTokenSource(real);
    assert.ok(parsed, 'debe reconocer la forma del archivo real');
    assert.equal(parsed.total, 6269);
    assert.equal(parsed.input, 4743);
    assert.equal(parsed.output, 1526);
  });

  it('POSITIVO: parsea la forma real de session-current.json', () => {
    const real = {
      sessionId: 'session-20261106T1632',
      totalInputTokens: 100,
      totalOutputTokens: 20,
    };
    const parsed = parseTokenSource(real);
    assert.ok(parsed);
    assert.equal(parsed.total, 120);
  });

  it('POSITIVO: parsea la forma real de stack-live-observability-latest.json', () => {
    const real = {
      token: {
        status: 'PASS',
        used_today: 6269,
        current_session: {
          session_id: 'mvs_abc',
          input_tokens: 4743,
          output_tokens: 1526,
          total_tokens: 6269,
        },
      },
    };
    const parsed = parseTokenSource(real);
    assert.ok(parsed);
    assert.equal(parsed.total, 6269);
  });

  it('POSITIVO: con varias fuentes se queda con la MAS COMPLETA (nunca sub-reporta)', () => {
    const picked = pickMostComplete([
      { input: 100, output: 10, reasoning: 0, total: 110 },
      { input: 861898, output: 190260, reasoning: 0, total: 1052158 },
      null,
    ]);
    assert.equal(picked.total, 1052158);
  });

  it('NEGATIVO: una fuente sin datos de tokens no inventa ceros como medicion', () => {
    assert.equal(parseTokenSource({ status: 'ok' }), null);
    assert.equal(parseTokenSource(null), null);
    assert.equal(parseTokenSource({ token: { status: 'PASS' } }), null);
    // Sin ninguna fuente valida: total 0, pero no un "110" inventado.
    assert.equal(pickMostComplete([null, null]).total, 0);
  });

  it('POSITIVO: lee los tokens acumulados de la sesion (falla con el SQL viejo)', async () => {
    const { db, close } = await makeDb();
    try {
      db.prepare(
        `INSERT INTO token_transactions (session_id, input_tokens, output_tokens, reasoning_tokens, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('sess-a', 1000, 200, 50, '2026-11-01 10:00:00');
      db.prepare(
        `INSERT INTO token_transactions (session_id, input_tokens, output_tokens, reasoning_tokens, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('sess-a', 500, 100, 25, '2026-11-01 10:05:00');
      db.prepare(
        `INSERT INTO token_transactions (session_id, input_tokens, output_tokens, reasoning_tokens, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('sess-b', 999999, 1, 1, '2026-11-01 11:00:00');

      const metrics = readSessionTokens(db as never, 'sess-a');
      assert.equal(metrics.input, 1500);
      assert.equal(metrics.output, 300);
      assert.equal(metrics.reasoning, 75);
      assert.equal(metrics.total, 1875);
    } finally {
      close();
    }
  });

  it('NEGATIVO: el SQL del guard solo usa columnas que EXISTEN en el schema real', async () => {
    const { db, close } = await makeDb();
    try {
      const columns = new Set(
        (db.prepare('PRAGMA table_info(token_transactions)').all() as { name: string }[]).map(
          (c) => c.name,
        ),
      );
      const referenced = [...NEXUS_TOKEN_SQL.matchAll(/\b([a-z_]+)\b/g)]
        .map((m) => m[1])
        .filter(
          (t) =>
            ![
              'select',
              'sum',
              'coalesce',
              'from',
              'where',
              'as',
              'and',
              'or',
              'null',
              // aliases del SELECT (no son columnas de la tabla)
              'input',
              'output',
              'reasoning',
              // nombre de la tabla
              'token_transactions',
            ].includes(t),
        );

      for (const col of new Set(referenced)) {
        assert.ok(columns.has(col), `el SQL referencia la columna inexistente '${col}'`);
      }
      // El bug exacto: `timestamp` no existe en token_transactions.
      assert.ok(!/\btimestamp\b/.test(NEXUS_TOKEN_SQL), 'el SQL no debe consultar `timestamp`');
    } finally {
      close();
    }
  });

  it('NEGATIVO: una sesion desconocida da 0, no una excepcion ni un total de otra sesion', async () => {
    const { db, close } = await makeDb();
    try {
      db.prepare(
        `INSERT INTO token_transactions (session_id, input_tokens, output_tokens, reasoning_tokens, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('sess-a', 1000, 200, 50, '2026-11-01 10:00:00');

      const metrics = readSessionTokens(db as never, 'sess-inexistente');
      assert.equal(metrics.total, 0);
    } finally {
      close();
    }
  });

  it('POSITIVO: sin id de sesion usa la sesion MAS RECIENTE', async () => {
    const { db, close } = await makeDb();
    try {
      db.prepare(
        `INSERT INTO token_transactions (session_id, input_tokens, output_tokens, reasoning_tokens, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('sess-old', 1000, 200, 50, '2026-10-01 10:00:00');
      db.prepare(
        `INSERT INTO token_transactions (session_id, input_tokens, output_tokens, reasoning_tokens, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('sess-new', 10, 5, 0, '2026-11-05 10:00:00');

      const metrics = readSessionTokens(db as never, null);
      assert.equal(metrics.total, 15, 'debe tomar la sesion mas reciente');
    } finally {
      close();
    }
  });
});

describe('token-spike-guard: calibracion de umbrales', () => {
  it('POSITIVO: los umbrales estan ordenados y son crecientes', () => {
    const values = Object.values(TOKEN_THRESHOLDS);
    for (let i = 1; i < values.length; i++) {
      assert.ok(
        values[i] > values[i - 1],
        `umbral ${i} (${values[i]}) debe ser mayor que el anterior (${values[i - 1]})`,
      );
    }
  });

  it('POSITIVO: cada umbral tiene su accion declarada', () => {
    const actions = TOKEN_GUARD_CONFIG.actions as Record<string, unknown>;
    for (const key of Object.keys(TOKEN_THRESHOLDS)) {
      assert.ok(key in actions, `falta la accion para el umbral ${key}`);
    }
  });

  it('NEGATIVO: el umbral de emergencia no puede dispararse en el volumen ya observado', () => {
    const dbPath = join(process.cwd(), '.runtime', 'gentle-vanguard.db');
    if (!existsSync(dbPath)) return; // sin datos locales: no hay nada que afirmar

    const Database = require_('better-sqlite3') as unknown as new (
      p: string,
      o?: unknown,
    ) => import('better-sqlite3').Database;
    const db = new Database(dbPath, { readonly: true });
    try {
      // Poblacion de calibracion: sesiones REALES (<=400 transacciones).
      // Un session_id con >400 transacciones es un bucket agregado (varias
      // sesiones mezcladas), no una sesion: no es comparable con lo que el
      // guard mide para la sesion en curso.
      const rows = db
        .prepare(
          `SELECT session_id,
                  SUM(COALESCE(input_tokens,0)) + SUM(COALESCE(output_tokens,0))
                    + SUM(COALESCE(reasoning_tokens,0)) AS total,
                  COUNT(*) AS n
           FROM token_transactions
           WHERE session_id IS NOT NULL AND session_id <> ''
           GROUP BY session_id`,
        )
        .all() as { total: number; n: number }[];
      const real = rows.filter((r) => r.n <= 400).map((r) => r.total || 0);
      if (!real.length) return;

      const max = Math.max(...real);
      assert.ok(
        TOKEN_THRESHOLDS.emergency120M > max,
        `el umbral de emergencia (${TOKEN_THRESHOLDS.emergency120M}) debe superar el maximo de sesiones reales (${max})`,
      );
    } finally {
      db.close();
    }
  });
});
