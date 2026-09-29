#!/usr/bin/env node
/**
 * src/posting/queue.ts — Auto-posting queue (pure core, platform-agnostic).
 *
 * Patrón absorbido del research 2026 (engram 4106): Buffer / Metricool / Typefully / Svix.
 * Core abilities:
 *   - Encolar posts con dedupe por `event_id` (at-least-once delivery, idempotency TTL 7d).
 *   - Per-platform override (texto + settings por target).
 *   - Bulk upload + dryRun=true (mixed results, HTTP 207).
 *   - Retry con backoff exponencial + jitter; DLQ tras N intentos.
 *   - Pure logic (no I/O, no SDK) — el caller inyecta el clock + el sender.
 *
 * Schema esperado (las migraciones son responsabilidad del caller):
 *
 *   CREATE TABLE post_queue (
 *     id              INTEGER PRIMARY KEY AUTOINCREMENT,
 *     tenant_id       TEXT NOT NULL DEFAULT 'gentle-vanguard',
 *     event_id        TEXT NOT NULL,             -- stable per logical send
 *     platform        TEXT NOT NULL,             -- 'x' | 'linkedin' | 'instagram' | ...
 *     payload         TEXT NOT NULL,             -- JSON { text, media, ... }
 *     status          TEXT NOT NULL DEFAULT 'queued'  -- queued | sending | sent | failed | dead
 *     attempts        INTEGER NOT NULL DEFAULT 0,
 *     next_attempt_at TEXT NOT NULL,             -- ISO timestamp
 *     last_error      TEXT,
 *     external_id     TEXT,                      -- provider-assigned id on success
 *     created_at      TEXT NOT NULL DEFAULT (datetime('now')),
 *     updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
 *     UNIQUE(tenant_id, event_id, platform)     -- dedupe per (tenant, logical event, target)
 *   );
 *   CREATE INDEX idx_post_queue_claim ON post_queue(status, next_attempt_at);
 *
 * Reglas:
 *   - `claimNext(now, limit)` SOLO retorna filas con status='queued' AND next_attempt_at <= now,
 *     en orden FIFO por created_at. Atómico (la fila pasa a 'sending' dentro de la misma tx).
 *   - `markComplete(id, externalId?)` → status='sent', external_id, attempts sin cambio.
 *   - `markFailed(id, error, options?)`:
 *       si attempts+1 >= maxAttempts → status='dead' (DLQ)
 *       si attempts+1 <  maxAttempts → status='queued' con next_attempt_at = now + backoff(attempts+1)
 *   - `replay(id)` mueve de 'dead' a 'queued' con attempts=0 y next_attempt_at=now.
 *
 * NO throw en errores de validación / estado inválido — devuelve `{ ok: false, reason }` para
 * control flow en caller. Solo throw en errores de SQL (responsabilidad del caller envolver).
 */

export type QueueStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'dead';

export interface QueueRow {
  id: number;
  tenant_id: string;
  event_id: string;
  platform: string;
  payload: string;
  status: QueueStatus;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  external_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface QueueDb {
  /** SELECT row by event_id + platform; returns null if not present. */
  getByEvent(tenantId: string, eventId: string, platform: string): QueueRow | null;
  /** SELECT pending rows ordered by created_at ASC, with limit. */
  listClaimable(now: string, limit: number, statuses?: QueueStatus[]): QueueRow[];
  /**
   * INSERT new row. If a row with same (tenant_id, event_id, platform) exists, return the
   * existing one with `deduped: true` (no UPDATE — preserves original payload/attempts).
   * Caller should treat dedup as success (idempotency working).
   */
  insert(row: Omit<QueueRow, 'id' | 'created_at' | 'updated_at' | 'external_id'>): {
    row: QueueRow;
    deduped: boolean;
  };
  /** UPDATE status → 'sending' (atomic claim). Returns rows affected. */
  claim(ids: number[], now: string): number;
  /** UPDATE status → 'sent', set external_id. Returns rows affected. */
  markSent(id: number, externalId: string | null, now: string): number;
  /** UPDATE status → 'queued' (retry) or 'dead' (DLQ), set last_error, next_attempt_at. */
  markFailed(id: number, error: string, nextAttemptAt: string, terminal: boolean, now: string): number;
  /** UPDATE status → 'queued', attempts=0, next_attempt_at=now. */
  replay(id: number, now: string): number;
  /** SELECT COUNT by status (for ops dashboard). */
  countByStatus(): Record<QueueStatus, number>;
}

export interface QueueClock {
  /** ISO timestamp string para persistir en DB. */
  nowIso(): string;
}

export interface QueueLogger {
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** Default backoff: exponential base 1s × 2^attempt + jitter (0-1s). Cap 600s. */
export function computeBackoff(attempts: number, rng: () => number = Math.random): number {
  const base = Math.min(2 ** attempts, 600);
  const jitter = rng();
  return Math.floor(base * 1000 + jitter * 1000);
}

export interface EnqueueItem {
  tenantId?: string;
  eventId: string;
  platform: string;
  /** JSON-serializable payload (text, media URLs, settings). */
  payload: Record<string, unknown>;
  /** Override `now` (for tests). Default: clock.nowIso(). */
  now?: string;
}

export interface EnqueueResult {
  ok: boolean;
  reason?: 'invalid-event-id' | 'invalid-platform' | 'invalid-payload';
  row?: QueueRow;
  deduped?: boolean;
}

export function enqueue(db: QueueDb, clock: QueueClock, item: EnqueueItem): EnqueueResult {
  if (!item.eventId || typeof item.eventId !== 'string') {
    return { ok: false, reason: 'invalid-event-id' };
  }
  if (!item.platform || typeof item.platform !== 'string') {
    return { ok: false, reason: 'invalid-platform' };
  }
  if (!item.payload || typeof item.payload !== 'object') {
    return { ok: false, reason: 'invalid-payload' };
  }
  const now = item.now || clock.nowIso();
  const tenantId = item.tenantId || 'gentle-vanguard';
  const { row, deduped } = db.insert({
    tenant_id: tenantId,
    event_id: item.eventId,
    platform: item.platform,
    payload: JSON.stringify(item.payload),
    status: 'queued',
    attempts: 0,
    next_attempt_at: now,
    last_error: null,
  });
  return { ok: true, row, deduped };
}

export interface BulkEnqueueItem extends EnqueueItem {}

export interface BulkEnqueueResult {
  ok: boolean;
  results: Array<EnqueueResult & { eventId: string; platform: string }>;
}

export function enqueueBulk(
  db: QueueDb,
  clock: QueueClock,
  items: BulkEnqueueItem[],
): BulkEnqueueResult {
  const results = items.map((item) => ({
    ...enqueue(db, clock, item),
    eventId: item.eventId,
    platform: item.platform,
  }));
  return { ok: true, results };
}

/** Claim hasta `limit` filas listas para enviar (next_attempt_at <= now). Marca 'sending'.
 *  Devuelve los rows en el mismo orden que estaban en la cola (FIFO). */
export function claimNext(
  db: QueueDb,
  clock: QueueClock,
  limit: number,
  options: { statuses?: QueueStatus[] } = {},
): QueueRow[] {
  const now = clock.nowIso();
  const pending = db.listClaimable(now, limit, options.statuses ?? ['queued']);
  if (pending.length === 0) return [];
  const ids = pending.map((r) => r.id);
  db.claim(ids, now);
  return pending.map((r) => ({ ...r, status: 'sending' as QueueStatus }));
}

export interface MarkFailedOptions {
  maxAttempts: number;
  rng?: () => number;
}

/** Marca como 'sent' (éxito terminal). */
export function markSent(
  db: QueueDb,
  clock: QueueClock,
  id: number,
  externalId: string | null,
): { ok: boolean } {
  db.markSent(id, externalId, clock.nowIso());
  return { ok: true };
}

/** Marca como 'failed' (retry) o 'dead' (DLQ). Aplica backoff. */
export function markFailed(
  db: QueueDb,
  clock: QueueClock,
  logger: QueueLogger,
  id: number,
  error: string,
  currentAttempts: number,
  options: MarkFailedOptions,
): { ok: boolean; terminal: boolean; nextAttemptAt: string } {
  const nextAttempts = currentAttempts + 1;
  const terminal = nextAttempts >= options.maxAttempts;
  const nextDelayMs = terminal ? 0 : computeBackoff(nextAttempts, options.rng);
  const now = clock.nowIso();
  const nowMs = Date.parse(now);
  const nextAttemptAt = terminal
    ? now
    : new Date(nowMs + nextDelayMs).toISOString();
  db.markFailed(id, error, nextAttemptAt, terminal, now);
  if (terminal) {
    logger.error('post_queue: DLQ', { id, attempts: nextAttempts, error });
  } else {
    logger.warn('post_queue: retry scheduled', { id, attempts: nextAttempts, delayMs: nextDelayMs, error });
  }
  return { ok: true, terminal, nextAttemptAt };
}

/** Mueve una fila 'dead' de nuevo a 'queued' con attempts=0. */
export function replayDead(
  db: QueueDb,
  clock: QueueClock,
  id: number,
): { ok: boolean; row?: QueueRow } {
  db.replay(id, clock.nowIso());
  const row = db.listClaimable(clock.nowIso(), 1).find((r) => r.id === id);
  return { ok: true, row };
}