#!/usr/bin/env node
/**
 * stale-session-sweeper.ts — Terminal-status sweeper for Nexus `sessions`.
 *
 * ROOT CAUSE this fixes: sessions are created/updated by the metrics-writer
 * sync (apps/web-dashboard/server/database/metrics-writer.ts) copying status
 * from .session/context-log/<id>/.state.json, which is written as 'active' at
 * session start and never transitions to a terminal status — the close
 * orchestrator (src/session/session-close/) writes JSON reports but never
 * updates the sessions table. Result: hundreds of zombie 'active' rows that
 * starve the continuous-eval golden dataset, the learnable routing table and
 * cost-per-session metrics.
 *
 * Heuristics (deterministic, no LLM):
 *   candidate : status='active' AND updated_at older than --stale-hours (24h).
 *   hard floor: sessions updated in the last 2h are NEVER touched, even if a
 *               smaller --stale-hours is passed (protects live sessions).
 *   idle      : has traces or token activity within 7 days (recent work — the
 *               session is resting, not dead).
 *   completed : no recent activity, but the session had meaningful activity
 *               over its lifetime (tokens/messages/traces/transactions > 0).
 *   abandoned : no recent activity and no meaningful lifetime activity.
 *
 * Usage:
 *   node --import tsx src/session/stale-session-sweeper.ts             # dry-run
 *   node --import tsx src/session/stale-session-sweeper.ts --apply     # write
 *   node --import tsx src/session/stale-session-sweeper.ts --stale-hours 48
 *   node --import tsx src/session/stale-session-sweeper.ts --db path/to.db
 *
 * Idempotent: terminal statuses are never re-classified; a second run is a
 * no-op. Status transitions only; updated_at is preserved so recency
 * ordering is unaffected. A `swept` note is added to metadata JSON.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import Database from 'better-sqlite3';

/* ── Options ── */

export interface SweepOptions {
  /** sessions whose updated_at is older than this are candidates (hours) */
  staleHours: number;
  /** sessions updated within this window are never touched (hours, hard floor) */
  protectHours: number;
  /** activity within this window classifies as 'idle' (days) */
  idleWindowDays: number;
  apply: boolean;
  dbPath: string;
  /** also write terminal status back to .session/context-log/<id>/.state.json
   *  so the dashboard metrics-writer sync does not resurrect rows to 'active' */
  syncContextLog: boolean;
  /** root dir used to locate .session/context-log (defaults to repo root) */
  repoRoot: string;
}

export interface SweepDecision {
  id: string;
  newStatus: 'idle' | 'completed' | 'abandoned';
  reason: string;
}

export interface SweepSummary {
  timestamp: string;
  applied: boolean;
  staleHours: number;
  protectHours: number;
  scannedActive: number;
  skippedProtected: number;
  wouldSweep: SweepDecision[];
  counts: Record<string, number>;
  remainingActive: number;
  /** context-log .state.json files rewritten to the terminal status (apply only) */
  syncedContextLogs?: number;
}

export const DEFAULT_STALE_HOURS = 24;
export const DEFAULT_PROTECT_HOURS = 2;
export const DEFAULT_IDLE_WINDOW_DAYS = 7;
const MIN_STALE_HOURS = 0.5;

export function resolveSweepDbPath(explicit?: string): string {
  if (explicit) return resolve(explicit);
  if (process.env.GENTLE_VANGUARD_DB_DIR) {
    return join(process.env.GENTLE_VANGUARD_DB_DIR, 'gentle-vanguard.db');
  }
  return resolve(import.meta.dirname ?? '.', '..', '..', '.runtime', 'gentle-vanguard.db');
}

export function parseSweepArgs(argv: string[]): Partial<SweepOptions> & { help?: boolean } {
  const out: Partial<SweepOptions> & { help?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--dry-run') out.apply = false;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--stale-hours') out.staleHours = Number(argv[++i]);
    else if (a === '--protect-hours') out.protectHours = Number(argv[++i]);
    else if (a === '--idle-window-days') out.idleWindowDays = Number(argv[++i]);
    else if (a === '--db') out.dbPath = argv[++i];
  }
  return out;
}

/* ── Context-log sync ── */

/**
 * Write the terminal status back to .session/context-log/<id>/.state.json.
 * The dashboard metrics-writer periodically upserts sessions from these
 * files; without this sync it would resurrect swept rows to 'active'.
 * Best-effort: missing/corrupt state files are skipped.
 */
export function syncContextLogStatus(
  repoRoot: string,
  sessionId: string,
  status: string,
  nowIso: string,
): boolean {
  const statePath = join(repoRoot, '.session', 'context-log', sessionId, '.state.json');
  try {
    if (!existsSync(statePath)) return false;
    const state = JSON.parse(readFileSync(statePath, 'utf-8')) as Record<string, unknown>;
    if (state.status === status) return false;
    state.status = status;
    state.updatedAt = nowIso;
    writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/* ── Core sweep ── */

interface ActiveRow {
  id: string;
  updated_at: string | null;
  created_at: string | null;
  tokens_used: number | null;
  message_count: number | null;
}

function classifySession(
  db: Database.Database,
  s: ActiveRow,
  now: number,
  idleWindowMs: number,
): SweepDecision {
  const idleThreshold = now - idleWindowMs;

  const lastTrace = (
    db
      .prepare(`SELECT MAX(COALESCE(start_time, 0)) AS t FROM traces WHERE session_id = ?`)
      .get(s.id) as { t: number | null }
  ).t;
  // traces.start_time is epoch ms in Nexus; guard against epoch-seconds.
  const lastTraceMs =
    lastTrace && lastTrace > 0 ? (lastTrace < 1e12 ? lastTrace * 1000 : lastTrace) : 0;

  const lastTx = (
    db
      .prepare(`SELECT MAX(created_at) AS t FROM token_transactions WHERE session_id = ?`)
      .get(s.id) as { t: string | null }
  ).t;
  const lastTxMs = lastTx ? Date.parse(lastTx) : 0;

  const sessionActivityMs = Math.max(
    Date.parse(s.updated_at ?? '') || 0,
    Date.parse(s.created_at ?? '') || 0,
  );

  const lastActivityMs = Math.max(lastTraceMs, lastTxMs, sessionActivityMs);

  if (lastActivityMs >= idleThreshold) {
    return { id: s.id, newStatus: 'idle', reason: 'activity within idle window (7d)' };
  }

  const traceCount = (
    db.prepare(`SELECT COUNT(*) AS c FROM traces WHERE session_id = ?`).get(s.id) as { c: number }
  ).c;
  const txCount = (
    db.prepare(`SELECT COUNT(*) AS c FROM token_transactions WHERE session_id = ?`).get(s.id) as {
      c: number;
    }
  ).c;
  const meaningful =
    (s.tokens_used ?? 0) > 0 || (s.message_count ?? 0) > 0 || traceCount > 0 || txCount > 0;

  return meaningful
    ? {
        id: s.id,
        newStatus: 'completed',
        reason: 'no recent activity, meaningful lifetime activity',
      }
    : { id: s.id, newStatus: 'abandoned', reason: 'no recent activity, no meaningful activity' };
}

export function sweepStaleSessions(
  db: Database.Database,
  opts: SweepOptions,
  now: number = Date.now(),
): SweepSummary {
  const staleHours = Math.max(opts.staleHours, MIN_STALE_HOURS);
  // Hard floor: protection window always applies, even if staleHours < protectHours.
  const protectHours = Math.max(opts.protectHours, 2);
  const staleMs = staleHours * 3_600_000;
  const protectMs = protectHours * 3_600_000;
  const idleWindowMs = opts.idleWindowDays * 86_400_000;

  // Candidates: active AND older than BOTH the stale threshold and the
  // protection floor (updated_at older than max(stale, protect) ago).
  const cutoff = Math.max(staleMs, protectMs);
  const cutoffIso = new Date(now - cutoff).toISOString();
  // Rows may store ISO ("...T...Z") or SQLite datetime ("... ...") encodings;
  // julianday() normalizes both. Unparseable timestamps yield NULL and are
  // excluded from candidacy (fail-safe).
  const candidates = db
    .prepare(
      `SELECT id, updated_at, created_at, tokens_used, message_count
       FROM sessions
       WHERE status = 'active'
         AND updated_at IS NOT NULL
         AND julianday(updated_at) < julianday(?)`,
    )
    .all(cutoffIso) as ActiveRow[];

  const allActive = (
    db.prepare(`SELECT COUNT(*) AS c FROM sessions WHERE status='active'`).get() as { c: number }
  ).c;
  const protectedCount = Math.max(0, allActive - candidates.length);

  const decisions: SweepDecision[] = candidates.map((s) =>
    classifySession(db, s, now, idleWindowMs),
  );

  let syncedContextLogs = 0;

  if (opts.apply && decisions.length > 0) {
    const update = db.prepare(
      `UPDATE sessions SET status = ?, metadata = COALESCE(metadata, '{}')
       WHERE id = ? AND status = 'active'`,
    );
    const applyTx = db.transaction((rows: SweepDecision[]) => {
      for (const d of rows) {
        const info = update.run(d.newStatus, d.id);
        if (info.changes === 0) continue; // already terminal (idempotent)
        // Stamp sweep provenance into metadata (best-effort, non-fatal).
        try {
          const meta = JSON.parse(
            (
              db.prepare(`SELECT metadata FROM sessions WHERE id = ?`).get(d.id) as {
                metadata: string;
              }
            ).metadata || '{}',
          ) as Record<string, unknown>;
          meta.swept = { at: new Date(now).toISOString(), from: 'active', to: d.newStatus };
          db.prepare(`UPDATE sessions SET metadata = ? WHERE id = ?`).run(
            JSON.stringify(meta),
            d.id,
          );
        } catch {
          /* malformed metadata — status change already applied */
        }
      }
    });
    applyTx(decisions);

    if (opts.syncContextLog) {
      const nowIso = new Date(now).toISOString();
      syncedContextLogs = decisions.filter((d) =>
        syncContextLogStatus(opts.repoRoot, d.id, d.newStatus, nowIso),
      ).length;
    }
  }

  const counts = { idle: 0, completed: 0, abandoned: 0 } as Record<string, number>;
  for (const d of decisions) counts[d.newStatus]++;

  const remainingActive = (
    db.prepare(`SELECT COUNT(*) AS c FROM sessions WHERE status='active'`).get() as { c: number }
  ).c;

  return {
    timestamp: new Date(now).toISOString(),
    applied: opts.apply,
    staleHours,
    protectHours,
    scannedActive: allActive,
    skippedProtected: protectedCount,
    wouldSweep: decisions,
    counts,
    remainingActive,
    syncedContextLogs,
  };
}

/* ── CLI ── */

async function main(): Promise<number> {
  const parsed = parseSweepArgs(process.argv);
  if (parsed.help) {
    console.log(`Usage: stale-session-sweeper [--apply] [--dry-run] [--stale-hours N] [--db path]

  --dry-run            report only (default)
  --apply              write terminal statuses
  --stale-hours N      candidate threshold, default ${DEFAULT_STALE_HOURS}
  --protect-hours N    never touch sessions newer than this, default ${DEFAULT_PROTECT_HOURS} (min 2)
  --idle-window-days N recent-activity window for 'idle', default ${DEFAULT_IDLE_WINDOW_DAYS}
`);
    return 0;
  }

  const opts: SweepOptions = {
    staleHours: parsed.staleHours ?? DEFAULT_STALE_HOURS,
    protectHours: parsed.protectHours ?? DEFAULT_PROTECT_HOURS,
    idleWindowDays: parsed.idleWindowDays ?? DEFAULT_IDLE_WINDOW_DAYS,
    apply: parsed.apply ?? false,
    syncContextLog: true,
    repoRoot: resolve(import.meta.dirname ?? '.', '..', '..'),
    dbPath: resolveSweepDbPath(parsed.dbPath),
  };

  const db = new Database(opts.dbPath, { readonly: false, fileMustExist: true });
  try {
    const summary = sweepStaleSessions(db, opts);
    const reportPath = resolve(
      opts.dbPath,
      '..',
      `stale-session-sweeper-report${opts.apply ? '' : '-dryrun'}.json`,
    );
    writeFileSync(reportPath, JSON.stringify(summary, null, 2), 'utf-8');

    const mode = opts.apply ? 'APPLY' : 'DRY-RUN';
    console.log(`[SWEEP] ${mode} — stale>${opts.staleHours}h, protect<${opts.protectHours}h`);
    console.log(
      `[SWEEP] active sessions: ${summary.scannedActive} (protected/recent: ${summary.skippedProtected})`,
    );
    console.log(
      `[SWEEP] ${opts.apply ? 'swept' : 'would sweep'} ${summary.wouldSweep.length}: ` +
        `${summary.counts.idle} -> idle, ${summary.counts.completed} -> completed, ` +
        `${summary.counts.abandoned} -> abandoned`,
    );
    console.log(`[SWEEP] remaining active: ${summary.remainingActive}`);
    if (opts.apply)
      console.log(`[SWEEP] context-log state files synced: ${summary.syncedContextLogs}`);
    console.log(`[SWEEP] report: ${reportPath}`);
    return 0;
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('[SWEEP] fatal:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
