/**
 * continuous-eval.ts — Continuous evaluation pipeline over REAL Nexus traces
 * (STACK-EVOLUTION-PLAN-2026, item F3.1).
 *
 * Builds a golden dataset from the stack's own operational data in Nexus
 * (.runtime/gentle-vanguard.db), scores it deterministically (no LLM calls),
 * persists each run into a new `eval_runs` table and compares against the
 * previous run to detect regressions (gate).
 *
 * Schema note: canonical Nexus migrations live in
 * apps/web-dashboard/server/database/repositories/MigrationRunner.ts, which is
 * owned by another workstream. This module therefore ensures its own table
 * lazily with CREATE TABLE IF NOT EXISTS (idempotent, documented in
 * docs/reference/CONTINUOUS-EVAL.md).
 */

import { join, resolve } from 'path';
import { existsSync } from 'fs';
import Database from 'better-sqlite3';
import { aliasTableExists, sessionPlusAliasIds } from '../session/session-id-bridge.js';

/* ── Types ── */

export interface GoldenItem {
  /** session id used as dataset item id */
  id: string;
  label: 'positive' | 'negative';
  /** total tokens (input+output) attributed to the session */
  tokens: number;
  /** observed duration in ms (traces preferred, session lifetime fallback) */
  durationMs: number;
}

export interface GoldenDataset {
  items: GoldenItem[];
  positives: number;
  negatives: number;
}

export interface DatasetScores {
  datasetSize: number;
  successRate: number;
  tokenEfficiency: number;
  durationEfficiency: number;
  /** 0..1 aggregate */
  aggregateScore: number;
  avgTokens: number;
  medianTokens: number;
  p95Tokens: number;
  medianDurationMs: number;
  p95DurationMs: number;
}

export interface TrendInfo {
  previousRunId: number | null;
  previousAggregateScore: number | null;
  delta: number | null;
  /** relative change in % vs previous run (positive = improvement) */
  deltaPercent: number | null;
  direction: 'first-run' | 'improved' | 'regressed' | 'stable';
}

export interface EvalRunRecord {
  id: number;
  created_at: string;
  dataset_size: number;
  scores_json: string;
  trend_json: string;
}

export interface RunEvalOptions {
  /** max sessions considered (most recent first), default 200 */
  limit?: number;
  /** token budget reference for efficiency scoring, default 50_000 */
  tokenBudget?: number;
  /** duration budget reference for efficiency scoring (ms), default 120_000 */
  durationBudgetMs?: number;
  /** gate: max allowed aggregate drop in % vs previous run, default 5 */
  gateThresholdPercent?: number;
}

export interface EvalRunResult {
  dataset: GoldenDataset;
  scores: DatasetScores;
  trend: TrendInfo;
  gate: {
    enabled: boolean;
    passed: boolean;
    thresholdPercent: number;
    reason: string;
  };
  runId: number | null;
}

/* ── Table bootstrap (lazy, idempotent) ── */

export const EVAL_RUNS_DDL = `
CREATE TABLE IF NOT EXISTS eval_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  dataset_size INTEGER NOT NULL,
  scores_json TEXT NOT NULL,
  trend_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_eval_runs_created_at ON eval_runs (created_at);
`;

export function ensureEvalRunsTable(db: Database.Database): void {
  db.exec(EVAL_RUNS_DDL);
}

/* ── Dataset building ── */

interface SessionRow {
  id: string;
  status: string | null;
  tokens_used: number | null;
  created_at: string | null;
  updated_at: string | null;
}

const POSITIVE_SESSION_STATUSES = new Set(['completed', 'success', 'succeeded']);
const NEGATIVE_SESSION_STATUSES = new Set(['failed', 'error', 'aborted', 'abandoned']);

/**
 * Builds the golden dataset from Nexus:
 * - positives: recent sessions with success status or positive feedback
 * - negatives: recent sessions with failure status, negative feedback, or
 *   traces in `error` status
 * Tokens come from token_transactions (sum) with sessions.tokens_used as
 * fallback; duration from traces (max span) with session lifetime fallback.
 */
export function buildGoldenDataset(
  db: Database.Database,
  opts: RunEvalOptions = {},
): GoldenDataset {
  const limit = opts.limit ?? 200;

  // Two-pass fetch: labeled sessions (terminal status) always included, then
  // the most recent sessions fill the remaining quota. A burst of unlabeled
  // 'active' sessions must not starve the dataset.
  const labeled = db
    .prepare(
      `SELECT s.id, s.status, s.tokens_used, s.created_at, s.updated_at
       FROM sessions s
       WHERE s.status IN ('completed','success','succeeded','failed','error','aborted','abandoned')
       ORDER BY s.updated_at DESC
       LIMIT ?`,
    )
    .all(limit) as SessionRow[];
  const recent = db
    .prepare(
      `SELECT s.id, s.status, s.tokens_used, s.created_at, s.updated_at
       FROM sessions s
       ORDER BY s.updated_at DESC
       LIMIT ?`,
    )
    .all(limit) as SessionRow[];

  const byId = new Map<string, SessionRow>();
  for (const row of [...labeled, ...recent]) {
    if (byId.size >= limit && !byId.has(row.id)) continue;
    byId.set(row.id, row);
  }
  const sessions = [...byId.values()];

  const items: GoldenItem[] = [];
  // Session-id bridge: traces/token_transactions usan ids de herramienta
  // (ses_*) distintos de sessions.id; resolvemos ambos namespaces vía alias.
  const useAliases = aliasTableExists(db);

  for (const s of sessions) {
    const ids = useAliases ? sessionPlusAliasIds(db, s.id) : [s.id];
    const ph = ids.map(() => '?').join(',');

    const positiveFeedback = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM feedback WHERE trace_id IN
             (SELECT trace_id FROM traces WHERE session_id IN (${ph}))
           AND type IN ('up','positive','thumbs_up','upvote','like')`,
        )
        .get(...ids) as { c: number }
    ).c;

    const negativeFeedback = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM feedback WHERE trace_id IN
             (SELECT trace_id FROM traces WHERE session_id IN (${ph}))
           AND type IN ('down','negative','thumbs_down','downvote','dislike')`,
        )
        .get(...ids) as { c: number }
    ).c;

    const errorTraces = (
      db
        .prepare(`SELECT COUNT(*) AS c FROM traces WHERE session_id IN (${ph}) AND status = 'error'`)
        .get(...ids) as { c: number }
    ).c;

    let label: 'positive' | 'negative' | null = null;
    if (NEGATIVE_SESSION_STATUSES.has(s.status ?? '') || negativeFeedback > 0 || errorTraces > 0) {
      label = 'negative';
    } else if (POSITIVE_SESSION_STATUSES.has(s.status ?? '') || positiveFeedback > 0) {
      label = 'positive';
    }

    // Sessions without any signal are skipped (no label). Ghost sessions swept to
    // 'abandoned' with zero recorded activity are NOT failures — they are autostart
    // artifacts with no data, so counting them would permanently tank the score.
    const hasActivity =
      (s.tokens_used ?? 0) > 0 || positiveFeedback + negativeFeedback > 0 || errorTraces > 0;
    if (label === null || (label === 'negative' && s.status === 'abandoned' && !hasActivity)) {
      continue;
    }

    const tok = (
      db
        .prepare(
          `SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS t
           FROM token_transactions WHERE session_id IN (${ph})`,
        )
        .get(...ids) as { t: number }
    ).t;

    const traceStats = db
      .prepare(
        `SELECT MAX(duration) AS maxDur, COUNT(*) AS c FROM traces WHERE session_id IN (${ph})`,
      )
      .get(...ids) as { maxDur: number | null; c: number };

    let durationMs = traceStats.maxDur ?? 0;
    if ((!durationMs || traceStats.c === 0) && s.created_at && s.updated_at) {
      const start = Date.parse(s.created_at);
      const end = Date.parse(s.updated_at);
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        durationMs = end - start;
      }
    }

    items.push({
      id: s.id,
      label,
      tokens: tok > 0 ? tok : (s.tokens_used ?? 0),
      durationMs,
    });
  }

  return {
    items,
    positives: items.filter((i) => i.label === 'positive').length,
    negatives: items.filter((i) => i.label === 'negative').length,
  };
}

/* ── Scoring (deterministic, heuristic, no LLM) ── */

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function scoreDataset(
  dataset: GoldenDataset,
  opts: RunEvalOptions = {},
): DatasetScores {
  const tokenBudget = opts.tokenBudget ?? 50_000;
  const durationBudgetMs = opts.durationBudgetMs ?? 120_000;
  const { items } = dataset;

  const positives = items.filter((i) => i.label === 'positive');
  const successRate = items.length > 0 ? positives.length / items.length : 0;

  const tokens = items.map((i) => i.tokens).sort((a, b) => a - b);
  const durations = items.map((i) => i.durationMs).sort((a, b) => a - b);
  const avgTokens = tokens.length > 0 ? tokens.reduce((a, b) => a + b, 0) / tokens.length : 0;

  // Efficiency: ratio of budget actually consumed (capped at 1 = fully
  // efficient). Uses the average for tokens and p95 for duration so a single
  // outlier session does not dominate.
  const tokenEfficiency =
    avgTokens <= 0 ? 1 : Math.min(1, tokenBudget / avgTokens);
  const p95Dur = percentile(durations, 95);
  const durationEfficiency =
    p95Dur <= 0 ? 1 : Math.min(1, durationBudgetMs / p95Dur);

  const aggregateScore = Number(
    (
      successRate * 0.5 +
      tokenEfficiency * 0.3 +
      durationEfficiency * 0.2
    ).toFixed(4),
  );

  return {
    datasetSize: items.length,
    successRate: Number(successRate.toFixed(4)),
    tokenEfficiency: Number(tokenEfficiency.toFixed(4)),
    durationEfficiency: Number(durationEfficiency.toFixed(4)),
    aggregateScore,
    avgTokens: Math.round(avgTokens),
    medianTokens: percentile(tokens, 50),
    p95Tokens: percentile(tokens, 95),
    medianDurationMs: percentile(durations, 50),
    p95DurationMs: p95Dur,
  };
}

/* ── Trend + gate ── */

export function computeTrend(current: number, previous: EvalRunRecord | null): TrendInfo {
  if (!previous) {
    return {
      previousRunId: null,
      previousAggregateScore: null,
      delta: null,
      deltaPercent: null,
      direction: 'first-run',
    };
  }
  let prevScore: number | null = null;
  try {
    prevScore = (JSON.parse(previous.scores_json) as DatasetScores).aggregateScore;
  } catch {
    prevScore = null;
  }
  if (prevScore === null || !Number.isFinite(prevScore)) {
    return {
      previousRunId: previous.id,
      previousAggregateScore: null,
      delta: null,
      deltaPercent: null,
      direction: 'first-run',
    };
  }
  const delta = Number((current - prevScore).toFixed(4));
  const deltaPercent =
    prevScore !== 0 ? Number(((delta / Math.abs(prevScore)) * 100).toFixed(2)) : null;
  const EPS = 0.0001;
  const direction =
    Math.abs(delta) <= EPS ? 'stable' : delta > 0 ? 'improved' : 'regressed';
  return {
    previousRunId: previous.id,
    previousAggregateScore: prevScore,
    delta,
    deltaPercent,
    direction,
  };
}

export function evaluateGate(
  trend: TrendInfo,
  thresholdPercent: number,
): { passed: boolean; reason: string } {
  if (trend.direction === 'first-run') {
    return { passed: true, reason: 'first run — no baseline to compare' };
  }
  if (trend.deltaPercent === null) {
    return { passed: true, reason: 'previous score unreadable — treated as first run' };
  }
  if (trend.deltaPercent >= -thresholdPercent) {
    return {
      passed: true,
      reason: `aggregate ${trend.deltaPercent >= 0 ? '+' : ''}${trend.deltaPercent}% vs previous run (threshold -${thresholdPercent}%)`,
    };
  }
  return {
    passed: false,
    reason: `aggregate regressed ${trend.deltaPercent}% vs previous run (threshold -${thresholdPercent}%)`,
  };
}

/* ── Persistence ── */

export function getPreviousRun(db: Database.Database): EvalRunRecord | null {
  const tableExists = (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='eval_runs'`)
      .get() as { name: string } | undefined
  );
  if (!tableExists) return null;
  return (
    (db
      .prepare(`SELECT id, created_at, dataset_size, scores_json, trend_json
                FROM eval_runs ORDER BY id DESC LIMIT 1`)
      .get() as EvalRunRecord | undefined) ?? null
  );
}

export function persistRun(
  db: Database.Database,
  scores: DatasetScores,
  trend: TrendInfo,
): number {
  ensureEvalRunsTable(db);
  const info = db
    .prepare(
      `INSERT INTO eval_runs (created_at, dataset_size, scores_json, trend_json)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      new Date().toISOString(),
      scores.datasetSize,
      JSON.stringify(scores),
      JSON.stringify(trend),
    );
  return Number(info.lastInsertRowid);
}

/* ── Orchestration ── */

export function resolveDbPath(explicit?: string): string {
  if (explicit) return resolve(explicit);
  if (process.env.GENTLE_VANGUARD_DB_DIR) {
    return join(process.env.GENTLE_VANGUARD_DB_DIR, 'gentle-vanguard.db');
  }
  // Default: repo root .runtime/gentle-vanguard.db (this file lives in src/eval)
  return resolve(import.meta.dirname ?? '.', '..', '..', '.runtime', 'gentle-vanguard.db');
}

export function runContinuousEval(
  db: Database.Database,
  opts: RunEvalOptions & { gate?: boolean } = {},
): EvalRunResult {
  const dataset = buildGoldenDataset(db, opts);
  const scores = scoreDataset(dataset, opts);
  const previous = getPreviousRun(db);
  const trend = computeTrend(scores.aggregateScore, previous);
  const thresholdPercent = opts.gateThresholdPercent ?? 5;
  const gateResult = evaluateGate(trend, thresholdPercent);
  // Empty dataset = no signal. A midpoint aggregate (0.5) would poison the trend
  // baseline, so the run is NOT persisted and the gate stays neutral.
  const hasData = dataset.items.length > 0;
  const runId = hasData ? persistRun(db, scores, trend) : null;
  const gate = hasData ? gateResult : { passed: true, reason: 'no data — run skipped' as const };

  return {
    dataset,
    scores,
    trend,
    gate: {
      enabled: Boolean(opts.gate),
      passed: gate.passed,
      thresholdPercent,
      reason: gate.reason,
    },
    runId,
  };
}

export function openNexus(dbPath: string): Database.Database {
  if (!existsSync(dbPath)) {
    throw new Error(`Nexus DB not found at ${dbPath} — run \`npm run db:init\` first`);
  }
  return new Database(dbPath);
}
