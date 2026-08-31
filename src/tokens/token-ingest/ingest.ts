import Database from 'better-sqlite3';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { recordExternalUsage } from '../../core/session-metrics-tracker';
import {
  opencodeDbPath,
  readOpencodeSessions,
  readOpencodeTransactions,
  readZcodeRollout,
  readCodexRollout,
  readMinimaxUsage,
  SessionUsage,
  TransactionUsage,
  zcodeRolloutDir,
  codexSessionsDir,
  minimaxDbPath,
} from './readers.js';
import {
  lastIngested,
  saveLastIngested,
  writeToNexus,
  writeTransactionsToNexus,
  writeSavingsToNexus,
  writeCompressionSavings,
  updateStackSession,
  writeObservabilityReport,
  writeForwardAliases,
  log,
  RUNTIME_DIR,
  NEXUS_DB,
} from './nexus.js';

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

  // Deltas reales por sesión → .session/live-metrics (SessionMetricsTracker) en vivo.
  const liveDeltas = new Map<string, { input: number; output: number; cost: number }>();
  const accumulateLive = (txns: TransactionUsage[]): void => {
    for (const t of txns) {
      if (!t.sessionId) continue;
      const d = liveDeltas.get(t.sessionId) ?? { input: 0, output: 0, cost: 0 };
      d.input += t.input;
      d.output += t.output;
      d.cost += t.cost ?? 0;
      liveDeltas.set(t.sessionId, d);
    }
  };

  // Fuentes agnósticas adicionales: cada una con su estado incremental propio.
  const extraSources: Array<{
    name: string;
    stateKey: string;
    data: { sessions: SessionUsage[]; txns: TransactionUsage[] };
  }> = [
    {
      name: 'ZCode',
      stateKey: 'zcodeLastCompletedAt',
      data: readZcodeRollout(lastIngested('zcodeLastCompletedAt')),
    },
    { name: 'Codex', stateKey: 'codexLastTs', data: readCodexRollout(lastIngested('codexLastTs')) },
    {
      name: 'MiniMax',
      stateKey: 'minimaxLastTs',
      data: readMinimaxUsage(lastIngested('minimaxLastTs')),
    },
  ];
  for (const src of extraSources) {
    if (src.data.sessions.length === 0) continue;
    const res = writeToNexus(src.data.sessions);
    const txnRes = writeTransactionsToNexus(src.data.txns);
    accumulateLive(src.data.txns);
    writeSavingsToNexus(
      src.data.txns.map((t) => ({
        sessionId: t.sessionId,
        messageId: t.messageId,
        category: 'cache',
        savedTokens: t.cacheRead,
        source: `${src.name.toLowerCase()} cache read`,
        timeCreated: t.timeCreated,
      })),
    );
    const maxTs = src.data.sessions.reduce((a, b) => Math.max(a, b.timeUpdated), 0);
    saveLastIngested(maxTs, src.stateKey);
    rows.push(...src.data.sessions); // incluye la fuente en session file / report
    log(
      `${src.name}: ${res.inserted + res.updated} sesiones + ${txnRes.inserted} transacciones nuevas`,
    );
  }

  // Forward-write del session-id bridge: alias de los ids ingeridos con
  // actividad reciente hacia la sesión activa del repo (best-effort).
  const recordForward = (opencodeTxns: TransactionUsage[]): void => {
    const lastActivity = new Map<
      string,
      { aliasId: string; lastActivityMs: number; source: string }
    >();
    for (const src of extraSources) {
      for (const s of src.data.sessions) {
        const cur = lastActivity.get(s.sessionId);
        if (!cur || s.timeUpdated > cur.lastActivityMs) {
          lastActivity.set(s.sessionId, {
            aliasId: s.sessionId,
            lastActivityMs: s.timeUpdated,
            source: src.name.toLowerCase(),
          });
        }
      }
    }
    for (const t of opencodeTxns) {
      const cur = lastActivity.get(t.sessionId);
      if (!cur || t.timeCreated > cur.lastActivityMs) {
        lastActivity.set(t.sessionId, {
          aliasId: t.sessionId,
          lastActivityMs: t.timeCreated,
          source: 'opencode',
        });
      }
    }
    const aliased = writeForwardAliases([...lastActivity.values()]);
    if (aliased > 0) log(`Session-id bridge: ${aliased} alias forward registrados`);
  };

  if (rows.length === 0) {
    log(`Sin sesiones nuevas desde time_updated=${since}`);
    recordForward([]);
    return { source: dbPath, sessions: 0, inserted: 0, updated: 0 };
  }
  const { inserted, updated } = writeToNexus(rows);
  // Trazabilidad granular: transacciones por mensaje + ahorros por cache.
  const txns = readOpencodeTransactions(dbPath, since);
  const txnRes = writeTransactionsToNexus(txns);
  accumulateLive(txns);
  // Volcar deltas reales a live-metrics para reportería en vivo (sin intervals ni singletons).
  for (const [sessionId, d] of liveDeltas) {
    recordExternalUsage(sessionId, d.input, d.output, d.cost);
  }
  if (liveDeltas.size > 0) {
    log(`Live-metrics actualizadas para ${liveDeltas.size} sesión(es) con deltas reales`);
  }
  recordForward(txns);
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
  // Register the daemon PID so process-hygiene can dedupe/recycle it across
  // sessions (previously this daemon was untracked and accumulated for days).
  const pidFile = join(RUNTIME_DIR, 'token-ingest.pid');
  const removePidFile = (): void => {
    try {
      if (existsSync(pidFile)) unlinkSync(pidFile);
    } catch {
      /* best-effort */
    }
  };
  try {
    mkdirSync(RUNTIME_DIR, { recursive: true });
    writeFileSync(pidFile, String(process.pid), 'utf-8');
  } catch {
    /* best-effort — dedupe still works via process-table scan */
  }
  log(`Token Ingest daemon corriendo cada ${intervalSec}s (tool-agnostic, PID ${process.pid})`);
  const loop = async (): Promise<void> => {
    try {
      ingestOnce();
    } catch (e) {
      log(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  await loop();
  setInterval(loop, intervalSec * 1000);
  process.on('SIGTERM', () => {
    removePidFile();
    process.exit(0);
  });
  process.on('SIGINT', () => {
    removePidFile();
    process.exit(0);
  });
}

// ─── CLI ───────────────────────────────────────────────────────────────────────

/** Detecta qué herramientas tienen datos de sesión disponibles (cobertura agnóstica). */
export function detectSources(): Array<{ tool: string; status: string; path: string }> {
  const h = process.env.USERPROFILE || process.env.HOME || '';
  const out: Array<{ tool: string; status: string; path: string }> = [];
  const oc = opencodeDbPath();
  out.push({ tool: 'opencode', status: oc ? 'ACTIVE' : 'absent', path: oc ?? '' });
  const zc = zcodeRolloutDir();
  out.push({ tool: 'zcode', status: zc ? 'ACTIVE' : 'absent', path: zc ?? '' });
  const codex = codexSessionsDir();
  out.push({ tool: 'codex', status: codex ? 'ACTIVE' : 'absent', path: codex ?? '' });
  const mm = minimaxDbPath();
  out.push({ tool: 'minimax', status: mm ? 'ACTIVE' : 'absent', path: mm ?? '' });
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
