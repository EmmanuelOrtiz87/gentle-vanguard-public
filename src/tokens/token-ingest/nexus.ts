import Database from 'better-sqlite3';
import { MigrationRunner } from '../../database/nexus//repositories/MigrationRunner.js';
import { TokenRepo } from '../../database/nexus//repositories/TokenRepo.js';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  renameSync,
  readdirSync,
  rmSync,
  statSync,
} from 'fs';
import { join, resolve } from 'path';
import { SessionUsage, TransactionUsage } from './readers.js';
import { recordForwardAliases } from '../../session/session-id-bridge.js';
import { log as createLogger } from '../../utils/logger.js';
const logger = createLogger('TOKENS-TOKEN-INGEST-NEXUS');

export const ROOT = resolve(process.cwd());
export const RUNTIME_DIR = join(ROOT, '.runtime');
export const SESSION_DIR = join(ROOT, '.session');
export const NEXUS_DB = join(ROOT, '.runtime', 'gentle-vanguard.db');
export const REPORT = join(ROOT, 'reports', 'stack-live-observability-latest.json');
export const LOG_FILE = join(RUNTIME_DIR, 'token-ingest.log');
// Rotación: el log es append-only de daemons de larga vida; sin límite creció a
// 78MB en ~2 semanas. 50MB por tramo, se conservan los últimos 3 tramos.
const LOG_MAX_BYTES = 50 * 1024 * 1024;
const LOG_KEEP_ROTATIONS = 3;

function rotateLogIfNeeded(): void {
  try {
    if (!existsSync(LOG_FILE) || statSync(LOG_FILE).size < LOG_MAX_BYTES) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    renameSync(LOG_FILE, join(RUNTIME_DIR, `token-ingest-${stamp}.log`));
    const rotations = readdirSync(RUNTIME_DIR)
      .filter((f) => /^token-ingest-\d{4}-\d{2}-\d{2}T.*\.log$/.test(f))
      .sort()
      .reverse();
    for (const old of rotations.slice(LOG_KEEP_ROTATIONS)) {
      rmSync(join(RUNTIME_DIR, old), { force: true });
    }
  } catch {
    /* non-fatal: mejor perder la rotación que el ingest */
  }
}

export function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  logger.info(line);
  try {
    mkdirSync(RUNTIME_DIR, { recursive: true });
    rotateLogIfNeeded();
    appendFileSync(LOG_FILE, line + '\n', 'utf-8');
  } catch {
    /* non-fatal */
  }
}

/** Última time_updated ya ingerida (para incrementales). `key` permite estado por fuente. */
export function lastIngested(key = 'lastTimeUpdated'): number {
  try {
    const p = join(RUNTIME_DIR, 'token-ingest-state.json');
    if (existsSync(p)) {
      const s = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, number | undefined>;
      return s[key] ?? 0;
    }
  } catch {
    /* fresh */
  }
  return 0;
}

export function saveLastIngested(t: number, key = 'lastTimeUpdated'): void {
  try {
    mkdirSync(RUNTIME_DIR, { recursive: true });
    const p = join(RUNTIME_DIR, 'token-ingest-state.json');
    let s: Record<string, number> = {};
    try {
      if (existsSync(p)) s = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, number>;
    } catch {
      /* fresh */
    }
    s[key] = t;
    writeFileSync(p, JSON.stringify(s));
  } catch {
    /* non-fatal */
  }
}

/** Convierte epoch ms a datetime SQLite (YYYY-MM-DD HH:MM:SS, local). */
export function toSqliteDate(epochMs: number): string {
  const d = new Date(epochMs);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}:${p(d.getSeconds())}`;
}

/** Compatibility export for callers of the historical ingest API. */
export function writeToNexus(rows: SessionUsage[]): { inserted: number; updated: number } {
  if (!existsSync(NEXUS_DB)) return { inserted: 0, updated: 0 };
  let inserted = 0;
  let updated = 0;
  try {
    const db = new Database(NEXUS_DB);
    try {
      new MigrationRunner(db).runMigrations();
      const repo = new TokenRepo(db);
      const tenantId = process.env.GENTLE_TENANT_ID || 'gentle-vanguard';
      const tx = db.transaction(() => {
        for (const r of rows) {
          const result = repo.upsertUsage(tenantId, {
            sessionId: r.sessionId,
            promptTokens: r.tokensInput,
            completionTokens: r.tokensOutput,
            cost: r.cost,
            model: r.model,
            timestamp: toSqliteDate(r.timeUpdated),
          });
          if (result === 'updated') updated++;
          else inserted++;
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

/**
 * Reconcilia los agregados `token_usage` con `token_transactions` reales.
 * Idempotente: una segunda corrida no cambia valores. Repara históricos
 * sub-reportados por el ingest incremental (ver TokenRepo.reconcileUsageFromTransactions).
 */
export function reconcileTokenUsage(): { sessions: number; updated: number } {
  if (!existsSync(NEXUS_DB)) return { sessions: 0, updated: 0 };
  try {
    const db = new Database(NEXUS_DB);
    try {
      new MigrationRunner(db).runMigrations();
      const result = new TokenRepo(db).reconcileUsageFromTransactions(
        process.env.GENTLE_TENANT_ID || 'gentle-vanguard',
      );
      if (result.updated > 0) {
        log(
          `Reconcile token_usage: ${result.updated}/${result.sessions} sesiones corregidas desde token_transactions`,
        );
      }
      return result;
    } finally {
      db.close();
    }
  } catch (e) {
    log(`Reconcile error: ${e instanceof Error ? e.message : String(e)}`);
    return { sessions: 0, updated: 0 };
  }
}

/**
 * Actualiza el session file del stack con la sesión activa (la más reciente).
 * The stack session id is canonical: a tool session id must never overwrite it,
 * otherwise token-status reads a tool id with no Nexus rows and reports 0.
 */
export function updateStackSession(rows: SessionUsage[]): void {
  try {
    if (rows.length === 0) return;
    const active = rows.reduce((a, b) => (b.timeUpdated > a.timeUpdated ? b : a));
    mkdirSync(SESSION_DIR, { recursive: true });

    const cur = join(SESSION_DIR, 'session-current.json');
    let stackState: Record<string, unknown> | null = null;
    if (existsSync(cur)) {
      try {
        stackState = JSON.parse(readFileSync(cur, 'utf-8')) as Record<string, unknown>;
      } catch {
        stackState = null;
      }
    }
    const stackId = stackState ? String(stackState.sessionId ?? stackState.id ?? '').trim() : '';

    const toolData = {
      sessionId: active.sessionId,
      stackSessionId: stackId || null,
      totalInputTokens: active.tokensInput,
      totalOutputTokens: active.tokensOutput,
      totalTokens: active.tokensInput + active.tokensOutput,
      cost_usd: active.cost,
      model: active.model,
      provider: active.provider,
      source: 'token-ingest (tool-agnostic)',
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(join(SESSION_DIR, 'token-usage.json'), JSON.stringify(toolData, null, 2));

    if (stackState) {
      const startedRaw = String(
        stackState.startedAt ?? stackState.startTime ?? stackState.timestamp ?? '',
      );
      const startedMs = Date.parse(startedRaw) || 0;
      // Only attribute totals when this tool session began after the stack
      // session (or is already the canonical id); older rows belong to a
      // previous session.
      const belongsToStack =
        !stackId ||
        stackId === active.sessionId ||
        (startedMs > 0 && active.timeUpdated >= startedMs - 60_000);
      stackState.activeToolSessionId = active.sessionId;
      stackState.activeToolUpdatedAt =
        active.timeUpdated > 0 ? new Date(active.timeUpdated).toISOString() : null;
      if (belongsToStack) {
        stackState.totalInputTokens = active.tokensInput;
        stackState.totalOutputTokens = active.tokensOutput;
        stackState.totalTokens = active.tokensInput + active.tokensOutput;
        stackState.cost = active.cost;
      }
      writeFileSync(cur, JSON.stringify(stackState, null, 2));

      if (stackId && active.sessionId !== stackId) {
        try {
          const db = new Database(NEXUS_DB);
          try {
            recordForwardAliases(
              db,
              [
                {
                  aliasId: active.sessionId,
                  lastActivityMs: active.timeUpdated || Date.now(),
                  source: 'token-ingest',
                },
              ],
              { repoSessionId: stackId, recencyMs: 60 * 60_000, apply: true },
            );
          } finally {
            db.close();
          }
        } catch {
          /* alias is best-effort attribution */
        }
      }
    }
  } catch {
    /* non-fatal */
  }
}

/** Daily budget desde la fuente única (token-budget-guard.json). */
export function dailyBudget(): number {
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
export function writeObservabilityReport(rows: SessionUsage[]): void {
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
      new MigrationRunner(db).runMigrations();
      const repo = new TokenRepo(db);
      const tenantId = process.env.GENTLE_TENANT_ID || 'gentle-vanguard';
      const result = repo.insertTransactions(
        tenantId,
        txns.map((t) => ({
          messageId: t.messageId,
          sessionId: t.sessionId,
          agent: t.agent,
          agentName: t.agentName,
          model: t.model,
          inputTokens: t.input,
          outputTokens: t.output,
          reasoningTokens: t.reasoning,
          cacheReadTokens: t.cacheRead,
          cacheWriteTokens: t.cacheWrite,
          cost: t.cost,
          createdAt: toSqliteDate(t.timeCreated),
        })),
      );
      inserted = result.inserted;
      skipped = result.skipped;
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
      new MigrationRunner(db).runMigrations();
      const ins = db.prepare(
        `INSERT OR IGNORE INTO token_savings (message_id, session_id, category, saved_tokens, source, created_at, tenant_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
            process.env.GENTLE_TENANT_ID || 'gentle-vanguard',
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
export function statMtime(p: string): number {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Forward-write del session-id bridge: si hay sesión activa del repo
 * (.session/session-current.json), registra alias (session_id ↔ ses_*) para
 * los alias-ids con actividad reciente. Best-effort, no rompe la ingesta.
 */
export function writeForwardAliases(
  activity: Array<{ aliasId: string; lastActivityMs: number; source: string }>,
): number {
  if (!existsSync(NEXUS_DB) || activity.length === 0) return 0;
  try {
    const db = new Database(NEXUS_DB);
    try {
      return recordForwardAliases(db, activity);
    } finally {
      db.close();
    }
  } catch (e) {
    log(`Forward alias write error: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}
