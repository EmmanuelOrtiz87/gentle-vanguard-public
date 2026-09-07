/**
 * GET /api/history/sessions — Histórico de sesiones con filtros (ADR-0031 follow-up).
 * GET /api/history/sessions/:id — drill-down por sesión (usage + transactions + traces + savings).
 *
 * Fuentes en Nexus: token_usage (sesiones reales de zcode/minimax/opencode/codex vía
 * token-ingest) y traces (sesiones del stack, sess-<ts>-<rand>). La lista es un UNION de
 * ambos — así el Histórico cubre TODAS las sesiones, no solo las con consumo de tokens.
 * Histórico COMPLETO (sin la ventana de 7d del cost report), filtrable por rango, fuente,
 * modelo y búsqueda.
 *
 * La "fuente" es una heurística por prefijo del session_id según los formatos que escribe
 * token-ingest — se disclosed en la UI.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import type Database from 'better-sqlite3';
import { DatabaseManager } from '../database/manager.ts';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const MAX_DETAIL_TXNS = 300;
const MAX_DETAIL_TRACES = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface HistoryFilters {
  from: string | null;
  to: string | null;
  source: string | null;
  model: string | null;
  q: string | null;
  limit: number;
  offset: number;
  sort: 'recent' | 'tokens' | 'requests';
}

function parseFilters(url: URL): HistoryFilters {
  const get = (k: string) => {
    const v = url.searchParams.get(k)?.trim();
    return v && v.length > 0 && v !== 'all' ? v : null;
  };
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10);
  const sortRaw = url.searchParams.get('sort') ?? 'recent';
  return {
    from: get('from'),
    to: get('to'),
    source: get('source'),
    model: get('model'),
    q: get('q'),
    limit: Math.min(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : DEFAULT_LIMIT, MAX_LIMIT),
    offset: Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0),
    sort: sortRaw === 'tokens' || sortRaw === 'requests' ? sortRaw : 'recent',
  };
}

/**
 * Sets de desambiguación: los prefijos de session_id no alcanzan para separar
 * minimax de opencode (ambos usan ses_*) ni de codex (ids UUID). token-ingest
 * escribe la pista en token_transactions: agent orchestrator/subagent o message_id
 * minimax:* ⇒ minimax; message_id codex:* ⇒ codex.
 */
export interface SourceSets {
  minimax: Set<string>;
  codex: Set<string>;
}

export function resolveSourceSets(db: Database.Database): SourceSets {
  const minimax = new Set<string>();
  const codex = new Set<string>();
  const rows = db
    .prepare(
      `SELECT session_id,
              CASE WHEN message_id LIKE 'minimax:%' THEN 1 ELSE 0 END AS is_mm,
              CASE WHEN message_id LIKE 'codex:%' THEN 1 ELSE 0 END AS is_cx,
              agent
       FROM token_transactions
       WHERE agent IN ('orchestrator', 'subagent')
          OR message_id LIKE 'minimax:%'
          OR message_id LIKE 'codex:%'`,
    )
    .all() as { session_id: string; is_mm: number; is_cx: number; agent: string | null }[];
  for (const r of rows) {
    if (!r.session_id) continue;
    if (r.is_mm || r.agent === 'orchestrator' || r.agent === 'subagent') minimax.add(r.session_id);
    if (r.is_cx) codex.add(r.session_id);
  }
  return { minimax, codex };
}

export function deriveSource(sessionId: string | null, sets?: SourceSets): string {
  if (!sessionId) return 'otro';
  if (sessionId.startsWith('sess_')) return 'zcode';
  if (sessionId.startsWith('ses_')) {
    if (!sets) return 'minimax';
    return sets.minimax.has(sessionId) ? 'minimax' : 'opencode';
  }
  if (sessionId.startsWith('sess-')) return 'stack';
  if (sessionId.startsWith('session-')) return 'stack';
  if (UUID_RE.test(sessionId)) return 'codex';
  if (sets) {
    if (sets.minimax.has(sessionId)) return 'minimax';
    if (sets.codex.has(sessionId)) return 'codex';
  }
  return 'otro';
}

/** Filtro SQL por fuente (espeja deriveSource; los sets llegan como subqueries). */
/**
 * UNION de las dos fuentes de sesiones, ya agregadas por session_id dentro de cada
 * rama (cada una filtra por su propia columna de tiempo/modelo). El caller agrupa
 * afuera por session_id.
 */
function unionBranches(filters: Pick<HistoryFilters, 'from' | 'to' | 'model' | 'q'>): {
  sql: string;
  params: unknown[];
} {
  const usageWhere: string[] = [];
  const usageParams: unknown[] = [];
  if (filters.from) {
    usageWhere.push('timestamp >= ?');
    usageParams.push(filters.from);
  }
  if (filters.to) {
    usageWhere.push('timestamp <= ?');
    usageParams.push(`${filters.to} 23:59:59`);
  }
  if (filters.model) {
    usageWhere.push('model = ?');
    usageParams.push(filters.model);
  }
  if (filters.q) {
    usageWhere.push('session_id LIKE ?');
    usageParams.push(`%${filters.q}%`);
  }
  const usageBranch = `
    SELECT session_id,
           count(*) AS requests,
           sum(prompt_tokens) AS prompt_tokens,
           sum(completion_tokens) AS completion_tokens,
           sum(total_tokens) AS total_tokens,
           sum(cost) AS cost,
           min(timestamp) AS first_at,
           max(timestamp) AS last_at,
           group_concat(DISTINCT model) AS models
    FROM token_usage
    ${usageWhere.length ? `WHERE ${usageWhere.join(' AND ')}` : ''}
    GROUP BY session_id`;

  const tracesWhere: string[] = ['session_id IS NOT NULL'];
  const tracesParams: unknown[] = [];
  if (filters.from) {
    tracesWhere.push('start_time >= ?');
    tracesParams.push(new Date(`${filters.from}T00:00:00Z`).getTime());
  }
  if (filters.to) {
    tracesWhere.push('start_time <= ?');
    tracesParams.push(new Date(`${filters.to}T23:59:59Z`).getTime());
  }
  if (filters.model) {
    tracesWhere.push('model = ?');
    tracesParams.push(filters.model);
  }
  if (filters.q) {
    tracesWhere.push('session_id LIKE ?');
    tracesParams.push(`%${filters.q}%`);
  }
  const tracesBranch = `
    SELECT session_id,
           count(*) AS requests,
           0 AS prompt_tokens,
           0 AS completion_tokens,
           sum(input_tokens + output_tokens) AS total_tokens,
           sum(cost) AS cost,
           datetime(min(start_time) / 1000, 'unixepoch') AS first_at,
           datetime(max(start_time) / 1000, 'unixepoch') AS last_at,
           group_concat(DISTINCT model) AS models
    FROM traces
    WHERE ${tracesWhere.join(' AND ')}
    GROUP BY session_id`;

  return {
    sql: `${usageBranch} UNION ALL ${tracesBranch}`,
    params: [...usageParams, ...tracesParams],
  };
}

/** Sesiones consolidadas (una fila por session_id) sobre el UNION de ramas. */
const CONSOLIDATED_CTE = `
  WITH merged AS (
    SELECT session_id,
           sum(requests) AS requests,
           sum(prompt_tokens) AS prompt_tokens,
           sum(completion_tokens) AS completion_tokens,
           sum(total_tokens) AS total_tokens,
           sum(cost) AS cost,
           min(first_at) AS first_at,
           max(last_at) AS last_at,
           group_concat(models) AS models
    FROM ({{BRANCHES}})
    GROUP BY session_id
  )`;

interface SessionRow {
  session_id: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost: number;
  first_at: string | null;
  last_at: string | null;
  models: string | null;
}

function serializeSession(row: SessionRow, traceSessions: Set<string>, sets: SourceSets) {
  return {
    sessionId: row.session_id,
    source: deriveSource(row.session_id, sets),
    requests: row.requests,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    cost: row.cost,
    firstAt: row.first_at,
    lastAt: row.last_at,
    models: [...new Set((row.models ?? '').split(',').filter(Boolean))],
    hasTraces: traceSessions.has(row.session_id),
  };
}

function openDb(): Database.Database {
  return DatabaseManager.getInstance().getDb();
}

export function listSessions(db: Database.Database, filters: HistoryFilters) {
  const branches = unionBranches(filters);
  const cte = CONSOLIDATED_CTE.replace('{{BRANCHES}}', branches.sql);
  const traceSessions = new Set(
    (
      db
        .prepare('SELECT DISTINCT session_id FROM traces WHERE session_id IS NOT NULL')
        .all() as { session_id: string }[]
    ).map((r) => r.session_id),
  );
  const sets = resolveSourceSets(db);

  // El set consolidado de sesiones es chico (cientos): traer todo y
  // filtrar/ordenar/paginar en JS evita duplicar la heurística de fuente en SQL.
  const mergedRows = db
    .prepare(`${cte} SELECT * FROM merged`)
    .all(...branches.params) as SessionRow[];
  const allSessions = mergedRows.map((r) => serializeSession(r, traceSessions, sets));
  const sessions =
    filters.source && filters.source !== 'all'
      ? allSessions.filter((s) => s.source === filters.source)
      : allSessions;

  const sorters: Record<HistoryFilters['sort'], (a: (typeof sessions)[0], b: (typeof sessions)[0]) => number> = {
    recent: (a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''),
    tokens: (a, b) => b.totalTokens - a.totalTokens,
    requests: (a, b) => b.requests - a.requests,
  };
  sessions.sort(sorters[filters.sort]);

  const totals = {
    sessions: sessions.length,
    requests: sessions.reduce((acc, s) => acc + s.requests, 0),
    totalTokens: sessions.reduce((acc, s) => acc + s.totalTokens, 0),
    promptTokens: sessions.reduce((acc, s) => acc + s.promptTokens, 0),
    completionTokens: sessions.reduce((acc, s) => acc + s.completionTokens, 0),
    cachedTokensSaved: (() => {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (filters.from) {
        clauses.push('created_at >= ?');
        params.push(filters.from);
      }
      if (filters.to) {
        clauses.push('created_at <= ?');
        params.push(`${filters.to} 23:59:59`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const row = db
        .prepare(`SELECT sum(saved_tokens) AS saved FROM token_savings ${where}`)
        .get(...params) as { saved: number | null };
      return row.saved ?? 0;
    })(),
  };

  const bySourceMap = new Map<string, { sessions: number; tokens: number }>();
  for (const s of allSessions) {
    const cur = bySourceMap.get(s.source) ?? { sessions: 0, tokens: 0 };
    cur.sessions += 1;
    cur.tokens += s.totalTokens;
    bySourceMap.set(s.source, cur);
  }
  const bySource = [...bySourceMap.entries()]
    .map(([source, v]) => ({ source, ...v }))
    .sort((a, b) => b.tokens - a.tokens);

  return {
    sessions: sessions.slice(filters.offset, filters.offset + filters.limit),
    totals,
    bySource,
  };
}

export function sessionDetail(db: Database.Database, sessionId: string) {
  const sets = resolveSourceSets(db);
  // Agregado combinado: token_usage + token_transactions + traces (una sesión puede
  // existir solo en traces — las sesiones del stack — y debe ser explorable igual).
  const usageAgg = db
    .prepare(
      `SELECT count(*) AS requests,
              sum(prompt_tokens) AS prompt_tokens,
              sum(completion_tokens) AS completion_tokens,
              sum(total_tokens) AS total_tokens,
              sum(cost) AS cost,
              min(timestamp) AS first_at,
              max(timestamp) AS last_at,
              group_concat(DISTINCT model) AS models
       FROM token_usage WHERE session_id = ?`,
    )
    .get(sessionId) as SessionRow | undefined;

  const txAgg = db
    .prepare(
      `SELECT count(*) AS n,
              sum(input_tokens + output_tokens) AS tok,
              min(created_at) AS first_at,
              max(created_at) AS last_at,
              group_concat(DISTINCT model) AS models
       FROM token_transactions WHERE session_id = ?`,
    )
    .get(sessionId) as {
    n: number;
    tok: number | null;
    first_at: string | null;
    last_at: string | null;
    models: string | null;
  };

  const trAgg = db
    .prepare(
      `SELECT count(*) AS n,
              sum(input_tokens + output_tokens) AS tok,
              datetime(min(start_time) / 1000, 'unixepoch') AS first_at,
              datetime(max(start_time) / 1000, 'unixepoch') AS last_at,
              group_concat(DISTINCT model) AS models
       FROM traces WHERE session_id = ?`,
    )
    .get(sessionId) as {
    n: number;
    tok: number | null;
    first_at: string | null;
    last_at: string | null;
    models: string | null;
  };

  const requests = (usageAgg?.requests ?? 0) + (txAgg?.n ?? 0) + (trAgg?.n ?? 0);
  if (!requests) return null;

  const hasUsage = (usageAgg?.requests ?? 0) > 0;
  const session: SessionRow = {
    session_id: sessionId,
    requests: hasUsage ? (usageAgg?.requests ?? 0) : (txAgg?.n ?? 0) || (trAgg?.n ?? 0),
    prompt_tokens: usageAgg?.prompt_tokens ?? 0,
    completion_tokens: usageAgg?.completion_tokens ?? 0,
    total_tokens: hasUsage ? (usageAgg?.total_tokens ?? 0) : Math.max(txAgg?.tok ?? 0, trAgg?.tok ?? 0),
    cost: usageAgg?.cost ?? 0,
    first_at: usageAgg?.first_at ?? txAgg?.first_at ?? trAgg?.first_at,
    last_at: usageAgg?.last_at ?? txAgg?.last_at ?? trAgg?.last_at,
    models: [
      ...new Set(
        [
          ...(usageAgg?.models ?? '').split(','),
          ...(txAgg?.models ?? '').split(','),
          ...(trAgg?.models ?? '').split(','),
        ].filter(Boolean),
      ),
    ].join(','),
  };

  const transactions = db
    .prepare(
      `SELECT message_id, agent, model, input_tokens, output_tokens,
              reasoning_tokens, cache_read_tokens, cache_write_tokens, cost, created_at
       FROM token_transactions WHERE session_id = ?
       ORDER BY created_at DESC LIMIT ${MAX_DETAIL_TXNS}`,
    )
    .all(sessionId);

  const traces = db
    .prepare(
      `SELECT trace_id, span_id, name, start_time, duration, status, model,
              input_tokens, output_tokens
       FROM traces WHERE session_id = ?
       ORDER BY start_time DESC LIMIT ${MAX_DETAIL_TRACES}`,
    )
    .all(sessionId);

  const savings = db
    .prepare(
      `SELECT category, sum(saved_tokens) AS saved, count(*) AS hits
       FROM token_savings WHERE session_id = ? GROUP BY category ORDER BY saved DESC`,
    )
    .all(sessionId);

  const usage = db
    .prepare(
      `SELECT prompt_tokens, completion_tokens, total_tokens, model, timestamp
       FROM token_usage WHERE session_id = ? ORDER BY timestamp DESC LIMIT 100`,
    )
    .all(sessionId);

  return {
    session: serializeSession(session, new Set([sessionId]), sets),
    transactions,
    transactionsTotal: txAgg?.n ?? 0,
    traces,
    savings,
    usage,
  };
}

export async function historyHandler(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: unknown,
  headers: Record<string, string>,
): Promise<boolean> {
  if (req.method !== 'GET' || !url.pathname.startsWith('/api/history/')) return false;

  let payload: unknown;
  try {
    const db = openDb();
    const detailMatch = /^\/api\/history\/sessions\/(.+)$/.exec(url.pathname);
    if (detailMatch) {
      const sessionId = decodeURIComponent(detailMatch[1]);
      const detail = sessionDetail(db, sessionId);
      if (!detail) {
        res.writeHead(404, headers);
        res.end(JSON.stringify({ error: 'session-not-found', sessionId }));
        return true;
      }
      payload = { type: 'history-session', data: detail };
    } else if (url.pathname === '/api/history/sessions') {
      payload = { type: 'history-sessions', data: listSessions(db, parseFilters(url)) };
    } else {
      return false;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.writeHead(503, headers);
    res.end(JSON.stringify({ error: 'nexus-unavailable', detail: msg }));
    return true;
  }

  res.writeHead(200, headers);
  res.end(JSON.stringify(payload));
  return true;
}
