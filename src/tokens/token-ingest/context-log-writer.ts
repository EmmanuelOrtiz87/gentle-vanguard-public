/**
 * token-ingest/context-log-writer.ts — El productor de `.state.json` de sesión.
 *
 * PROBLEMA QUE RESUELVE:
 *   El dashboard de observabilidad y el resumen de KB leen el estado de sesión
 *   desde `.session/context-log/<session-id>/.state.json`. Ese archivo lo
 *   escribía SOLO el hook PostToolUse de OpenCode/ZCode, con tokens ESTIMADOS
 *   a partir del largo de los argumentos de la tool. Por eso las sesiones reales
 *   de MiniMax Code (y de cualquier host sin hook cableado) tienen
 *   `turns=0, messageCount=0, totalTokens=0`: el productor no existía.
 *
 * SOLUCIÓN (nativa, sin hooks):
 *   La ingesta de tokens ya lee el uso REAL que cada host persiste en disco
 *   (minimax / opencode / zcode / codex / claude) y lo consolida en Nexus
 *   (`token_transactions`). Este módulo usa esa misma fuente de verdad para
 *   escribir el `.state.json` de cada sesión con turnos reales.
 *
 * REGLAS:
 *   - El dato real es la autoridad: si el estado ya fue escrito por la ingesta
 *     (`metadata.usageAuthority === 'ingest-real'`), el hook de estimaciones no
 *     lo pisa (ver `src/tokens/token-usage-auto.ts`).
 *   - Es idempotente: si el estado no cambió (mismos tokens, mismos mensajes,
 *     mismo `updatedAt`) no se reescribe el archivo.
 *   - No inventa datos: `totalCost` es el costo real reportado por el host; si
 *     el host no reporta costo, queda 0 (y no se estima).
 */

import Database from 'better-sqlite3';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { ROOT } from '../../core/repo-root.js';
import { NEXUS_DB as NEXUS_DB_CWD, log } from './nexus.js';
import type { SessionState, SessionTurn } from '../../core/session-context-log.js';

// Override de ruta (tests / sandboxes): el estado de sesión es persistente.
// Se resuelve en runtime (no en import) para que el override se pueda cambiar
// despues de cargar el modulo.
export function contextLogDir(): string {
  return process.env.GENTLE_CONTEXT_LOG_DIR
    ? resolve(process.env.GENTLE_CONTEXT_LOG_DIR)
    : join(ROOT, '.session', 'context-log');
}

/** Antigüedad máxima (ms) para considerar una sesión "active". */
const ACTIVE_WINDOW_MS = 15 * 60 * 1000;
/** Ventana de sesiones considerada (días). Acota el trabajo del daemon. */
const RECENT_WINDOW_DAYS = 7;
/** Máx. de sesiones escritas por pasada. */
const MAX_SESSIONS_PER_PASS = 60;
/** Máx. de turnos guardados por sesión (los totales siguen siendo exactos). */
const MAX_TURNS_PER_SESSION = 200;

export interface SessionAggregate {
  sessionId: string;
  transactions: number;
  tokensInput: number;
  tokensOutput: number;
  cacheRead: number;
  cost: number;
  firstAt: string;
  lastAt: string;
  model: string;
  agentName: string;
  /** Host de origen, deducido del prefijo del message_id. */
  provider: string;
}

export interface TurnRow {
  input: number;
  output: number;
  cacheRead: number;
  createdAt: string;
  model: string;
}

/** Convierte el timestamp local de SQLite (`YYYY-MM-DD HH:mm:ss`) a ISO. */
export function toIso(localSql: string): string {
  if (!localSql) return new Date().toISOString();
  const normalized = localSql.replace(' ', 'T');
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

/**
 * Construye el `SessionState` canónico a partir del agregado real de la sesión.
 * Función pura: no toca disco (testeable sin DB).
 */
export function buildSessionState(
  agg: SessionAggregate,
  turns: TurnRow[],
  source: string,
  nowMs: number = Date.now(),
): SessionState {
  const updatedAt = toIso(agg.lastAt);
  const createdAt = toIso(agg.firstAt);
  const sessionTurns: SessionTurn[] = turns.map((t) => ({
    inputTokens: t.input,
    outputTokens: t.output,
    timestamp: toIso(t.createdAt),
    message: t.model || agg.model || source,
  }));
  // El truncamiento puede venir de dos lados: el recorte del turno en memoria
  // o el limite de filas de la consulta (si hay mas transacciones que turnos).
  const truncated =
    sessionTurns.length > MAX_TURNS_PER_SESSION || agg.transactions > sessionTurns.length;
  const kept = truncated ? sessionTurns.slice(-MAX_TURNS_PER_SESSION) : sessionTurns;

  return {
    sessionId: agg.sessionId,
    agent: agg.agentName || agg.provider || source,
    status: nowMs - new Date(updatedAt).getTime() <= ACTIVE_WINDOW_MS ? 'active' : 'completed',
    createdAt,
    updatedAt,
    totalTokens: agg.tokensInput + agg.tokensOutput,
    totalCost: agg.cost,
    messageCount: agg.transactions,
    turns: kept,
    metadata: {
      usageAuthority: 'ingest-real',
      source: agg.provider || source,
      model: agg.model,
      cacheReadTokens: agg.cacheRead,
      transactions: agg.transactions,
      turnsTruncated: truncated,
    },
  };
}

/** Resuelve la DB de Nexus (la del cwd del daemon, con fallback al repo root). */
function resolveNexusDb(): string {
  if (existsSync(NEXUS_DB_CWD)) return NEXUS_DB_CWD;
  const fallback = join(ROOT, '.runtime', 'gentle-vanguard.db');
  return existsSync(fallback) ? fallback : NEXUS_DB_CWD;
}

/** Agregado real por sesión (cumulativo) desde `token_transactions`. */
export function readSessionAggregates(
  db: Database.Database,
  windowDays: number = RECENT_WINDOW_DAYS,
): SessionAggregate[] {
  // La ventana se calcula en SQL con 'localtime' porque `created_at` se
  // escribe con `datetime('now','localtime')`: comparar contra una fecha UTC
  // corrida desde Node desplazaría el corte.
  const rows = db
    .prepare(
      `SELECT session_id AS sessionId,
                COUNT(*) AS transactions,
                COALESCE(SUM(input_tokens), 0) AS tokensInput,
                COALESCE(SUM(output_tokens), 0) AS tokensOutput,
                COALESCE(SUM(cache_read_tokens), 0) AS cacheRead,
                COALESCE(SUM(cost), 0) AS cost,
                MIN(created_at) AS firstAt,
                MAX(created_at) AS lastAt,
                MAX(model) AS model,
                MAX(agent_name) AS agentName,
                COALESCE(MAX(CASE
                  WHEN message_id LIKE 'minimax:%' THEN 'minimax'
                  WHEN message_id LIKE 'zcode:%'   THEN 'zcode'
                  WHEN message_id LIKE 'codex:%'   THEN 'codex'
                  WHEN message_id LIKE 'claude:%'  THEN 'claude'
                  ELSE 'opencode'
                END), 'opencode') AS provider
         FROM token_transactions
         GROUP BY session_id
         HAVING MAX(created_at) >= datetime('now','localtime',?)
         ORDER BY MAX(created_at) DESC
         LIMIT ?`,
    )
    .all(`-${windowDays} days`, MAX_SESSIONS_PER_PASS) as Array<SessionAggregate>;
  return rows;
}

/** Turnos (transacciones) de una sesión, del más reciente al más antiguo. */
export function readSessionTurns(db: Database.Database, sessionId: string): TurnRow[] {
  const rows = db
    .prepare(
      `SELECT input_tokens AS input, output_tokens AS output,
                cache_read_tokens AS cacheRead, created_at AS createdAt, model
         FROM token_transactions
         WHERE session_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
    )
    .all(sessionId, MAX_TURNS_PER_SESSION) as Array<TurnRow>;
  return rows.reverse();
}

/** Un id de sesión seguro como nombre de carpeta en Windows. */
export function isSafeSessionId(sessionId: string): boolean {
  if (!sessionId || sessionId.length > 200) return false;
  if (sessionId === '.' || sessionId === '..') return false;
  return !/[\\/:*?"<>|]/.test(sessionId);
}

/** Escribe el `.state.json` de una sesión si su contenido cambió. */
export function writeSessionState(state: SessionState): boolean {
  if (!isSafeSessionId(state.sessionId)) {
    log(`context-log-writer: session id no usable como carpeta, se omite: ${state.sessionId}`);
    return false;
  }
  const dir = join(contextLogDir(), state.sessionId);
  const file = join(dir, '.state.json');
  try {
    if (existsSync(file)) {
      const prev = JSON.parse(readFileSync(file, 'utf-8')) as SessionState;
      if (
        prev.totalTokens === state.totalTokens &&
        prev.messageCount === state.messageCount &&
        prev.updatedAt === state.updatedAt &&
        prev.totalCost === state.totalCost &&
        prev.metadata?.source === state.metadata?.source &&
        prev.metadata?.turnsTruncated === state.metadata?.turnsTruncated
      ) {
        return false;
      }
      // Preservar `createdAt` más antiguo y metadata previa.
      state.createdAt =
        prev.createdAt && prev.createdAt < state.createdAt ? prev.createdAt : state.createdAt;
      state.metadata = { ...(prev.metadata ?? {}), ...(state.metadata ?? {}) };
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2), 'utf-8');
    return true;
  } catch (e) {
    log(
      `context-log-writer: error escribiendo ${state.sessionId}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
}

/**
 * Pasada completa: escribe el `.state.json` de las sesiones con uso real.
 * Idempotente y acotada (solo sesiones de la ventana reciente).
 */
export function writeContextLogStates(source = 'ingest'): {
  sessions: number;
  written: number;
  dbPath: string;
} {
  const dbPath = resolveNexusDb();
  if (!existsSync(dbPath)) return { sessions: 0, written: 0, dbPath };
  // Una sola conexion por pasada: el daemon corre cada 30s y abrir la DB por
  // sesion multiplicaba el trabajo sin necesidad.
  const db = new Database(dbPath, { readonly: true });
  let written = 0;
  let sessions = 0;
  try {
    const aggs = readSessionAggregates(db);
    sessions = aggs.length;
    for (const agg of aggs) {
      const turns = readSessionTurns(db, agg.sessionId);
      const state = buildSessionState(agg, turns, source);
      if (writeSessionState(state)) written++;
    }
  } finally {
    db.close();
  }
  if (written > 0) {
    log(
      `context-log: ${written} estado(s) de sesión actualizados con uso real (${sessions} sesiones)`,
    );
  }
  return { sessions, written, dbPath };
}

// ─── CLI ───────────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = writeContextLogStates('ingest');
  console.log(JSON.stringify(r, null, 2));
}
