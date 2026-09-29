/**
 * Outcome feedback auto-capture (honest, derived signals only).
 *
 * Derives a `feedback` row at session-close time from REAL session signals:
 * - negative ('down'): session has error traces, a terminal failure status, or
 *   failed close phases.
 * - positive ('up'): terminal success status + zero error traces + tokens used
 *   within the per-session budget.
 * - inconclusive: writes NOTHING (never fabricates sentiment).
 *
 * Schema notes (Nexus `.runtime/gentle-vanguard.db`):
 * - feedback.type has a CHECK constraint `type IN ('up','down')` — the
 *   dashboard manual handler (POST /api/feedback) uses the same values, so
 *   auto-capture maps positive→'up', negative→'down'.
 * - span_id is UNIQUE per tenant; the auto row uses `<span_id>:auto-outcome`
 *   so it can coexist with manual feedback on the same span while still being
 *   linked to the session via trace_id (what src/eval/continuous-eval.ts
 *   joins on: feedback.trace_id IN (SELECT trace_id FROM traces WHERE session_id=?)).
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Database } from 'better-sqlite3';

export const AUTO_OUTCOME_SPAN_SUFFIX = ':auto-outcome';
export const OUTCOME_FEEDBACK_SOURCE = 'auto-outcome';

const POSITIVE_STATUSES = new Set(['completed', 'success', 'succeeded']);
const NEGATIVE_STATUSES = new Set(['failed', 'error', 'aborted']);

export interface OutcomeSignals {
  sessionStatus: string | null | undefined;
  errorTraceCount: number;
  tokensUsed: number;
  tokenBudget: number;
  failedPhaseCount: number;
}

export type OutcomeFeedbackType = 'up' | 'down';

export interface OutcomeFeedbackRow {
  trace_id: string;
  span_id: string;
  type: OutcomeFeedbackType;
}

export interface CaptureOutcomeResult {
  written: boolean;
  type?: OutcomeFeedbackType;
  reason: string;
}

/**
 * Pure derivation rule. Returns 'up', 'down' or null (inconclusive → no row).
 */
export function deriveOutcomeFeedback(signals: OutcomeSignals): OutcomeFeedbackType | null {
  const status = (signals.sessionStatus ?? '').toLowerCase();

  // Negative wins first: any hard failure signal marks the session negative,
  // even if other signals look fine.
  if (NEGATIVE_STATUSES.has(status)) return 'down';
  if (signals.errorTraceCount > 0) return 'down';
  if (signals.failedPhaseCount > 0) return 'down';

  if (POSITIVE_STATUSES.has(status) && signals.tokensUsed <= signals.tokenBudget) {
    return 'up';
  }

  // 'active', 'abandoned' (no activity), over-budget successes, unknown status:
  // inconclusive — do not write anything.
  return null;
}

/**
 * Reads the per-session token budget from config/token-budget-guard.json.
 * Returns a fallback (3M) if the file is missing or malformed.
 */
export function readPerSessionTokenBudget(configPath: string): number {
  const fallback = 3_000_000;
  try {
    if (!existsSync(configPath)) return fallback;
    const cfg = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      tokenBudget?: { limits?: { perSession?: number } };
      perSession?: number;
    };
    const raw = cfg.tokenBudget?.limits?.perSession ?? cfg.perSession;
    const n = typeof raw === 'string' ? Number(raw) : raw;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

interface TraceLink {
  trace_id: string;
  span_id: string;
}

function findSessionTrace(db: Database, sessionId: string, tenantId: string): TraceLink | null {
  const row = db
    .prepare(
      `SELECT trace_id, span_id FROM traces
       WHERE session_id = ? AND tenant_id = ?
       ORDER BY start_time DESC LIMIT 1`,
    )
    .get(sessionId, tenantId) as TraceLink | undefined;
  return row ? { trace_id: row.trace_id, span_id: row.span_id } : null;
}

/**
 * Collects the real signals for a session from Nexus and, when the derivation
 * is conclusive, writes the derived feedback row (idempotent: INSERT OR
 * REPLACE keyed on the auto span id).
 */
export function captureOutcomeFeedback(
  db: Database,
  sessionId: string,
  opts: { tenantId?: string; configDir?: string; failedPhaseCount?: number } = {},
): CaptureOutcomeResult {
  const tenantId = opts.tenantId ?? 'gentle-vanguard';
  const configDir = opts.configDir ?? join(process.cwd(), 'config');

  const session = db
    .prepare(`SELECT id, status, tokens_used FROM sessions WHERE id = ? AND tenant_id = ?`)
    .get(sessionId, tenantId) as
    { id: string; status: string | null; tokens_used: number | null } | undefined;

  if (!session) {
    return { written: false, reason: `session ${sessionId} not found in Nexus` };
  }

  const errorTraceCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM traces WHERE session_id = ? AND tenant_id = ? AND status = 'error'`,
      )
      .get(sessionId, tenantId) as { c: number }
  ).c;

  const tokensFromTx = (
    db
      .prepare(
        `SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS t
         FROM token_transactions WHERE session_id = ? AND tenant_id = ?`,
      )
      .get(sessionId, tenantId) as { t: number }
  ).t;
  const tokensUsed = Math.max(tokensFromTx, session.tokens_used ?? 0);

  const type = deriveOutcomeFeedback({
    sessionStatus: session.status,
    errorTraceCount,
    tokensUsed,
    tokenBudget: readPerSessionTokenBudget(join(configDir, 'token-budget-guard.json')),
    failedPhaseCount: opts.failedPhaseCount ?? 0,
  });

  if (type === null) {
    return { written: false, reason: 'inconclusive signals — no feedback written' };
  }

  const trace = findSessionTrace(db, sessionId, tenantId);
  if (!trace) {
    return {
      written: false,
      reason: `no trace found for session ${sessionId} — cannot link feedback`,
    };
  }

  db.prepare(
    `INSERT OR REPLACE INTO feedback (trace_id, span_id, type, tenant_id, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  ).run(trace.trace_id, `${trace.span_id}${AUTO_OUTCOME_SPAN_SUFFIX}`, type, tenantId);

  return {
    written: true,
    type,
    reason: `status=${session.status ?? 'null'} errorTraces=${errorTraceCount} tokens=${tokensUsed} failedPhases=${opts.failedPhaseCount ?? 0}`,
  };
}
