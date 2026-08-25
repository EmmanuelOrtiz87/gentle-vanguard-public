#!/usr/bin/env node
/**
 * Token Metrics Store — JSON-based token usage database and aggregation.
 * TS migration of scripts/utilities/token/token-metrics-store.ps1
 *
 * Actions: init, record, query, aggregate, dashboard
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);

const ROOT = path.resolve(process.cwd());
const RUNTIME_DIR = path.join(ROOT, '.runtime');
// Legacy JSON store — retained READ-ONLY as a close-time fallback for
// historical data. New writes go to Nexus SQLite (single authority).
const DB_PATH = path.join(RUNTIME_DIR, 'metrics.json');
const SESSION_DIR = path.join(ROOT, '.session');
const NEXUS_DB_PATH = path.join(RUNTIME_DIR, 'gentle-vanguard.db');

interface TokenRecord {
  id: number;
  session_id: string;
  date: string;
  tokens_used: number;
  cost_usd: number;
  model: string;
  provider: string;
  created_at: string;
}

interface TokenDb {
  token_usage: TokenRecord[];
  version: string;
}

interface AggregatedRow {
  date?: string;
  week?: string;
  month?: string;
  total_tokens: number;
  total_cost: number;
  sessions: number;
  avg_daily?: number;
}

function ensureRuntimeDir(): void {
  if (!fs.existsSync(RUNTIME_DIR)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  }
}

/** Minimal structural type for the better-sqlite3 connection we use here. */
interface NexusStatement {
  all(...args: unknown[]): unknown[];
  get(...args: unknown[]): unknown;
  run(...args: unknown[]): { changes: number };
}
interface NexusDb {
  prepare(sql: string): NexusStatement;
  close(): void;
}

/** Open the Nexus SQLite database (single write/read authority). */
function openNexus(): { db: NexusDb; close: () => void } | null {
  try {
    const Database = _require('better-sqlite3');
    if (!fs.existsSync(NEXUS_DB_PATH)) return null;
    const db = new Database(NEXUS_DB_PATH) as NexusDb;
    return { db, close: () => db.close() };
  } catch {
    return null;
  }
}

function readDb(): TokenDb {
  ensureRuntimeDir();
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      const db = JSON.parse(raw) as TokenDb;
      if (Array.isArray(db.token_usage)) return db;
    }
  } catch {
    /* legacy store is read-only now; ignore corruption */
  }
  return { token_usage: [], version: '1.0' };
}

function now(): string {
  return new Date().toISOString();
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function initDb(): void {
  console.log(
    `[METRICS-STORE] Nexus SQLite is the token authority: ${NEXUS_DB_PATH} (legacy ${DB_PATH} is read-only)`,
  );
}

/** Record a usage row directly into Nexus token_usage. */
function recordUsage(sessionId: string, tokens: number, cost: number): void {
  const nexus = openNexus();
  if (!nexus) {
    console.error('[METRICS-STORE] Nexus database not available; record skipped');
    process.exit(1);
  }
  try {
    nexus.db
      .prepare(
        `INSERT INTO token_usage
         (session_id, prompt_tokens, completion_tokens, cost, model, timestamp, tenant_id)
         VALUES (?, ?, 0, ?, ?, datetime('now'), 'gentle-vanguard')`,
      )
      .run(sessionId, tokens, cost, process.env.AI_MODEL || 'unknown');
    console.log(`[METRICS-STORE] Recorded: ${tokens} tokens, $${cost} for session ${sessionId}`);
  } finally {
    nexus.close();
  }
}

interface DailyRow {
  d: string;
  t: number;
  c: number;
  s: number;
}

function queryHistory(days: number): AggregatedRow[] {
  const nexus = openNexus();
  if (!nexus) return [];
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const rows = nexus.db
      .prepare(
        `SELECT date(timestamp) AS d,
                COALESCE(SUM(total_tokens), 0) AS t,
                COALESCE(SUM(cost), 0) AS c,
                COUNT(DISTINCT session_id) AS s
         FROM token_usage
         WHERE date(timestamp) >= ?
         GROUP BY d ORDER BY d`,
      )
      .all(cutoffStr) as DailyRow[];
    return rows.map((r) => ({
      date: r.d,
      total_tokens: r.t,
      total_cost: r.c,
      sessions: r.s,
    }));
  } catch {
    return [];
  } finally {
    nexus.close();
  }
}

interface BucketRow {
  date: string;
  tokens: number;
  cost: number;
  session_id: string;
}

function loadBucketRows(days: number): BucketRow[] {
  const nexus = openNexus();
  if (!nexus) return [];
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return nexus.db
      .prepare(
        `SELECT date(timestamp) AS date,
                COALESCE(SUM(total_tokens), 0) AS tokens,
                COALESCE(SUM(cost), 0) AS cost,
                session_id
         FROM token_usage
         WHERE date(timestamp) >= ?
         GROUP BY date, session_id
         ORDER BY date`,
      )
      .all(cutoffStr) as BucketRow[];
  } catch {
    return [];
  } finally {
    nexus.close();
  }
}

function getWeeklyData(): AggregatedRow[] {
  const filtered = loadBucketRows(84);
  const grouped = new Map<
    string,
    { tokens: number; cost: number; sessions: Set<string>; counts: number[] }
  >();

  for (const r of filtered) {
    const d = new Date(r.date);
    const weekKey = `${d.getFullYear()}-W${String(Math.ceil((d.getDate() + 6 - d.getDay()) / 7)).padStart(2, '0')}`;
    let g = grouped.get(weekKey);
    if (!g) {
      g = { tokens: 0, cost: 0, sessions: new Set(), counts: [] };
      grouped.set(weekKey, g);
    }
    g.tokens += r.tokens;
    g.cost += r.cost;
    g.sessions.add(r.session_id);
    g.counts.push(r.tokens);
  }

  return Array.from(grouped.entries())
    .map(([week, g]) => ({
      week,
      total_tokens: g.tokens,
      total_cost: g.cost,
      sessions: g.sessions.size,
      avg_daily: g.counts.length > 0 ? Math.round(g.tokens / g.counts.length) : 0,
    }))
    .sort((a, b) => (a.week ?? '').localeCompare(b.week ?? ''));
}

function getMonthlyData(): AggregatedRow[] {
  const filtered = loadBucketRows(183);
  const grouped = new Map<
    string,
    { tokens: number; cost: number; sessions: Set<string>; counts: number[] }
  >();

  for (const r of filtered) {
    const monthKey = r.date.slice(0, 7);
    let g = grouped.get(monthKey);
    if (!g) {
      g = { tokens: 0, cost: 0, sessions: new Set(), counts: [] };
      grouped.set(monthKey, g);
    }
    g.tokens += r.tokens;
    g.cost += r.cost;
    g.sessions.add(r.session_id);
    g.counts.push(r.tokens);
  }

  return Array.from(grouped.entries())
    .map(([month, g]) => ({
      month,
      total_tokens: g.tokens,
      total_cost: g.cost,
      sessions: g.sessions.size,
      avg_daily: g.counts.length > 0 ? Math.round(g.tokens / g.counts.length) : 0,
    }))
    .sort((a, b) => (a.month ?? '').localeCompare(b.month ?? ''));
}

// ─── Close action: compute + persist segmented session totals ────────────────

interface CloseSummary {
  session_id: string;
  closed_at: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  model: string;
  provider: string;
  source: 'nexus' | 'token-ingest' | 'session-file' | 'metrics-store';
}

/** Read segmented token totals for a session from Nexus token_usage (source of truth). */
function readNexusSessionTokens(
  sessionId: string,
): { prompt: number; completion: number; cost: number } | null {
  try {
    const Database = _require('better-sqlite3');
    if (!fs.existsSync(NEXUS_DB_PATH)) return null;
    const db = new Database(NEXUS_DB_PATH, { readonly: true });
    try {
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(prompt_tokens),0) as prompt,
                  COALESCE(SUM(completion_tokens),0) as completion,
                  COALESCE(SUM(cost),0) as cost
           FROM token_usage WHERE session_id = ?`,
        )
        .get(sessionId) as { prompt: number; completion: number; cost: number };
      return row;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/** Read accumulated tokens from the session file (session-current.json). */
function readSessionFileTokens(): { input: number; output: number; total: number } {
  const fp = path.join(SESSION_DIR, 'session-current.json');
  try {
    if (fs.existsSync(fp)) {
      const data = JSON.parse(fs.readFileSync(fp, 'utf-8')) as Record<string, unknown>;
      const input = Number(data.totalInputTokens ?? data.inputTokens ?? 0) || 0;
      const output = Number(data.totalOutputTokens ?? data.outputTokens ?? 0) || 0;
      const total = Number(data.totalTokens ?? 0) || input + output;
      return { input, output, total };
    }
  } catch {
    /* ignore */
  }
  return { input: 0, output: 0, total: 0 };
}

/**
 * Read the REAL totals written by the token-ingest daemon
 * (.session/token-usage.json), keyed by the tool's own session id.
 */
function readIngestSessionTokens(): { input: number; output: number; cost: number; total: number } {
  const fp = path.join(SESSION_DIR, 'token-usage.json');
  try {
    if (fs.existsSync(fp)) {
      const data = JSON.parse(fs.readFileSync(fp, 'utf-8')) as Record<string, unknown>;
      const input = Number(data.totalInputTokens ?? 0) || 0;
      const output = Number(data.totalOutputTokens ?? 0) || 0;
      const cost = Number(data.cost_usd ?? 0) || 0;
      const total = Number(data.totalTokens ?? 0) || input + output;
      return { input, output, cost, total };
    }
  } catch {
    /* ignore */
  }
  return { input: 0, output: 0, cost: 0, total: 0 };
}

/** Read accumulated tokens from the JSON metrics store (.runtime/metrics.json). */
function readMetricsStoreSessionTokens(sessionId: string): { tokens: number; cost: number } {
  const db = readDb();
  const records = db.token_usage.filter((r) => r.session_id === sessionId);
  return {
    tokens: records.reduce((s, r) => s + r.tokens_used, 0),
    cost: records.reduce((s, r) => s + r.cost_usd, 0),
  };
}

function closeSession(sessionId: string): CloseSummary {
  const now = new Date().toISOString();
  const sessionFile = readSessionFileTokens();
  const nexus = readNexusSessionTokens(sessionId);
  const metricsStore = readMetricsStoreSessionTokens(sessionId);
  const ingestFile = readIngestSessionTokens();

  // Prefer Nexus (real per-message data); fall back to the token-ingest file
  // (which carries the REAL totals keyed by the tool's own session id), then
  // session file, then metrics store.
  let input = 0,
    output = 0,
    cost = 0;
  let source: CloseSummary['source'] = 'session-file';

  if (nexus && (nexus.prompt > 0 || nexus.completion > 0)) {
    input = nexus.prompt;
    output = nexus.completion;
    cost = nexus.cost;
    source = 'nexus';
  } else if (ingestFile.total > 0) {
    input = ingestFile.input;
    output = ingestFile.output;
    cost = ingestFile.cost;
    source = 'token-ingest';
  } else if (sessionFile.total > 0) {
    input = sessionFile.input;
    output = sessionFile.output;
    cost = (sessionFile.total / 1_000_000) * 10.0;
    source = 'session-file';
  } else if (metricsStore.tokens > 0) {
    input = metricsStore.tokens;
    cost = metricsStore.cost;
    source = 'metrics-store';
  }

  const summary: CloseSummary = {
    session_id: sessionId,
    closed_at: now,
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
    cost_usd: Math.round(cost * 10000) / 10000,
    model: process.env.AI_MODEL || 'unknown',
    provider: process.env.AI_PROVIDER || 'unknown',
    source,
  };

  // Persist close summary to .session/token-close-summary.json
  ensureRuntimeDir();
  fs.writeFileSync(
    path.join(SESSION_DIR, 'token-close-summary.json'),
    JSON.stringify(summary, null, 2),
    'utf-8',
  );

  // Update session-current.json with final metrics ONLY if the target session
  // matches the current active session. Prevents cross-session contamination
  // when closing a historical session via --session-id.
  try {
    const fp = path.join(SESSION_DIR, 'session-current.json');
    if (fs.existsSync(fp)) {
      const data = JSON.parse(fs.readFileSync(fp, 'utf-8')) as Record<string, unknown>;
      const currentId = String(data.sessionId ?? data.id ?? '').trim();
      if (currentId === sessionId) {
        data.totalInputTokens = input;
        data.totalOutputTokens = output;
        data.totalTokens = input + output;
        data.closeTime = now;
        data.status = 'closed';
        fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8');
      }
    }
  } catch {
    /* ignore */
  }

  return summary;
}

function getDashboardData(): Record<string, unknown> {
  const daily = queryHistory(30);
  const weekly = getWeeklyData();
  const monthly = getMonthlyData();
  const today = todayDate();

  let todayTokens = 0;
  let todayCost = 0;
  const nexus = openNexus();
  if (nexus) {
    try {
      const row = nexus.db
        .prepare(
          `SELECT COALESCE(SUM(total_tokens), 0) AS t, COALESCE(SUM(cost), 0) AS c
           FROM token_usage WHERE date(timestamp) = ?`,
        )
        .get(today) as { t: number; c: number };
      todayTokens = row.t;
      todayCost = row.c;
    } catch {
      /* fall through with zeros */
    } finally {
      nexus.close();
    }
  }

  return {
    daily,
    weekly,
    monthly,
    today: { tokens: todayTokens, cost: todayCost },
    generatedAt: now(),
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const actionIdx = args.indexOf('--action');
  const action = actionIdx >= 0 ? args[actionIdx + 1] : args[0] || 'query';
  const sessionId = extractArg(args, '--session-id');
  const tokens = parseInt(extractArg(args, '--tokens') || '0', 10);
  const cost = parseFloat(extractArg(args, '--cost') || '0');
  const days = parseInt(extractArg(args, '--days') || '30', 10);
  const asJson = args.includes('--json') || args.includes('-AsJson');

  const result: Record<string, unknown> = { action, timestamp: now() };

  switch (action) {
    case 'init':
      initDb();
      result.status = 'initialized';
      result.dbPath = NEXUS_DB_PATH;
      break;

    case 'record':
      if (!sessionId) {
        console.error('-SessionId required');
        process.exit(1);
      }
      if (tokens <= 0) {
        console.error('-Tokens must be > 0');
        process.exit(1);
      }
      recordUsage(sessionId, tokens, cost);
      result.status = 'recorded';
      result.sessionId = sessionId;
      result.tokens = tokens;
      result.cost = cost;
      break;

    case 'query': {
      const data = queryHistory(days);
      result.status = 'queried';
      result.days = days;
      result.records = data;
      if (!asJson) {
        console.log(`\n=== Token History (last ${days} days) ===`);
        console.table(data);
      }
      break;
    }

    case 'aggregate': {
      const weekly = getWeeklyData();
      const monthly = getMonthlyData();
      result.status = 'aggregated';
      result.weekly = weekly;
      result.monthly = monthly;
      if (!asJson) {
        console.log('\n=== Weekly Aggregates ===');
        console.table(weekly);
        console.log('\n=== Monthly Aggregates ===');
        console.table(monthly);
      }
      break;
    }

    case 'close': {
      const sid = sessionId || readSessionIdFromFiles() || 'unknown';
      const summary = closeSession(sid);
      result.status = 'closed';
      result.sessionId = sid;
      result.summary = summary;
      if (!asJson) {
        console.log(`\n=== Token Usage Close Summary ===`);
        console.log(`Session:      ${sid}`);
        console.log(`Input tokens: ${summary.input_tokens.toLocaleString()}`);
        console.log(`Output tokens:${summary.output_tokens.toLocaleString()}`);
        console.log(`Total tokens: ${summary.total_tokens.toLocaleString()}`);
        console.log(`Cost:         $${summary.cost_usd.toFixed(4)} USD`);
        console.log(`Source:       ${summary.source}`);
        console.log(`Closed at:    ${summary.closed_at}`);
      }
      break;
    }

    case 'dashboard':
      result.status = 'dashboard';
      result.data = getDashboardData();
      break;

    default:
      console.error(`Unknown action: ${action}`);
      process.exit(1);
  }

  if (asJson) console.log(JSON.stringify(result, null, 2));
}

function extractArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

/** Resolve current session ID from session files when not provided explicitly. */
function readSessionIdFromFiles(): string | undefined {
  for (const name of ['session-current.json']) {
    const fp = path.join(SESSION_DIR, name);
    try {
      if (fs.existsSync(fp)) {
        const data = JSON.parse(fs.readFileSync(fp, 'utf-8')) as Record<string, unknown>;
        const sid = String(data.sessionId ?? data.id ?? '').trim();
        if (sid) return sid;
      }
    } catch {
      /* ignore */
    }
  }
  try {
    const files = fs
      .readdirSync(SESSION_DIR)
      .filter((f) => f.startsWith('session-') && f.endsWith('.json') && !f.includes('current'))
      .sort();
    for (const f of files.reverse()) {
      const data = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, f), 'utf-8')) as Record<
        string,
        unknown
      >;
      const sid = String(data.sessionId ?? data.id ?? '').trim();
      if (sid) return sid;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
