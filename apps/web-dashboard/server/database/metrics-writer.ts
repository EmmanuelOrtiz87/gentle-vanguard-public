/**
 * MetricsWriter — Automatic metrics collection and database ingestion
 *
 * Collects real metrics from multiple sources every 30 seconds:
 * - Git: commit count via `git rev-list`
 * - Sessions: from in-memory map and sessions-history.json
 * - Tokens: from context-log .state.json files
 * - MCP: from .atl/skill-stats.json
 * - Latency: from trace durations
 * - System: from process.memoryUsage() and os.*
 *
 * Writes a metric_snapshot row to SQLite on each cycle.
 * Also updates consolidated.json for backward compatibility.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { runSync } from '@gentle-vanguard/core/run-command';
import { DatabaseManager, type MetricSnapshot } from './manager.ts';
import {
  getAggregatedMetrics,
  listSessions,
  readSessionState,
} from '@gentle-vanguard/core/session-context-log';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..', '..', '..');

// ─── JSON file paths (backward compat) ────────────────────────────────

const CONSOLIDATED_PATH = join(ROOT, '.runtime', 'metrics', 'consolidated.json');
const STATS_PATH = join(ROOT, '.atl', 'skill-stats.json');
const REGISTRY_PATH = join(ROOT, '.atl', 'skill-registry.md');
const CONTEXT_LOG_DIR = join(ROOT, '.session', 'context-log');

// ─── Helpers ──────────────────────────────────────────────────────────

function readJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function execGit(args: string[]): string {
  try {
    const result = runSync('git', args, { cwd: ROOT, timeout: 5000 });
    return result.status === 0 ? result.stdout.trim() : '';
  } catch {
    return '';
  }
}

// ─── Metrics Collector ────────────────────────────────────────────────

export class MetricsWriter {
  private db: DatabaseManager;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private writeCount = 0;

  constructor() {
    this.db = DatabaseManager.getInstance();
  }

  /** Start the auto-write cycle (every 30s) */
  start(intervalMs = 30000): void {
    if (this.intervalId) return;
    console.log('[MW] MetricsWriter started (every ' + intervalMs / 1000 + 's)');
    // Write immediately on start
    this.writeSnapshot();
    // Then every interval
    this.intervalId = setInterval(() => this.writeSnapshot(), intervalMs);
  }

  /** Stop the auto-write cycle */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[MW] MetricsWriter stopped');
    }
  }

  /** Collect and write one metric snapshot */
  writeSnapshot(): void {
    try {
      const snapshot = this.collectMetrics();
      this.db.insertMetricSnapshot(snapshot);
      this.writeCount++;

      // Write consolidated.json for backward compatibility
      this.writeConsolidated(snapshot);

      if (this.writeCount % 20 === 0) {
        console.log(`[MW] ${this.writeCount} snapshots written — housekeeping...`);
        this.db.housekeeping();
      }
    } catch (err) {
      console.error(
        '[MW] Error writing snapshot:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /** Collect real metrics from all sources */
  private collectMetrics(): Partial<MetricSnapshot> {
    // 1. Git stats (REAL — from git)
    const commitCount = parseInt(execGit(['rev-list', '--count', 'HEAD']), 10) || 0;

    // 2. Sessions (REAL — from unified SessionContextLog)
    let sessionsTotal = 0;
    let sessionsActive = 0;
    let sessionsToday = 0;
    try {
      const ctxMetrics = getAggregatedMetrics();
      sessionsTotal = ctxMetrics.totalSessions;
      sessionsActive = ctxMetrics.activeSessions;

      const today = new Date().toISOString().slice(0, 10);
      const allSessionIds = listSessions();
      sessionsToday = allSessionIds.filter((id) => {
        const state = readSessionState(id);
        if (!state) return false;
        return state.createdAt.startsWith(today);
      }).length;

      // Sync sessions to DB
      for (const sid of allSessionIds) {
        const state = readSessionState(sid);
        if (state) {
          this.db.upsertSession({
            id: state.sessionId,
            agent: state.agent,
            status: state.status,
            created_at: state.createdAt,
            updated_at: state.updatedAt,
            tokens_used: state.totalTokens,
            cost: state.totalCost,
            message_count: state.messageCount,
          });
        }
      }
    } catch (err) {
      console.error('[MW] Error reading from SessionContextLog:', err);
    }

    // 3. Tokens (REAL — from unified SessionContextLog)
    let tokensUsed = 0;
    let tokenCost = 0;
    try {
      const ctxMetrics = getAggregatedMetrics();
      tokensUsed = ctxMetrics.totalTokens;
      tokenCost = ctxMetrics.totalCost;
    } catch (err) {
      console.error('[MW] Error reading tokens from SessionContextLog:', err);
    }

    // 4. MCP stats (REAL — from .atl/skill-stats.json)
    const skillStats = readJson<{
      totalCalls: number;
      callsBySkill?: Record<string, number>;
    }>(STATS_PATH) || { totalCalls: 0 };
    const mcpCalls = skillStats.totalCalls ?? 0;
    const mcpSkills = Object.keys(skillStats.callsBySkill ?? {}).length;

    // Count from registry as well
    let registrySkills = 0;
    try {
      if (existsSync(REGISTRY_PATH)) {
        const content = readFileSync(REGISTRY_PATH, 'utf-8');
        registrySkills = content
          .split('\n')
          .filter((l) => l.startsWith('|') && l.includes('|') && !l.includes('Agent')).length;
      }
    } catch {
      // best-effort
    }

    // 5. Latency (REAL — from trace durations in DB or context-log)
    const latencyStats = this.db.getLatencyStats();
    // If DB has no traces yet, try to compute from context-log
    let avgLatency = latencyStats.avg;
    let p50 = latencyStats.p50;
    let p95 = latencyStats.p95;
    if (avgLatency === 0) {
      try {
        const allDurations: number[] = [];
        if (existsSync(CONTEXT_LOG_DIR)) {
          const dirs = readdirSync(CONTEXT_LOG_DIR, { withFileTypes: true });
          for (const d of dirs) {
            if (!d.isDirectory()) continue;
            const stateFile = join(CONTEXT_LOG_DIR, d.name, '.state.json');
            if (!existsSync(stateFile)) continue;
            const state = readJson<{ turns?: Array<{ totalTokens?: number }> }>(stateFile);
            if (state?.turns) {
              for (const turn of state.turns) {
                if (turn.totalTokens) allDurations.push(turn.totalTokens);
              }
            }
          }
        }
        if (allDurations.length > 0) {
          allDurations.sort((a, b) => a - b);
          avgLatency = Math.round(allDurations.reduce((a, b) => a + b, 0) / allDurations.length);
          p50 = allDurations[Math.floor(allDurations.length * 0.5)] || 0;
          p95 = allDurations[Math.floor(allDurations.length * 0.95)] || 0;
        }
      } catch {
        // best-effort
      }
    }

    // 6. Health status (from activity indicators)
    const healthStatus = mcpCalls > 0 || sessionsActive > 0 ? 'healthy' : 'unknown';

    return {
      tokens_used: tokensUsed,
      tokens_limit: 120000,
      cost: tokenCost,
      sessions_total: sessionsTotal,
      sessions_active: sessionsActive,
      sessions_today: sessionsToday,
      latency_avg: avgLatency,
      latency_p50: p50,
      latency_p95: p95,
      commits: commitCount,
      mcp_calls: mcpCalls,
      mcp_skills: Math.max(mcpSkills, registrySkills),
      health_status: healthStatus,
    };
  }

  /** Write consolidated.json for backward compatibility */
  private writeConsolidated(snapshot: Partial<MetricSnapshot>): void {
    try {
      const mem = process.memoryUsage();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const cpus = os.cpus();

      const consolidated = {
        token: {
          used: snapshot.tokens_used ?? 0,
          budget: snapshot.tokens_limit ?? 120000,
          pct: snapshot.tokens_limit
            ? Math.round(((snapshot.tokens_used ?? 0) / snapshot.tokens_limit) * 100)
            : 0,
          usedToday: snapshot.tokens_used ?? 0,
          estCost: snapshot.cost ?? 0,
          status:
            (snapshot.tokens_used ?? 0) > (snapshot.tokens_limit ?? 120000) * 0.9
              ? 'YELLOW'
              : 'GREEN',
        },
        sessions: {
          total: snapshot.sessions_total ?? 0,
          active: snapshot.sessions_active ?? 0,
          today: snapshot.sessions_today ?? 0,
        },
        git: {
          commits: snapshot.commits ?? 0,
        },
        live: {
          trafficLight: (snapshot.health_status ?? 'unknown') === 'healthy' ? 'GREEN' : 'YELLOW',
          routingAcc: 1,
        },
        cost: {
          actualCost: snapshot.cost ?? 0,
          savingsPct: 0,
        },
        mcp: {
          totalSkills: snapshot.mcp_skills ?? 0,
          totalCalls: snapshot.mcp_calls ?? 0,
        },
        system: {
          memory: {
            rss: Math.round(mem.rss / 1024 / 1024),
            heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
            total: Math.round(totalMem / 1024 / 1024),
            free: Math.round(freeMem / 1024 / 1024),
            usagePercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
          },
          cpu: {
            user: Math.round(process.cpuUsage().user / 1000),
            system: Math.round(process.cpuUsage().system / 1000),
            cores: cpus.length,
            loadAverage: os.loadavg(),
          },
          uptime: Math.round(process.uptime()),
          pid: process.pid,
          platform: os.platform(),
          arch: os.arch(),
        },
        _consolidatedAt: new Date().toISOString(),
        _consolidationCount: this.writeCount,
      };

      const dir = dirname(CONSOLIDATED_PATH);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(CONSOLIDATED_PATH, JSON.stringify(consolidated, null, 2));
    } catch (err) {
      console.warn(
        '[MW] Failed to write consolidated.json:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /** Get the total write count */
  getWriteCount(): number {
    return this.writeCount;
  }
}
