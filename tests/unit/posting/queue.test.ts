#!/usr/bin/env node
/**
 * Tests for src/posting/queue.ts (auto-posting queue, pure core).
 * Runs with `node --import tsx --test tests/unit/posting/queue.test.ts`.
 *
 * Enforces:
 *   - Enqueue + dedupe por (tenant, eventId, platform)
 *   - Bulk + per-item validation (mixed results)
 *   - Claim FIFO + atomic state transition queued → sending
 *   - markSent terminal
 *   - markFailed con backoff exponencial + jitter, DLQ terminal
 *   - replayDead: dead → queued con attempts=0
 *   - backoff monotonic, capped a 600s, jitter ∈ [0, 1)s
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueue,
  enqueueBulk,
  claimNext,
  markSent,
  markFailed,
  replayDead,
  computeBackoff,
  type QueueDb,
  type QueueRow,
  type QueueClock,
  type QueueLogger,
} from '../../../src/posting/queue.js';

const FROZEN_NOW = '2026-09-21T07:00:00.000Z';

/** In-memory QueueDb para tests (sin SQLite). Implementa la interfaz exacta. */
function makeFakeDb(): QueueDb & { _rows: QueueRow[]; _nextId: number } {
  const rows: QueueRow[] = [];
  let nextId = 1;
  return {
    _rows: rows,
    _nextId: nextId,
    getByEvent(tenantId, eventId, platform) {
      return rows.find((r) => r.tenant_id === tenantId && r.event_id === eventId && r.platform === platform) || null;
    },
    listClaimable(now, limit, statuses = ['queued']) {
      return rows
        .filter((r) => statuses.includes(r.status) && r.next_attempt_at <= now)
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
        .slice(0, limit);
    },
    insert(input) {
      const existing = rows.find(
        (r) => r.tenant_id === input.tenant_id && r.event_id === input.event_id && r.platform === input.platform,
      );
      if (existing) return { row: existing, deduped: true };
      const row: QueueRow = {
        id: nextId++,
        tenant_id: input.tenant_id,
        event_id: input.event_id,
        platform: input.platform,
        payload: input.payload,
        status: input.status,
        attempts: input.attempts,
        next_attempt_at: input.next_attempt_at,
        last_error: input.last_error,
        external_id: null,
        created_at: FROZEN_NOW,
        updated_at: FROZEN_NOW,
      };
      rows.push(row);
      return { row, deduped: false };
    },
    claim(ids, now) {
      let n = 0;
      for (const r of rows) {
        if (ids.includes(r.id) && r.status === 'queued') {
          r.status = 'sending';
          r.updated_at = now;
          n++;
        }
      }
      return n;
    },
    markSent(id, externalId, now) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.status !== 'sending') return 0;
      r.status = 'sent';
      r.external_id = externalId;
      r.updated_at = now;
      return 1;
    },
    markFailed(id, error, nextAttemptAt, terminal, now) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.status !== 'sending') return 0;
      r.status = terminal ? 'dead' : 'queued';
      r.attempts += 1;
      r.last_error = error;
      r.next_attempt_at = nextAttemptAt;
      r.updated_at = now;
      return 1;
    },
    replay(id, now) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.status !== 'dead') return 0;
      r.status = 'queued';
      r.attempts = 0;
      r.next_attempt_at = now;
      r.last_error = null;
      r.updated_at = now;
      return 1;
    },
    countByStatus() {
      const out = { queued: 0, sending: 0, sent: 0, failed: 0, dead: 0 } as Record<string, number>;
      for (const r of rows) out[r.status] = (out[r.status] || 0) + 1;
      return out as ReturnType<QueueDb['countByStatus']>;
    },
  };
}

const fixedClock: QueueClock = { nowIso: () => FROZEN_NOW };
const silentLogger: QueueLogger = { warn() {}, error() {} };

test('computeBackoff: monotonic exponential, capped a 600s, jitter ∈ [0, 1)s', () => {
  const noJitter = () => 0;
  const delays = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => computeBackoff(n, noJitter));
  // values in seconds: 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 600 (capped)
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16_000, 32_000, 64_000, 128_000, 256_000, 512_000, 600_000]);
  // jitter adds 0-1s; with rng=0.5 → base + 0.5s
  const withJitter = computeBackoff(2, () => 0.5);
  assert.equal(withJitter, 4000 + 500);
});

test('enqueue: crea fila queued con attempts=0', () => {
  const db = makeFakeDb();
  const r = enqueue(db, fixedClock, {
    eventId: 'evt_1', platform: 'x', payload: { text: 'hello' },
  });
  assert.equal(r.ok, true);
  assert.equal(r.deduped, false);
  assert.equal(r.row!.attempts, 0);
  assert.equal(r.row!.status, 'queued');
  assert.equal(r.row!.external_id, null);
});

test('enqueue: dedupe por (tenant, event_id, platform) — segunda llamada devuelve la misma fila', () => {
  const db = makeFakeDb();
  const a = enqueue(db, fixedClock, {
    tenantId: 't1', eventId: 'evt_dup', platform: 'linkedin', payload: { text: 'A' },
  });
  const b = enqueue(db, fixedClock, {
    tenantId: 't1', eventId: 'evt_dup', platform: 'linkedin', payload: { text: 'B' },
  });
  assert.equal(a.deduped, false);
  assert.equal(b.deduped, true);
  assert.equal(a.row!.id, b.row!.id);
  // El payload NO se sobreescribe (preserva el original — caller decide si quiere actualizar)
  assert.equal(JSON.parse(b.row!.payload).text, 'A');
});

test('enqueue: dedupe por platform — mismo event_id a X y LinkedIn son DOS filas distintas', () => {
  const db = makeFakeDb();
  const x = enqueue(db, fixedClock, { eventId: 'evt_multi', platform: 'x', payload: {} });
  const li = enqueue(db, fixedClock, { eventId: 'evt_multi', platform: 'linkedin', payload: {} });
  assert.notEqual(x.row!.id, li.row!.id);
  assert.equal(db._rows.length, 2);
});

test('enqueue: rechaza eventId/platform/payload inválidos sin throw', () => {
  const db = makeFakeDb();
  assert.equal(enqueue(db, fixedClock, { eventId: '', platform: 'x', payload: {} }).ok, false);
  assert.equal(enqueue(db, fixedClock, { eventId: 'e', platform: '', payload: {} }).ok, false);
  assert.equal(enqueue(db, fixedClock, { eventId: 'e', platform: 'x', payload: null as never }).ok, false);
  assert.equal(db._rows.length, 0);
});

test('enqueueBulk: mixed results (algunos ok, otros falla validación)', () => {
  const db = makeFakeDb();
  const r = enqueueBulk(db, fixedClock, [
    { eventId: 'e1', platform: 'x', payload: { t: 1 } },
    { eventId: '', platform: 'linkedin', payload: { t: 2 } }, // bad
    { eventId: 'e3', platform: 'instagram', payload: { t: 3 } },
    { eventId: 'e4', platform: '', payload: { t: 4 } }, // bad
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.results.length, 4);
  assert.equal(r.results[0].ok, true);
  assert.equal(r.results[1].ok, false);
  assert.equal(r.results[1].reason, 'invalid-event-id');
  assert.equal(r.results[2].ok, true);
  assert.equal(r.results[3].reason, 'invalid-platform');
  // Solo 2 filas insertadas
  assert.equal(db._rows.length, 2);
});

test('claimNext: FIFO + atomic transition queued → sending', () => {
  const db = makeFakeDb();
  const t1 = '2026-09-21T07:00:00.000Z';
  const t2 = '2026-09-21T07:00:01.000Z';
  const t3 = '2026-09-21T07:00:02.000Z';
  // Override created_at manually
  const r1 = enqueue(db, fixedClock, { eventId: 'e1', platform: 'x', payload: {} });
  const r2 = enqueue(db, fixedClock, { eventId: 'e2', platform: 'x', payload: {} });
  const r3 = enqueue(db, fixedClock, { eventId: 'e3', platform: 'x', payload: {} });
  db._rows.find((r) => r.id === r1.row!.id)!.created_at = t1;
  db._rows.find((r) => r.id === r2.row!.id)!.created_at = t2;
  db._rows.find((r) => r.id === r3.row!.id)!.created_at = t3;

  const claimed = claimNext(db, fixedClock, 2);
  assert.equal(claimed.length, 2);
  assert.equal(claimed[0].event_id, 'e1');
  assert.equal(claimed[1].event_id, 'e2');
  // Atomic transition
  assert.equal(claimed[0].status, 'sending');
  assert.equal(db._rows.find((r) => r.id === r1.row!.id)!.status, 'sending');
  // e3 sigue queued
  assert.equal(db._rows.find((r) => r.id === r3.row!.id)!.status, 'queued');
});

test('claimNext: solo retorna filas con next_attempt_at <= now', () => {
  const db = makeFakeDb();
  const r = enqueue(db, fixedClock, { eventId: 'e1', platform: 'x', payload: {} });
  // Bump next_attempt_at al futuro
  db._rows.find((x) => x.id === r.row!.id)!.next_attempt_at = '2030-01-01T00:00:00.000Z';
  const claimed = claimNext(db, fixedClock, 10);
  assert.equal(claimed.length, 0);
});

test('markSent: terminal, persiste external_id', () => {
  const db = makeFakeDb();
  const r = enqueue(db, fixedClock, { eventId: 'e1', platform: 'x', payload: {} });
  const claimed = claimNext(db, fixedClock, 1);
  const sent = markSent(db, fixedClock, claimed[0].id, 'x_post_999');
  assert.equal(sent.ok, true);
  const row = db._rows.find((x) => x.id === claimed[0].id)!;
  assert.equal(row.status, 'sent');
  assert.equal(row.external_id, 'x_post_999');
});

test('markFailed: backoff + retry hasta maxAttempts, luego DLQ', () => {
  const db = makeFakeDb();
  enqueue(db, fixedClock, { eventId: 'e1', platform: 'x', payload: {} });
  const maxAttempts = 3;
  const rng = () => 0; // jitter=0 para test determinista

  // attempt 1
  const claimed = claimNext(db, fixedClock, 1);
  let r = markFailed(db, fixedClock, silentLogger, claimed[0].id, 'rate_limited', claimed[0].attempts, { maxAttempts, rng });
  assert.equal(r.terminal, false);
  // next_attempt_at = now + 2^1*1000 = 2000ms
  const row1 = db._rows.find((x) => x.id === claimed[0].id)!;
  assert.equal(row1.status, 'queued');
  assert.equal(row1.attempts, 1);
  assert.equal(Date.parse(r.nextAttemptAt) - Date.parse(FROZEN_NOW), 2000);

  // attempt 2 — bump now para que sea claimable
  const now2 = new Date(Date.parse(FROZEN_NOW) + 2000).toISOString();
  const clock2: QueueClock = { nowIso: () => now2 };
  const c2 = claimNext(db, clock2, 1);
  r = markFailed(db, clock2, silentLogger, c2[0].id, 'timeout', c2[0].attempts, { maxAttempts, rng });
  assert.equal(r.terminal, false);
  assert.equal(db._rows.find((x) => x.id === claimed[0].id)!.attempts, 2);
  assert.equal(Date.parse(r.nextAttemptAt) - Date.parse(now2), 4000);

  // attempt 3 — terminal (DLQ)
  const now3 = new Date(Date.parse(now2) + 4000).toISOString();
  const clock3: QueueClock = { nowIso: () => now3 };
  const c3 = claimNext(db, clock3, 1);
  r = markFailed(db, clock3, silentLogger, c3[0].id, 'gone', c3[0].attempts, { maxAttempts, rng });
  assert.equal(r.terminal, true);
  assert.equal(db._rows.find((x) => x.id === claimed[0].id)!.status, 'dead');
  assert.equal(db._rows.find((x) => x.id === claimed[0].id)!.last_error, 'gone');
});

test('markFailed: logger.warn en retry, logger.error en DLQ', () => {
  const db = makeFakeDb();
  const seen: string[] = [];
  const log: QueueLogger = {
    warn: (m) => seen.push('warn:' + m),
    error: (m) => seen.push('error:' + m),
  };
  enqueue(db, fixedClock, { eventId: 'e1', platform: 'x', payload: {} });
  const c = claimNext(db, fixedClock, 1);
  markFailed(db, fixedClock, log, c[0].id, 'try1', c[0].attempts, { maxAttempts: 2, rng: () => 0 });
  markFailed(db, fixedClock, log, c[0].id, 'gone', 1, { maxAttempts: 2, rng: () => 0 });
  assert.equal(seen.length, 2);
  assert.match(seen[0], /retry scheduled/);
  assert.match(seen[1], /DLQ/);
});

test('replayDead: dead → queued con attempts=0 y last_error=null', () => {
  const db = makeFakeDb();
  enqueue(db, fixedClock, { eventId: 'e1', platform: 'x', payload: {} });
  const c = claimNext(db, fixedClock, 1);
  markFailed(db, fixedClock, silentLogger, c[0].id, 'fatal', 0, { maxAttempts: 1, rng: () => 0 });
  assert.equal(db._rows[0].status, 'dead');
  const r = replayDead(db, fixedClock, c[0].id);
  assert.equal(r.ok, true);
  assert.equal(db._rows[0].status, 'queued');
  assert.equal(db._rows[0].attempts, 0);
  assert.equal(db._rows[0].last_error, null);
});

test('replayDead: no-op si la fila no está en dead', () => {
  const db = makeFakeDb();
  enqueue(db, fixedClock, { eventId: 'e1', platform: 'x', payload: {} });
  const c = claimNext(db, fixedClock, 1);
  // Está en 'sending' ahora
  const r = replayDead(db, fixedClock, c[0].id);
  // La operación no falla, pero no cambia nada
  assert.equal(r.ok, true);
  assert.equal(db._rows[0].status, 'sending');
});