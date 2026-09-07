/**
 * Correlation Query — unified timeline over the correlation key chain.
 *
 * `queryCorrelation({ sessionId | traceId | timeRange })` reads the JSONL
 * correlation files (`.telemetry/correlation/`) and, optionally, the Nexus
 * `token_transactions` table (`.runtime/gentle-vanguard.db`, read-only) to
 * return traces + metrics + logs + token usage for one session as a single
 * ordered view: session_id ↔ trace_id ↔ token_transactions.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CorrelationEvent } from './correlation';
import { correlationDir } from './correlation';

/** A token_transaction row from Nexus (mapped into the timeline). */
export interface TokenTransactionEntry {
  id: number;
  messageId: string;
  agent?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  cost?: number | null;
  createdAt?: string | null;
}

export interface TimelineEntry {
  ts: string;
  kind: 'trace' | 'metric' | 'log' | 'token';
  name: string;
  sessionId?: string;
  traceId?: string;
  agent?: string;
  spanId?: string;
  payload?: Record<string, unknown>;
}

export interface QueryCorrelationOptions {
  sessionId?: string;
  traceId?: string;
  /** Inclusive lower bound (ISO string or epoch ms). */
  from?: string | number;
  /** Exclusive upper bound (ISO string or epoch ms). */
  to?: string | number;
  /** Include Nexus token_transactions for the session (default: true when sessionId given). */
  includeTokens?: boolean;
  /** Repo root (defaults to cwd). */
  root?: string;
  /** Nexus DB path override (tests). */
  dbPath?: string;
}

export interface QueryCorrelationResult {
  entries: TimelineEntry[];
  total: number;
  sources: { jsonlEvents: number; tokenTransactions: number };
}

function toMs(value: string | number): number {
  return typeof value === 'number' ? value : Date.parse(value);
}

/** Read and parse every correlation-*.jsonl file under the correlation dir. */
export function readCorrelationFiles(root = process.cwd()): CorrelationEvent[] {
  const dir = correlationDir(root);
  if (!existsSync(dir)) return [];
  const events: CorrelationEvent[] = [];
  for (const file of readdirSync(dir)
    .filter((f) => /^correlation-\d{8}\.jsonl$/.test(f))
    .sort()) {
    const content = readFileSync(join(dir, file), 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as CorrelationEvent);
      } catch {
        /* skip malformed line — telemetry files are append-only, partial tail lines possible */
      }
    }
  }
  return events;
}

/**
 * Read token transactions for a session from the Nexus SQLite DB (read-only,
 * best-effort: missing DB / table / driver issues return []).
 */
export async function readTokenTransactions(
  sessionId: string,
  dbPath?: string,
): Promise<TokenTransactionEntry[]> {
  const path = dbPath ?? join(process.cwd(), '.runtime', 'gentle-vanguard.db');
  if (!existsSync(path)) return [];
  try {
    // Dynamic import so environments without the native module still work.
    const { default: Database } = (await import('better-sqlite3')) as {
      default: new (
        p: string,
        o?: unknown,
      ) => {
        prepare: (sql: string) => { all: (...a: unknown[]) => unknown[] };
        close: () => void;
      };
    };
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try {
      const rows = db
        .prepare(
          `SELECT id, message_id, agent, model, input_tokens, output_tokens,
                  reasoning_tokens, cost, created_at
           FROM token_transactions WHERE session_id = ? ORDER BY created_at ASC, id ASC`,
        )
        .all(sessionId) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        id: Number(r.id),
        messageId: String(r.message_id),
        agent: (r.agent as string) ?? null,
        model: (r.model as string) ?? null,
        inputTokens: (r.input_tokens as number) ?? null,
        outputTokens: (r.output_tokens as number) ?? null,
        reasoningTokens: (r.reasoning_tokens as number) ?? null,
        cost: (r.cost as number) ?? null,
        createdAt: (r.created_at as string) ?? null,
      }));
    } finally {
      db.close();
    }
  } catch (err) {
    if (process.env.GV_CORRELATION_DEBUG) console.error('[correlation] token read failed:', err);
    return [];
  }
}

/**
 * Unified timeline query: correlation JSONL events (+ optional Nexus token
 * transactions) filtered by session / trace / time range, ordered by ts.
 */
export async function queryCorrelation(
  options: QueryCorrelationOptions = {},
): Promise<QueryCorrelationResult> {
  const { sessionId, traceId, from, to, root = process.cwd() } = options;
  const fromMs = from !== undefined ? toMs(from) : undefined;
  const toMsBound = to !== undefined ? toMs(to) : undefined;

  const jsonlSources = readCorrelationFiles(root);
  const entries: TimelineEntry[] = [];

  for (const ev of jsonlSources) {
    if (sessionId && ev.sessionId !== sessionId) continue;
    if (traceId && ev.traceId !== traceId) continue;
    const t = Date.parse(ev.ts);
    if (fromMs !== undefined && t < fromMs) continue;
    if (toMsBound !== undefined && t >= toMsBound) continue;
    entries.push({
      ts: ev.ts,
      kind: ev.kind,
      name: ev.name,
      sessionId: ev.sessionId,
      traceId: ev.traceId,
      agent: ev.agent,
      spanId: ev.spanId,
      payload: ev.payload,
    });
  }

  let tokenCount = 0;
  const wantTokens = options.includeTokens ?? Boolean(sessionId);
  if (wantTokens && sessionId) {
    for (const tx of await readTokenTransactions(sessionId, options.dbPath)) {
      const ts = tx.createdAt ?? '';
      if (fromMs !== undefined && ts && Date.parse(ts) < fromMs) continue;
      if (toMsBound !== undefined && ts && Date.parse(ts) >= toMsBound) continue;
      tokenCount++;
      entries.push({
        ts,
        kind: 'token',
        name: 'token_transaction',
        sessionId,
        agent: tx.agent ?? undefined,
        payload: {
          messageId: tx.messageId,
          model: tx.model ?? undefined,
          inputTokens: tx.inputTokens ?? undefined,
          outputTokens: tx.outputTokens ?? undefined,
          reasoningTokens: tx.reasoningTokens ?? undefined,
          cost: tx.cost ?? undefined,
        },
      });
    }
  }

  entries.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  return {
    entries,
    total: entries.length,
    sources: {
      jsonlEvents: entries.length - tokenCount,
      tokenTransactions: tokenCount,
    },
  };
}
