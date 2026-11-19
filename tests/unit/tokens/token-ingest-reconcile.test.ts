#!/usr/bin/env node
/**
 * Unit Tests: token-ingest — contrato de agregados token_usage.
 *
 * Regresión (2026-11-17): el ingest incremental sobrescribía `token_usage` con
 * la última ventana ingerida (349k de 41.9M reales). El reconcile debe:
 *  - elevar el agregado al SUM de `token_transactions` por sesión,
 *  - ser idempotente (segunda corrida sin cambios),
 *  - no destruir históricos cuyas transacciones cubren solo parte de la sesión,
 *  - excluir sesiones de sondeo (`probe:`).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { TokenRepo } from '../../../src/database/nexus/repositories/TokenRepo.js';
import { MigrationRunner } from '../../../src/database/nexus/repositories/MigrationRunner.js';

const TENANT = 'gentle-vanguard';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  new MigrationRunner(db).runMigrations();
  return db;
}

function usage(
  db: Database.Database,
  sessionId: string,
  prompt: number,
  completion: number,
  timestamp = '2026-11-17 10:38:00',
): void {
  db.prepare(
    `INSERT INTO token_usage (session_id, prompt_tokens, completion_tokens, cost, model, timestamp, tenant_id)
     VALUES (?, ?, ?, 0, 'm', ?, ?)`,
  ).run(sessionId, prompt, completion, timestamp, TENANT);
}

function txn(
  db: Database.Database,
  messageId: string,
  sessionId: string,
  input: number,
  output: number,
): void {
  db.prepare(
    `INSERT INTO token_transactions (message_id, session_id, agent, model, input_tokens, output_tokens,
       reasoning_tokens, cache_read_tokens, cache_write_tokens, cost, created_at, tenant_id)
     VALUES (?, ?, 'orchestrator', 'm', ?, ?, 0, 0, 0, 0, '2026-11-17 10:38:00', ?)`,
  ).run(messageId, sessionId, input, output, TENANT);
}

function totals(db: Database.Database, sessionId: string): { p: number; c: number } {
  const row = db
    .prepare('SELECT prompt_tokens p, completion_tokens c FROM token_usage WHERE session_id = ?')
    .get(sessionId) as { p: number; c: number };
  return row;
}

test('reconcile eleva token_usage al SUM de token_transactions por sesión', () => {
  const db = createDb();
  usage(db, 'codex-session', 300_000, 49_530);
  txn(db, 'm1', 'codex-session', 20_000_000, 40_000);
  txn(db, 'm2', 'codex-session', 21_998_538, 32_626);

  const result = new TokenRepo(db).reconcileUsageFromTransactions(TENANT);
  assert.deepEqual(result, { sessions: 1, updated: 1 });
  assert.deepEqual(totals(db, 'codex-session'), { p: 41_998_538, c: 72_626 });
  db.close();
});

test('reconcile es idempotente: la segunda corrida no modifica nada', () => {
  const db = createDb();
  usage(db, 'codex-session', 300_000, 49_530);
  txn(db, 'm1', 'codex-session', 1_000_000, 10_000);
  const repo = new TokenRepo(db);
  assert.equal(repo.reconcileUsageFromTransactions(TENANT).updated, 1);
  const before = totals(db, 'codex-session');
  assert.deepEqual(repo.reconcileUsageFromTransactions(TENANT), { sessions: 1, updated: 0 });
  assert.deepEqual(totals(db, 'codex-session'), before);
  db.close();
});

test('reconcile no destruye históricos donde las transacciones son parciales', () => {
  const db = createDb();
  usage(db, 'old-opencode-session', 78_000_000, 191_975);
  txn(db, 'm1', 'old-opencode-session', 500_000, 5_000);
  const result = new TokenRepo(db).reconcileUsageFromTransactions(TENANT);
  assert.equal(result.updated, 0);
  assert.deepEqual(totals(db, 'old-opencode-session'), { p: 78_000_000, c: 191_975 });
  db.close();
});

test('reconcile excluye sesiones de sondeo probe:', () => {
  const db = createDb();
  usage(db, 'probe:model-inference', 1, 30);
  usage(db, 'probe:model-inference', 1, 30);
  txn(db, 'p1', 'probe:model-inference', 5_000, 500);
  const result = new TokenRepo(db).reconcileUsageFromTransactions(TENANT);
  assert.deepEqual(result, { sessions: 0, updated: 0 });
  assert.deepEqual(totals(db, 'probe:model-inference'), { p: 1, c: 30 });
  db.close();
});

test('reconcile no mezcla tenants', () => {
  const db = createDb();
  db.exec("INSERT INTO tenants (id, name) VALUES ('other-tenant', 'Other Tenant')");
  usage(db, 'shared-session', 10, 10);
  db.prepare(
    `INSERT INTO token_transactions (message_id, session_id, input_tokens, output_tokens, tenant_id)
     VALUES ('other-1', 'shared-session', 999, 999, 'other-tenant')`,
  ).run();
  const result = new TokenRepo(db).reconcileUsageFromTransactions(TENANT);
  assert.equal(result.updated, 0);
  assert.deepEqual(totals(db, 'shared-session'), { p: 10, c: 10 });
  db.close();
});
