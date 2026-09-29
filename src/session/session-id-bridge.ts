/**
 * session-id-bridge.ts — Bridge between the two session-id namespaces in Nexus
 * (STACK gap, 2026-08-31).
 *
 * Problem: `sessions` rows use stack ids (`session-20260831T1321`, synced from
 * .session/context-log by metrics-writer), while `token_transactions` /
 * `token_savings` / `traces` use tool-native ids ingeridos por token-ingest
 * (`ses_*` ZCode, `sess_subagent_agent_*`, codex UUIDs, `mvs_*` MiniMax).
 * Cero overlap → joins imposibles. Este módulo construye un mapa de alias
 * `session_id_aliases` con matching heurístico best-effort + confidence.
 *
 * Estrategias:
 *  (a) forward: token-ingest escribe el alias en vivo cuando puede identificar
 *      la sesión activa del repo (.session/session-current.json).
 *  (b) temporal: la PRIMERA transacción de un alias cae dentro de exactamente
 *      UNA ventana [created_at(session_i), created_at(session_i+1)) → alias.
 *      Las sesiones del repo se crean serialmente (una por autostart), así que
 *      la ventana inter-creación es el intervalo natural de actividad.
 *  (c) ambiguo (gap nulo, sin ventana única) → NO se adivina.
 *
 * NOTA de timestamps: sessions.created_at es ISO UTC; token_transactions.
 * created_at es datetime local (ver toSqliteDate en token-ingest/nexus.ts).
 * Parseamos ambos a epoch ms (Date.parse usa TZ local para el formato local).
 */

import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

export const ROOT = resolve(import.meta.dirname ?? process.cwd(), '..', '..');
export const NEXUS_DB = join(ROOT, '.runtime', 'gentle-vanguard.db');
export const CURRENT_SESSION_FILE = join(ROOT, '.session', 'session-current.json');

export const ALIAS_DDL = `
CREATE TABLE IF NOT EXISTS session_id_aliases (
  session_id TEXT NOT NULL,
  alias_id TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, alias_id)
);
CREATE INDEX IF NOT EXISTS idx_aliases_session ON session_id_aliases (session_id);
CREATE INDEX IF NOT EXISTS idx_aliases_alias ON session_id_aliases (alias_id);
`;

export function ensureAliasTable(db: Database.Database): void {
  db.exec(ALIAS_DDL);
}

export function aliasTableExists(db: Database.Database): boolean {
  return Boolean(
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='session_id_aliases'`)
      .get(),
  );
}

export interface AliasRow {
  session_id: string;
  alias_id: string;
  source: string;
  confidence: number;
  created_at: string;
}

export interface BackfillOptions {
  /** apply (true) or dry-run (false, default) */
  apply?: boolean;
  /** tolerance in ms around session created_at for window edges (default 2 min) */
  toleranceMs?: number;
  /** windows shorter than this (ms) are treated as ambiguous (default 60s) */
  minWindowMs?: number;
  /** also consider traces.session_id as alias ids (default true) */
  includeTraces?: boolean;
}

export interface BackfillCandidate {
  aliasId: string;
  sessionId: string;
  source: string;
  confidence: number;
  firstTxMs: number;
  windowMs: number;
}

export interface BackfillResult {
  candidates: BackfillCandidate[];
  applied: number;
  skippedAmbiguous: number;
  skippedNoWindow: number;
  totalAliasIds: number;
  alreadyAliased: number;
}

/** Parsea un created_at de token_transactions ('YYYY-MM-DD HH:MM:SS', local) a epoch ms. */
function parseLocalSqlite(s: string): number {
  const t = Date.parse(s.replace(' ', 'T'));
  return Number.isFinite(t) ? t : Date.parse(s);
}

/** Lee los alias ids candidatos: id distinto de tx/savings/traces con su rango temporal. */
export function collectAliasIds(
  db: Database.Database,
  includeTraces = true,
): Map<string, { first: number; last: number }> {
  const out = new Map<string, { first: number; last: number }>();
  const addRange = (id: string, first: number, last: number): void => {
    if (!id || id === 'stack-compression') return;
    const cur = out.get(id);
    if (!cur) out.set(id, { first, last });
    else {
      cur.first = Math.min(cur.first, first);
      cur.last = Math.max(cur.last, last);
    }
  };
  for (const r of db
    .prepare(
      `SELECT session_id, MIN(created_at) mn, MAX(created_at) mx FROM token_transactions GROUP BY session_id`,
    )
    .all() as Array<{ session_id: string; mn: string; mx: string }>) {
    const f = parseLocalSqlite(r.mn);
    const l = parseLocalSqlite(r.mx);
    if (Number.isFinite(f) && Number.isFinite(l)) addRange(r.session_id, f, l);
  }
  if (includeTraces) {
    try {
      for (const r of db
        .prepare(
          `SELECT session_id, MIN(start_time) mn, MAX(start_time) mx FROM traces WHERE session_id IS NOT NULL AND session_id != '' GROUP BY session_id`,
        )
        .all() as Array<{ session_id: string; mn: string | number; mx: string | number }>) {
        const f = typeof r.mn === 'number' ? r.mn : Date.parse(r.mn);
        const l = typeof r.mx === 'number' ? r.mx : Date.parse(r.mx);
        if (Number.isFinite(f) && Number.isFinite(l)) addRange(r.session_id, f, l);
      }
    } catch {
      /* traces table may not exist / different schema */
    }
  }
  return out;
}

/**
 * Backfill heurístico: ventana inter-creación. Devuelve candidatos (dry-run)
 * o los aplica. Nunca adivina en ambigüedad.
 */
export function backfillAliases(db: Database.Database, opts: BackfillOptions = {}): BackfillResult {
  const toleranceMs = opts.toleranceMs ?? 2 * 60_000;
  const minWindowMs = opts.minWindowMs ?? 60_000;

  const sessions = (
    db.prepare(`SELECT id, created_at FROM sessions ORDER BY created_at ASC`).all() as Array<{
      id: string;
      created_at: string | null;
    }>
  )
    .map((s) => ({ id: s.id, at: s.created_at ? Date.parse(s.created_at) : NaN }))
    .filter((s) => Number.isFinite(s.at));

  const sessionIds = new Set(sessions.map((s) => s.id));
  const already = new Set(
    aliasTableExists(db)
      ? (
          db.prepare(`SELECT session_id, alias_id FROM session_id_aliases`).all() as Array<{
            session_id: string;
            alias_id: string;
          }>
        ).map((r) => `${r.session_id}=>${r.alias_id}`)
      : [],
  );

  // Sesiones ordenadas por creación (serial: una por autostart). Para cada
  // alias, la sesión candidata es la última creada <= firstTx (+tolerancia).
  // Ambigüedad: sesiones consecutivas creadas a < minWindowMs → no se adivina.
  const aliasIds = collectAliasIds(db, opts.includeTraces ?? true);
  const now = Date.now();
  const candidates: BackfillCandidate[] = [];
  let skippedAmbiguous = 0;
  let skippedNoWindow = 0;
  let alreadyAliased = 0;

  for (const [aliasId, range] of aliasIds) {
    if (sessionIds.has(aliasId)) continue; // mismo namespace, no es alias
    const t = range.first;
    // índice de la última sesión con created <= t + tol
    let idx = -1;
    for (let i = 0; i < sessions.length; i++) {
      if (sessions[i].at <= t + toleranceMs) idx = i;
      else break;
    }
    if (idx < 0) {
      skippedNoWindow++;
      continue;
    }
    const cand = sessions[idx];
    const prev = idx > 0 ? sessions[idx - 1] : null;
    const next = idx + 1 < sessions.length ? sessions[idx + 1] : null;
    // gap corto con la sesión previa y el tx cayó antes de la creación de la
    // candidata → no se puede distinguir a cuál pertenece
    if (t < cand.at && prev && cand.at - prev.at < minWindowMs) {
      skippedAmbiguous++;
      continue;
    }
    // gap corto con la siguiente sesión → ventana indestructible, ambiguo
    if (next && next.at - cand.at < minWindowMs) {
      skippedAmbiguous++;
      continue;
    }
    if (already.has(`${cand.id}=>${aliasId}`)) {
      alreadyAliased++;
      continue;
    }
    const windowEnd = next ? next.at : Math.max(now, range.last);
    const windowMs = windowEnd - cand.at;
    if (windowMs < minWindowMs) {
      skippedAmbiguous++;
      continue;
    }
    // confianza: ventana amplia y actividad contenida en la ventana
    const contained = range.last < windowEnd;
    const confidence = Number((contained ? (windowMs > 30 * 60_000 ? 0.9 : 0.75) : 0.6).toFixed(2));
    candidates.push({
      aliasId,
      sessionId: cand.id,
      source: 'temporal-window',
      confidence,
      firstTxMs: range.first,
      windowMs,
    });
  }

  let applied = 0;
  if (opts.apply) {
    ensureAliasTable(db);
  }
  if (opts.apply && candidates.length > 0) {
    const ins = db.prepare(
      `INSERT OR IGNORE INTO session_id_aliases (session_id, alias_id, source, confidence, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const tx = db.transaction(() => {
      for (const c of candidates) {
        applied += ins.run(
          c.sessionId,
          c.aliasId,
          c.source,
          c.confidence,
          new Date().toISOString(),
        ).changes;
      }
    });
    tx();
  }

  return {
    candidates,
    applied,
    skippedAmbiguous,
    skippedNoWindow,
    totalAliasIds: aliasIds.size,
    alreadyAliased,
  };
}

/* ── Backfill de traces.session_id (ventana inter-creación) ── */

export interface TraceBackfillOptions {
  /** apply (true) or dry-run (false, default) */
  apply?: boolean;
  /** tolerance in ms around session created_at for window edges (default 2 min) */
  toleranceMs?: number;
  /** windows shorter than this (ms) are treated as ambiguous (default 60s) */
  minWindowMs?: number;
}

export interface TraceBackfillResult {
  totalNullTraces: number;
  matched: Array<{ spanId: string; sessionId: string; startTimeMs: number; windowMs: number }>;
  applied: number;
  skippedAmbiguous: number;
  skippedNoWindow: number;
}

/**
 * Backfill de traces.session_id NULL usando la misma heurística de ventana
 * inter-creación que backfillAliases: cada trace (por start_time, epoch ms)
 * pertenece a la última sesión creada <= start_time (+tolerancia). Nunca se
 * adivina en ambigüedad (ventanas indestructibles / gaps < minWindowMs).
 */
export function backfillTraces(
  db: Database.Database,
  opts: TraceBackfillOptions = {},
): TraceBackfillResult {
  const toleranceMs = opts.toleranceMs ?? 2 * 60_000;
  const minWindowMs = opts.minWindowMs ?? 60_000;
  const now = Date.now();

  const sessions = (
    db.prepare(`SELECT id, created_at FROM sessions ORDER BY created_at ASC`).all() as Array<{
      id: string;
      created_at: string | null;
    }>
  )
    .map((s) => ({ id: s.id, at: s.created_at ? Date.parse(s.created_at) : NaN }))
    .filter((s) => Number.isFinite(s.at));

  const traces = db
    .prepare(`SELECT span_id, start_time FROM traces WHERE session_id IS NULL OR session_id = ''`)
    .all() as Array<{ span_id: string; start_time: number | string }>;

  const result: TraceBackfillResult = {
    totalNullTraces: traces.length,
    matched: [],
    applied: 0,
    skippedAmbiguous: 0,
    skippedNoWindow: 0,
  };

  const update = opts.apply
    ? db.prepare(
        `UPDATE traces SET session_id = ? WHERE span_id = ? AND (session_id IS NULL OR session_id = '')`,
      )
    : null;

  const applyTx = db.transaction(() => {
    for (const m of result.matched) {
      if (update) result.applied += update.run(m.sessionId, m.spanId).changes;
    }
  });

  for (const t of traces) {
    const ts = typeof t.start_time === 'number' ? t.start_time : Date.parse(t.start_time);
    if (!Number.isFinite(ts)) {
      result.skippedAmbiguous++;
      continue;
    }
    let idx = -1;
    for (let i = 0; i < sessions.length; i++) {
      if (sessions[i].at <= ts + toleranceMs) idx = i;
      else break;
    }
    if (idx < 0) {
      result.skippedNoWindow++;
      continue;
    }
    const cand = sessions[idx];
    const prev = idx > 0 ? sessions[idx - 1] : null;
    const next = idx + 1 < sessions.length ? sessions[idx + 1] : null;
    if (ts < cand.at && prev && cand.at - prev.at < minWindowMs) {
      result.skippedAmbiguous++;
      continue;
    }
    if (next && next.at - cand.at < minWindowMs) {
      result.skippedAmbiguous++;
      continue;
    }
    const windowEnd = next ? next.at : Math.max(now, ts);
    const windowMs = windowEnd - cand.at;
    if (windowMs < minWindowMs) {
      result.skippedAmbiguous++;
      continue;
    }
    result.matched.push({ spanId: t.span_id, sessionId: cand.id, startTimeMs: ts, windowMs });
  }

  if (opts.apply && result.matched.length > 0) applyTx();
  return result;
}

/** Lee la sesión activa del repo desde .session/session-current.json (marker del autostart). */
export function currentRepoSessionId(repoRoot: string = ROOT): string | null {
  try {
    const p = join(repoRoot, '.session', 'session-current.json');
    if (!existsSync(p)) return null;
    const s = JSON.parse(readFileSync(p, 'utf-8')) as { sessionId?: string; id?: string };
    return s.sessionId ?? s.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Forward-write (llamado por token-ingest tras ingerir): si hay sesión activa
 * del repo, crea alias para los alias-ids con actividad reciente (ventana de
 * `recencyMs`) que aún no tienen alias. Subagentes (`sess_subagent_*`) también
 * se asocian: corren dentro de la sesión orquestadora.
 */
export function recordForwardAliases(
  db: Database.Database,
  aliasIdsWithActivity: Array<{ aliasId: string; lastActivityMs: number; source: string }>,
  opts: { repoSessionId?: string | null; recencyMs?: number; apply?: boolean } = {},
): number {
  const repoSessionId =
    opts.repoSessionId === undefined ? currentRepoSessionId() : opts.repoSessionId;
  if (!repoSessionId) return 0;
  const recencyMs = opts.recencyMs ?? 15 * 60_000;
  const now = Date.now();
  ensureAliasTable(db);
  const existing = new Set(
    (
      db
        .prepare(`SELECT alias_id FROM session_id_aliases WHERE session_id = ?`)
        .all(repoSessionId) as Array<{ alias_id: string }>
    ).map((r) => r.alias_id),
  );
  const ins = db.prepare(
    `INSERT OR IGNORE INTO session_id_aliases (session_id, alias_id, source, confidence, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  let inserted = 0;
  const tx = db.transaction(() => {
    for (const a of aliasIdsWithActivity) {
      if (existing.has(a.aliasId) || a.aliasId === repoSessionId) continue;
      if (now - a.lastActivityMs > recencyMs) continue;
      inserted += ins.run(
        repoSessionId,
        a.aliasId,
        `forward:${a.source}`,
        a.aliasId.startsWith('sess_subagent') ? 0.8 : 0.9,
        new Date().toISOString(),
      ).changes;
    }
  });
  tx();
  return inserted;
}

/** Estadísticas del mapa de alias. */
export interface AliasStats {
  totalAliases: number;
  distinctSessions: number;
  distinctAliasIds: number;
  bySource: Array<{ source: string; n: number; avgConfidence: number }>;
  attributedTokens: number; // tokens en txns cuyo session_id tiene alias
  totalTxnTokens: number;
}

export function aliasStats(db: Database.Database): AliasStats | null {
  if (!aliasTableExists(db)) return null;
  const total = db.prepare(`SELECT COUNT(*) c FROM session_id_aliases`).get() as { c: number };
  const distinctSessions = db
    .prepare(`SELECT COUNT(DISTINCT session_id) c FROM session_id_aliases`)
    .get() as { c: number };
  const distinctAliasIds = db
    .prepare(`SELECT COUNT(DISTINCT alias_id) c FROM session_id_aliases`)
    .get() as { c: number };
  const bySource = db
    .prepare(
      `SELECT source, COUNT(*) n, AVG(confidence) avgConfidence FROM session_id_aliases GROUP BY source ORDER BY n DESC`,
    )
    .all() as Array<{ source: string; n: number; avgConfidence: number }>;
  let attributedTokens = 0;
  let totalTxnTokens = 0;
  try {
    attributedTokens = (
      db
        .prepare(
          `SELECT COALESCE(SUM(t.input_tokens + t.output_tokens), 0) s
           FROM token_transactions t
           WHERE EXISTS (SELECT 1 FROM session_id_aliases a WHERE a.alias_id = t.session_id)`,
        )
        .get() as { s: number }
    ).s;
    totalTxnTokens = (
      db
        .prepare(`SELECT COALESCE(SUM(input_tokens + output_tokens), 0) s FROM token_transactions`)
        .get() as { s: number }
    ).s;
  } catch {
    /* token_transactions missing */
  }
  return {
    totalAliases: total.c,
    distinctSessions: distinctSessions.c,
    distinctAliasIds: distinctAliasIds.c,
    bySource: bySource.map((r) => ({
      source: r.source,
      n: r.n,
      avgConfidence: Number((r.avgConfidence ?? 0).toFixed(2)),
    })),
    attributedTokens: attributedTokens,
    totalTxnTokens: totalTxnTokens,
  };
}

/**
 * SQL helper para joins enriquecidos: devuelve los ids alias conocidos para
 * una sesión (o solo la sesión si la tabla no existe / no hay alias).
 */
export function sessionPlusAliasIds(db: Database.Database, sessionId: string): string[] {
  if (!aliasTableExists(db)) return [sessionId];
  const rows = db
    .prepare(`SELECT alias_id FROM session_id_aliases WHERE session_id = ?`)
    .all(sessionId) as Array<{ alias_id: string }>;
  return [sessionId, ...rows.map((r) => r.alias_id)];
}
