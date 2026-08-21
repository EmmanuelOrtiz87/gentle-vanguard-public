#!/usr/bin/env node
/**
 * Token Ingest — daemon de ingesta AGNÓSTICA de tokens reales.
 *
 * Lee los datos de uso que CADA herramienta persiste en disco (sin depender
 * de plugins de ninguna tool) y los consolida en el stack:
 *   - opencode : SQLite  ~/.local/share/opencode/opencode.db  (tabla `session`)
 *   - Claude   : JSONL   ~/.claude/projects (pendiente)
 *   - Cursor   : SQLite/JSON local (pendiente)
 *
 * Escribe:
 *   - Nexus DB `token_usage` (persistencia real, vía better-sqlite3 directo)
 *   - .session/token-usage.json          (canonical del stack)
 *   - .session/session-current.json      (actualiza totales de la sesión viva)
 *   - reports/stack-live-observability-latest.json (report REAL, reemplaza el stale)
 *   - .runtime/token-ingest.log          (historial append-only)
 *
 * Uso:
 *   npx tsx src/token-ingest.ts --once            # una pasada
 *   npx tsx src/token-ingest.ts --watch [secs]    # bucle cada N segundos
 *   npx tsx src/token-ingest.ts --session <id>    # solo una sesión (debug)
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

const ROOT = resolve(process.cwd());
const RUNTIME_DIR = join(ROOT, '.runtime');
const SESSION_DIR = join(ROOT, '.session');
const NEXUS_DB = join(ROOT, '.runtime', 'gentle-vanguard.db');
const REPORT = join(ROOT, 'reports', 'stack-live-observability-latest.json');
const LOG_FILE = join(RUNTIME_DIR, 'token-ingest.log');

// Fuentes por herramienta (extensible). opencode es la principal (corre el stack).
function opencodeDbPath(): string | null {
  const candidates = [
    join(process.env.USERPROFILE || '', '.local', 'share', 'opencode', 'opencode.db'),
    join(process.env.HOME || '', '.local', 'share', 'opencode', 'opencode.db'),
    join(process.env.LOCALAPPDATA || '', 'opencode', 'opencode.db'),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    mkdirSync(RUNTIME_DIR, { recursive: true });
    appendFileSync(LOG_FILE, line + '\n', 'utf-8');
  } catch {
    /* non-fatal */
  }
}

interface SessionUsage {
  sessionId: string;
  tokensInput: number;
  tokensOutput: number;
  tokensReasoning: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  cost: number;
  model: string;
  provider: string;
  timeUpdated: number;
}

/** Lee las sesiones con uso real desde la DB de opencode (readonly). */
export function readOpencodeSessions(dbPath: string, sinceTimeUpdated = 0): SessionUsage[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT id, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read,
                tokens_cache_write, cost, model, time_updated
         FROM session
         WHERE (tokens_input > 0 OR tokens_output > 0)
           AND time_updated >= ?
         ORDER BY time_updated ASC`,
      )
      .all(sinceTimeUpdated) as Array<{
      id: string;
      tokens_input: number | null;
      tokens_output: number | null;
      tokens_reasoning: number | null;
      tokens_cache_read: number | null;
      tokens_cache_write: number | null;
      cost: number | null;
      model: string | null;
      time_updated: number;
    }>;
    return rows.map((r) => {
      let model = r.model || '';
      let provider = '';
      try {
        const m = JSON.parse(r.model || '{}') as { id?: string; providerID?: string };
        model = m.id || model;
        provider = m.providerID || '';
      } catch {
        /* model is a plain string */
      }
      return {
        sessionId: r.id,
        tokensInput: r.tokens_input ?? 0,
        tokensOutput: r.tokens_output ?? 0,
        tokensReasoning: r.tokens_reasoning ?? 0,
        tokensCacheRead: r.tokens_cache_read ?? 0,
        tokensCacheWrite: r.tokens_cache_write ?? 0,
        cost: r.cost ?? 0,
        model,
        provider,
        timeUpdated: r.time_updated,
      };
    });
  } finally {
    db.close();
  }
}

/** Última time_updated ya ingerida (para incrementales). */
function lastIngested(): number {
  try {
    const p = join(RUNTIME_DIR, 'token-ingest-state.json');
    if (existsSync(p)) {
      const s = JSON.parse(readFileSync(p, 'utf-8')) as { lastTimeUpdated?: number };
      return s.lastTimeUpdated ?? 0;
    }
  } catch {
    /* fresh */
  }
  return 0;
}

function saveLastIngested(t: number): void {
  try {
    mkdirSync(RUNTIME_DIR, { recursive: true });
    writeFileSync(
      join(RUNTIME_DIR, 'token-ingest-state.json'),
      JSON.stringify({ lastTimeUpdated: t }),
    );
  } catch {
    /* non-fatal */
  }
}

/** Convierte epoch ms a datetime SQLite (YYYY-MM-DD HH:MM:SS, local). */
function toSqliteDate(epochMs: number): string {
  const d = new Date(epochMs);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}:${p(d.getSeconds())}`;
}

/** Inserta/actualiza en Nexus `token_usage`. Idempotente por session_id. */
export function writeToNexus(rows: SessionUsage[]): { inserted: number; updated: number } {
  if (!existsSync(NEXUS_DB)) return { inserted: 0, updated: 0 };
  let inserted = 0;
  let updated = 0;
  try {
    const db = new Database(NEXUS_DB);
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        cost REAL,
        model TEXT,
        timestamp TEXT DEFAULT (datetime('now'))
      )`);
      const ins = db.prepare(
        `INSERT INTO token_usage (session_id, prompt_tokens, completion_tokens, cost, model, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const upd = db.prepare(
        `UPDATE token_usage SET prompt_tokens=?, completion_tokens=?, cost=?, model=?, timestamp=? WHERE session_id=?`,
      );
      const find = db.prepare(`SELECT id FROM token_usage WHERE session_id = ?`);
      const tx = db.transaction(() => {
        for (const r of rows) {
          const ts = toSqliteDate(r.timeUpdated);
          const existing = find.get(r.sessionId) as { id: number } | undefined;
          if (existing) {
            upd.run(r.tokensInput, r.tokensOutput, r.cost, r.model, ts, r.sessionId);
            updated++;
          } else {
            ins.run(r.sessionId, r.tokensInput, r.tokensOutput, r.cost, r.model, ts);
            inserted++;
          }
        }
      });
      tx();
    } finally {
      db.close();
    }
  } catch (e) {
    log(`Nexus write error: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { inserted, updated };
}

/** Actualiza el session file del stack con la sesión activa (la más reciente). */
function updateStackSession(rows: SessionUsage[]): void {
  try {
    if (rows.length === 0) return;
    const active = rows.reduce((a, b) => (b.timeUpdated > a.timeUpdated ? b : a));
    mkdirSync(SESSION_DIR, { recursive: true });
    const data = {
      sessionId: active.sessionId,
      totalInputTokens: active.tokensInput,
      totalOutputTokens: active.tokensOutput,
      totalTokens: active.tokensInput + active.tokensOutput,
      cost_usd: active.cost,
      model: active.model,
      provider: active.provider,
      source: 'token-ingest (tool-agnostic)',
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(join(SESSION_DIR, 'token-usage.json'), JSON.stringify(data, null, 2));

    // actualiza session-current.json si existe
    const cur = join(SESSION_DIR, 'session-current.json');
    if (existsSync(cur)) {
      try {
        const s = JSON.parse(readFileSync(cur, 'utf-8')) as Record<string, unknown>;
        s.totalInputTokens = active.tokensInput;
        s.totalOutputTokens = active.tokensOutput;
        s.totalTokens = active.tokensInput + active.tokensOutput;
        s.cost = active.cost;
        writeFileSync(cur, JSON.stringify(s, null, 2));
      } catch {
        /* non-fatal */
      }
    }
  } catch {
    /* non-fatal */
  }
}

/** Daily budget desde la fuente única (token-budget-guard.json). */
function dailyBudget(): number {
  try {
    const cfg = join(ROOT, 'config', 'token-budget-guard.json');
    if (existsSync(cfg)) {
      const c = JSON.parse(readFileSync(cfg, 'utf-8')) as {
        tokenBudget?: { limits?: { daily?: number } };
      };
      const d = c?.tokenBudget?.limits?.daily;
      if (typeof d === 'number' && d > 0) return d;
    }
  } catch {
    /* fallback */
  }
  return 5000000;
}

/** Regenera el report observability con datos REALES (hoy). */
function writeObservabilityReport(rows: SessionUsage[]): void {
  try {
    const now = new Date();
    const dayStart = now.setHours(0, 0, 0, 0);
    const today = rows.filter((r) => r.timeUpdated >= dayStart);
    const usedToday = today.reduce((a, r) => a + r.tokensInput + r.tokensOutput, 0);
    const costToday = today.reduce((a, r) => a + r.cost, 0);
    const budget = dailyBudget();
    // Active session = most recent by timeUpdated (same selection as updateStackSession).
    const active = rows.reduce((a, b) => (b.timeUpdated > a.timeUpdated ? b : a));
    mkdirSync(join(ROOT, 'reports'), { recursive: true });
    const report = {
      timestamp: now.toISOString(),
      generated_by: 'token-ingest (tool-agnostic daemon)',
      token: {
        status: usedToday < budget ? 'PASS' : 'OVER',
        used_today: usedToday,
        budget,
        projected_pct: Math.min(100, Math.round((usedToday / budget) * 100)),
        sessions_today: today.length,
        current_session: {
          session_id: active.sessionId,
          input_tokens: active.tokensInput,
          output_tokens: active.tokensOutput,
          total_tokens: active.tokensInput + active.tokensOutput,
          cost: active.cost,
          model: active.model,
        },
      },
      cost: {
        ratePer1M: 10,
        actualCost: costToday,
        currency: 'USD',
      },
      executive_traffic_light: usedToday < budget ? 'GREEN' : 'AMBER',
    };
    writeFileSync(REPORT, JSON.stringify(report, null, 2));
  } catch {
    /* non-fatal */
  }
}

/** Pasada de ingesta completa. Devuelve resumen. */
interface TransactionUsage {
  sessionId: string;
  messageId: string;
  role: string;
  agent: 'orchestrator' | 'subagent';
  model: string;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  timeCreated: number;
}

/**
 * Trazabilidad granular: lee los mensajes assistant con tokens reales de la
 * tabla `message` (data JSON) + jerarquía de sesiones (parent_id) para
 * distinguir orquestador (parent ROOT) de subagentes.
 */
export function readOpencodeTransactions(dbPath: string, sinceTimeCreated = 0): TransactionUsage[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    // jerarquía: session_id -> es subagente si parent_id != 'ROOT'
    const sessions = db.prepare(`SELECT id, parent_id FROM session`).all() as Array<{
      id: string;
      parent_id: string | null;
    }>;
    const agentOf = new Map<string, 'orchestrator' | 'subagent'>();
    for (const s of sessions) {
      agentOf.set(s.id, !s.parent_id || s.parent_id === 'ROOT' ? 'orchestrator' : 'subagent');
    }
    const rows = db
      .prepare(
        `SELECT id, session_id, data, time_created FROM message
         WHERE data LIKE '%assistant%' AND time_created >= ? ORDER BY time_created ASC`,
      )
      .all(sinceTimeCreated) as Array<{
      id: string;
      session_id: string;
      data: string;
      time_created: number;
    }>;
    const out: TransactionUsage[] = [];
    for (const r of rows) {
      try {
        const d = JSON.parse(r.data) as {
          role?: string;
          modelID?: string;
          cost?: number;
          tokens?: {
            input?: number;
            output?: number;
            reasoning?: number;
            cache?: { read?: number; write?: number };
          };
        };
        if (d.role !== 'assistant' || !d.tokens) continue;
        out.push({
          sessionId: r.session_id,
          messageId: r.id,
          role: d.role,
          agent: agentOf.get(r.session_id) ?? 'orchestrator',
          model: d.modelID || '',
          input: d.tokens.input ?? 0,
          output: d.tokens.output ?? 0,
          reasoning: d.tokens.reasoning ?? 0,
          cacheRead: d.tokens.cache?.read ?? 0,
          cacheWrite: d.tokens.cache?.write ?? 0,
          cost: d.cost ?? 0,
          timeCreated: r.time_created,
        });
      } catch {
        /* línea malformada */
      }
    }
    return out;
  } finally {
    db.close();
  }
}

/** Persiste transacciones en Nexus `token_transactions` (idempotente por message_id). */
export function writeTransactionsToNexus(txns: TransactionUsage[]): {
  inserted: number;
  skipped: number;
} {
  if (!existsSync(NEXUS_DB) || txns.length === 0) return { inserted: 0, skipped: 0 };
  let inserted = 0;
  let skipped = 0;
  try {
    const db = new Database(NEXUS_DB);
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS token_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT UNIQUE,
        session_id TEXT,
        agent TEXT,
        model TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        reasoning_tokens INTEGER,
        cache_read_tokens INTEGER,
        cache_write_tokens INTEGER,
        cost REAL,
        created_at TEXT
      )`);
      const ins = db.prepare(
        `INSERT OR IGNORE INTO token_transactions
         (message_id, session_id, agent, model, input_tokens, output_tokens, reasoning_tokens,
          cache_read_tokens, cache_write_tokens, cost, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const tx = db.transaction(() => {
        for (const t of txns) {
          const info = ins.run(
            t.messageId,
            t.sessionId,
            t.agent,
            t.model,
            t.input,
            t.output,
            t.reasoning,
            t.cacheRead,
            t.cacheWrite,
            t.cost,
            toSqliteDate(t.timeCreated),
          );
          if (info.changes > 0) inserted++;
          else skipped++;
        }
      });
      tx();
    } finally {
      db.close();
    }
  } catch (e) {
    log(`Nexus txn write error: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { inserted, skipped };
}

/** Ledger de ahorros (cache reads, compresión futura). Idempotente por message_id+category. */
export function writeSavingsToNexus(
  savings: Array<{
    sessionId: string;
    messageId: string;
    category: string;
    savedTokens: number;
    source: string;
    timeCreated: number;
  }>,
): { inserted: number } {
  if (!existsSync(NEXUS_DB)) return { inserted: 0 };
  let inserted = 0;
  try {
    const db = new Database(NEXUS_DB);
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS token_savings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT,
        session_id TEXT,
        category TEXT,
        saved_tokens INTEGER,
        source TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(message_id, category)
      )`);
      const ins = db.prepare(
        `INSERT OR IGNORE INTO token_savings (message_id, session_id, category, saved_tokens, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const tx = db.transaction(() => {
        for (const s of savings) {
          if (s.savedTokens <= 0) continue;
          const info = ins.run(
            s.messageId,
            s.sessionId,
            s.category,
            s.savedTokens,
            s.source,
            toSqliteDate(s.timeCreated),
          );
          if (info.changes > 0) inserted++;
        }
      });
      tx();
    } finally {
      db.close();
    }
  } catch (e) {
    log(`Nexus savings write error: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { inserted };
}

/** Ledger de ahorros de COMPRESIÓN del stack (prompt/output/structural). */
export function writeCompressionSavings(): { inserted: number } {
  const sources: Array<{ key: string; file: string; tokenField: string; label: string }> = [
    {
      key: 'compression:structural',
      file: join(RUNTIME_DIR, 'structural-compression-metrics.json'),
      tokenField: 'totalSaved',
      label: 'structural compression',
    },
    {
      key: 'compression:output',
      file: join(RUNTIME_DIR, 'output-compression-metrics.json'),
      tokenField: 'totalTokenSavings',
      label: 'output compression',
    },
    {
      key: 'compression:prompt',
      file: join(RUNTIME_DIR, 'prompt-compression-stats.json'),
      tokenField: 'totalSavedTokens',
      label: 'prompt compression',
    },
  ];
  const rows: Array<{
    messageId: string;
    sessionId: string;
    category: string;
    savedTokens: number;
    source: string;
    timeCreated: number;
  }> = [];
  for (const s of sources) {
    try {
      if (!existsSync(s.file)) continue;
      const d = JSON.parse(readFileSync(s.file, 'utf-8')) as Record<string, unknown>;
      const saved = Number(d[s.tokenField] ?? d.totalSaved ?? 0) || 0;
      if (saved <= 0) continue;
      rows.push({
        messageId: s.key,
        sessionId: 'stack-compression',
        category: 'compression',
        savedTokens: saved,
        source: s.label,
        timeCreated: statMtime(s.file),
      });
    } catch {
      /* non-fatal */
    }
  }
  return writeSavingsToNexus(rows);
}

/** mtime del archivo en epoch ms (0 si no accesible). */
function statMtime(p: string): number {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

export function ingestOnce(): {
  source: string | null;
  sessions: number;
  inserted: number;
  updated: number;
} {
  const dbPath = opencodeDbPath();
  if (!dbPath) {
    log('No se encontró la DB de opencode en rutas conocidas');
    return { source: null, sessions: 0, inserted: 0, updated: 0 };
  }
  const since = lastIngested();
  const rows = readOpencodeSessions(dbPath, since);
  if (rows.length === 0) {
    log(`Sin sesiones nuevas desde time_updated=${since}`);
    return { source: dbPath, sessions: 0, inserted: 0, updated: 0 };
  }
  const { inserted, updated } = writeToNexus(rows);
  // Trazabilidad granular: transacciones por mensaje + ahorros por cache.
  const txns = readOpencodeTransactions(dbPath, since);
  const txnRes = writeTransactionsToNexus(txns);
  const savings = txns.map((t) => ({
    sessionId: t.sessionId,
    messageId: t.messageId,
    category: 'cache',
    savedTokens: t.cacheRead,
    source: 'opencode cache read',
    timeCreated: t.timeCreated,
  }));
  const savRes = writeSavingsToNexus(savings);
  // Ahorros por compresión del stack (prompt/output/structural).
  const compRes = writeCompressionSavings();
  updateStackSession(rows);
  writeObservabilityReport(rows);
  const maxT = rows[rows.length - 1].timeUpdated;
  saveLastIngested(maxT);
  log(
    `Ingestadas ${rows.length} sesiones (insert=${inserted}, update=${updated}) + ${txnRes.inserted} transacciones + ${savRes.inserted} ahorros cache + ${compRes.inserted} ahorros compresión desde ${dbPath}`,
  );
  return { source: dbPath, sessions: rows.length, inserted, updated };
}

export async function watch(intervalSec = 30): Promise<void> {
  log(`Token Ingest daemon corriendo cada ${intervalSec}s (tool-agnostic)`);
  const loop = async (): Promise<void> => {
    try {
      ingestOnce();
    } catch (e) {
      log(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  await loop();
  setInterval(loop, intervalSec * 1000);
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}

// ─── CLI ───────────────────────────────────────────────────────────────────────

/** Detecta qué herramientas tienen datos de sesión disponibles (cobertura agnóstica). */
export function detectSources(): Array<{ tool: string; status: string; path: string }> {
  const h = process.env.USERPROFILE || process.env.HOME || '';
  const out: Array<{ tool: string; status: string; path: string }> = [];
  const oc = opencodeDbPath();
  out.push({ tool: 'opencode', status: oc ? 'ACTIVE' : 'absent', path: oc ?? '' });
  const codex = join(h, '.codex', 'sessions');
  out.push({ tool: 'codex', status: existsSync(codex) ? 'present' : 'absent', path: codex });
  const claude = join(h, '.claude', 'projects');
  out.push({ tool: 'claude', status: existsSync(claude) ? 'present' : 'absent', path: claude });
  const cursor = join(process.env.APPDATA || '', 'Cursor');
  out.push({ tool: 'cursor', status: existsSync(cursor) ? 'present' : 'absent', path: cursor });
  return out;
}

/** Reporte de trazabilidad: por sesión, por agente, costos y ahorros. */
export function generateTraceabilityReport(): string {
  if (!existsSync(NEXUS_DB)) return 'Nexus DB no existe.';
  const db = new Database(NEXUS_DB, { readonly: true });
  try {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayStr = dayStart.toISOString().replace('T', ' ').slice(0, 19);

    const txnsToday = db
      .prepare(
        `SELECT agent, COUNT(*) n, SUM(input_tokens) i, SUM(output_tokens) o,
                SUM(cache_read_tokens) cacheR, SUM(cost) cost
         FROM token_transactions WHERE created_at >= datetime(?) GROUP BY agent`,
      )
      .all(dayStr) as Array<{
      agent: string;
      n: number;
      i: number;
      o: number;
      cacheR: number;
      cost: number;
    }>;
    const savToday = db
      .prepare(
        `SELECT COALESCE(SUM(saved_tokens),0) s FROM token_savings WHERE created_at >= datetime(?)`,
      )
      .get(dayStr) as { s: number };
    const savByCategory = db
      .prepare(
        `SELECT category, COALESCE(SUM(saved_tokens),0) s FROM token_savings GROUP BY category`,
      )
      .all() as Array<{ category: string; s: number }>;
    const perSession = db
      .prepare(
        `SELECT session_id, COUNT(*) txns,
                SUM(input_tokens) i, SUM(output_tokens) o, SUM(cache_read_tokens) cacheR, SUM(cost) cost
         FROM token_transactions GROUP BY session_id ORDER BY o DESC LIMIT 8`,
      )
      .all() as Array<{
      session_id: string;
      txns: number;
      i: number;
      o: number;
      cacheR: number;
      cost: number;
    }>;

    // Subagentes individuales (iteraciones de agentes hijos).
    const subagents = db
      .prepare(
        `SELECT session_id, agent, COUNT(*) txns,
                SUM(input_tokens) i, SUM(output_tokens) o, SUM(cost) cost
         FROM token_transactions WHERE agent = 'subagent'
         GROUP BY session_id ORDER BY o DESC LIMIT 10`,
      )
      .all() as Array<{
      session_id: string;
      agent: string;
      txns: number;
      i: number;
      o: number;
      cost: number;
    }>;

    const L = (n: number): string => (n ?? 0).toLocaleString();
    let out = `════════ TRACEABILITY REPORT ════════\n`;
    const sources = detectSources();
    out += `Fuentes detectadas: ${sources.map((s) => `${s.tool}=${s.status}`).join(' | ')}\n`;
    out += `Hoy (${dayStr}):\n`;
    for (const a of txnsToday) {
      out += `  [${a.agent}] transacciones=${a.n} in=${L(a.i)} out=${L(a.o)} cacheRead=${L(a.cacheR)} cost=$${(a.cost ?? 0).toFixed(4)}\n`;
    }
    out += `  Ahorro por cache hoy: ${L(savToday.s)} tokens\n`;
    for (const c of savByCategory) {
      if (c.category !== 'cache') out += `  Ahorro ${c.category}: ${L(c.s)} tokens\n`;
    }
    out += `\nTop sesiones por output:\n`;
    for (const s of perSession) {
      out += `  ${s.session_id?.slice(0, 18)} txns=${s.txns} in=${L(s.i)} out=${L(s.o)} cacheR=${L(s.cacheR)} cost=$${(s.cost ?? 0).toFixed(4)}\n`;
    }
    if (subagents.length > 0) {
      out += `\nSubagentes (iteraciones individuales):\n`;
      for (const a of subagents) {
        out += `  ${a.session_id?.slice(0, 18)} txns=${a.txns} in=${L(a.i)} out=${L(a.o)} cost=$${(a.cost ?? 0).toFixed(4)}\n`;
      }
    }
    return out;
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--watch')) {
    const idx = args.indexOf('--watch');
    const secs = idx + 1 < args.length ? parseInt(args[idx + 1], 10) : 30;
    await watch(isNaN(secs) ? 30 : secs);
  } else if (args.includes('--report')) {
    console.log(generateTraceabilityReport());
  } else {
    const r = ingestOnce();
    console.log(JSON.stringify(r, null, 2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    log(`FATAL: ${e.message}`);
    process.exit(1);
  });
}
