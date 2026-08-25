/**
 * real-data.ts — Dashboard data pipeline backed by SQLite
 *
 * REPLACES the previous JSON-file-based pipeline with database queries.
 * The DatabaseManager writes metric_snapshots every 30s (via MetricsWriter),
 * and this file reads from those snapshots for real-time dashboard data.
 *
 * Falls back to JSON files only when the DB has no data yet (cold start).
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { ROOT, readJson, countSkills as _countSkills } from './shared.ts';
import type {
  CloudMetrics,
  CostInsight,
  DashboardData,
  ModelCost,
  SwarmWorkerData,
} from '../src/types/dashboard.ts';
import { getProcessExecutionTimeouts } from '@gentle-vanguard/core/timeout-config';
import { DatabaseManager, DEFAULT_TENANT_ID } from './database/manager.ts';
import { getAggregatedDashboardMetrics } from '@gentle-vanguard/core/metrics-aggregator';
import { OperationalMetricsTracker } from '@gentle-vanguard/core/operational-metrics-tracker';
import { runSync } from '@gentle-vanguard/core/run-command';
import { classifyDashboardSource } from './dashboard-source-provenance.ts';
import { getOrLoad } from './cache/tenant-lru-cache.ts';

// ─── Fallback JSON paths (used only when DB has no data) ──────────────
const CONSOLIDATED_PATH = join(ROOT, '.runtime', 'metrics', 'consolidated.json');
const STATS_PATH = join(ROOT, '.atl', 'skill-stats.json');
const REGISTRY_PATH = join(ROOT, '.atl', 'skill-registry.md');
const SESSIONS_HISTORY_PATH = join(ROOT, '.event-bus', 'sessions-history.json');
const CONTEXT_LOG_DIR = join(ROOT, '.session', 'context-log');
const TELEMETRY_TRACES_DIR = join(ROOT, '.telemetry', 'traces');
const TOKEN_BUDGET_PATH = join(ROOT, 'config', 'token-budget-guard.json');
const SYSTEM_WIDE_FILESYSTEM_METADATA = { scope: 'system-wide' } as const;

/** Dashboard token limit from the canonical budget config (not a legacy fallback). */
function getConfiguredSessionTokenLimit(): number {
  try {
    const config = JSON.parse(readFileSync(TOKEN_BUDGET_PATH, 'utf8')) as {
      tokenBudget?: { limits?: { perSession?: number } };
    };
    const limit = config.tokenBudget?.limits?.perSession;
    if (typeof limit === 'number' && limit > 0) return limit;
  } catch {
    // Keep the operational default if config is temporarily unavailable.
  }
  return 3_000_000;
}

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'big-pickle': { input: 10, output: 30 },
  'gpt-4': { input: 30, output: 60 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'claude-3-opus': { input: 15, output: 75 },
  'claude-3-sonnet': { input: 3, output: 15 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'claude-4-sonnet': { input: 3, output: 15 },
  default: { input: 10, output: 30 },
};

// ─── LRU Cache for .state.json reads ──────────────────────────────────
const stateCache = new Map<string, { data: string; timestamp: number }>();
const CACHE_MAX = 20;
const CACHE_TTL = 2000;

function readWithCache(path: string): string {
  const now = Date.now();
  const cached = stateCache.get(path);
  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  if (stateCache.size >= CACHE_MAX) {
    const key = stateCache.keys().next().value;
    if (key) stateCache.delete(key);
  }
  const data = readFileSync(path, 'utf-8');
  stateCache.set(path, { data, timestamp: now });
  return data;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function execGit(args: string): string {
  try {
    const result = runSync('git', args.split(' '), {
      cwd: ROOT,
      timeout: getProcessExecutionTimeouts().git_operation_ms ?? 3000,
    });
    return result.stdout?.trim() ?? '';
  } catch {
    return '';
  }
}

// ─── Database Access ──────────────────────────────────────────────────

let dbInstance: DatabaseManager | null = null;

function getDb(): DatabaseManager {
  if (!dbInstance) {
    try {
      dbInstance = DatabaseManager.getInstance();
    } catch {
      // If DB is not available, we'll use fallback
    }
  }
  return dbInstance!;
}

function dbAvailable(): boolean {
  try {
    return !!getDb() && getDb().hasData();
  } catch {
    return false;
  }
}

const ACTIVE_SESSION_FRESHNESS_MS = 15 * 60 * 1000;

function getFreshActiveSessions(): ReturnType<DatabaseManager['getActiveSessions']> {
  const cutoff = Date.now() - ACTIVE_SESSION_FRESHNESS_MS;
  return getDb()
    .getActiveSessions()
    .filter((session) => {
      const updatedAt = Date.parse(session.updated_at || '');
      return Number.isFinite(updatedAt) && updatedAt >= cutoff;
    });
}

// ─── Swarm Workers ────────────────────────────────────────────────────

const SWARM_WORK_DIR = join(ROOT, '.session', 'swarm-workers');
const RESULTS_DIR = join(ROOT, '.session', 'swarm-results');

export function getSwarmWorkers(): SwarmWorkerData {
  const empty: SwarmWorkerData = {
    activeCount: 0,
    completedCount: 0,
    failedCount: 0,
    workers: [],
    lastReport: null,
    reports: 0,
  };

  try {
    // Read worker directories
    const workerDirs = existsSync(SWARM_WORK_DIR)
      ? readdirSync(SWARM_WORK_DIR).filter((d) => {
          try {
            return existsSync(join(SWARM_WORK_DIR, d, 'output.json'));
          } catch {
            return false;
          }
        })
      : [];

    const workers: SwarmWorkerData['workers'] = [];
    let active = 0,
      completed = 0,
      failed = 0;

    for (const dir of workerDirs.slice(-50)) {
      // limit to last 50 workers
      try {
        const outputPath = join(SWARM_WORK_DIR, dir, 'output.json');
        if (!existsSync(outputPath)) continue;
        const data = JSON.parse(readFileSync(outputPath, 'utf-8'));
        const entry = {
          skill: data.skill || dir,
          status: data.status || 'unknown',
          started: data.started || '',
          finished: data.finished || undefined,
          exitCode: data.exitCode ?? null,
          output: (data.stdout || data.output || '').substring(0, 200),
          error: data.stderr || data.error || null,
          workerDir: join(SWARM_WORK_DIR, dir),
        };
        workers.push(entry);
        if (entry.status === 'running') active++;
        else if (entry.status === 'completed') completed++;
        else if (entry.status === 'failed') failed++;
      } catch {
        /* skip unreadable */
      }
    }

    // Read latest report
    let lastReport: string | null = null;
    const reportFiles = existsSync(RESULTS_DIR)
      ? readdirSync(RESULTS_DIR)
          .filter((f) => f.startsWith('swarm-report') && f.endsWith('.md'))
          .sort()
          .reverse()
      : [];
    const reports = reportFiles.length;
    if (reportFiles.length > 0) {
      try {
        const content = readFileSync(join(RESULTS_DIR, reportFiles[0]), 'utf-8');
        const taskMatch = content.match(/\*\*Task\*\*: (.+)/);
        const resultsMatch = content.match(/\*\*Results\*\*: (.+)/);
        lastReport = `${taskMatch?.[1] ?? 'unknown'} [${resultsMatch?.[1] ?? '?'}]`;
      } catch {
        /* skip */
      }
    }

    // Nexus fallback: no swarm worker dirs → derive workers from real
    // subagent activity in token_transactions (agent per message).
    if (workers.length === 0 && dbAvailable()) {
      try {
        const rows = getDb()
          .getDb()
          .prepare(
            `SELECT agent,
                    COUNT(*) AS messages,
                    SUM(input_tokens + output_tokens) AS tokens,
                    MIN(created_at) AS first_seen,
                    MAX(created_at) AS last_seen,
                    COALESCE(MAX(model), 'unknown') AS model
             FROM token_transactions
             WHERE agent IS NOT NULL AND agent != ''
             GROUP BY agent
             ORDER BY last_seen DESC
             LIMIT 20`,
          )
          .all() as Array<{
          agent: string;
          messages: number;
          tokens: number;
          first_seen: string;
          last_seen: string;
          model: string;
        }>;
        for (const r of rows) {
          const isRoot = r.agent === 'ROOT' || r.agent === 'orchestrator';
          workers.push({
            skill: r.agent,
            status: 'completed',
            started: r.first_seen,
            finished: r.last_seen,
            exitCode: 0,
            output: `${r.messages} mensajes · ${r.tokens ?? 0} tokens · ${r.model}`,
            error: null,
            workerDir: 'nexus://token_transactions',
          });
          if (isRoot) continue; // orchestrator tracked separately, not a worker
          completed++;
        }
      } catch {
        /* fall through to empty */
      }
    }

    return {
      activeCount: active,
      completedCount: completed,
      failedCount: failed,
      workers,
      lastReport,
      reports,
    };
  } catch {
    return empty;
  }
}

// ─── Public Functions ─────────────────────────────────────────────────

export function getGitStats(): { commits: number; prsMerged: number; contributors: number } {
  const gitFile = readJson<{ totalCommits: number; authorCount: number }>(
    join(ROOT, '.runtime', 'metrics', 'git.json'),
  );
  return {
    commits: gitFile?.totalCommits ?? (parseInt(execGit('rev-list --count HEAD'), 10) || 0),
    prsMerged: 0,
    contributors: gitFile?.authorCount ?? 0,
  };
}

export function getOSMetrics() {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return {
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      total: Math.round(totalMem / 1024 / 1024),
      free: Math.round(freeMem / 1024 / 1024),
      usagePercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
    },
    cpu: {
      user: Math.round(cpu.user / 1000),
      system: Math.round(cpu.system / 1000),
      cores: cpus.length,
      loadAverage: os.loadavg(),
    },
    uptime: Math.round(process.uptime()),
    pid: process.pid,
    platform: os.platform(),
    arch: os.arch(),
  };
}

// ─── getRealMetrics — Primary dashboard data source ───────────────────

export function getRealMetrics(): DashboardData {
  // PRIMARY: Use unified metrics aggregator ( SessionContextLog + live metrics )
  try {
    const aggregated = getAggregatedDashboardMetrics();
    if (aggregated.sessionsTotal > 0 || aggregated.totalTokens > 0) {
      return buildDashboardDataFromAggregated(aggregated);
    }
  } catch (err) {
    console.error('[real-data] Error from aggregated metrics:', err);
  }

  // FALLBACK: Try DB
  if (dbAvailable()) {
    return getRealMetricsFromDb();
  }

  // LAST RESORT: consolidated JSON
  return getRealMetricsFromJson();
}

export type MetricHistoryRange = '5m' | '1h' | '24h' | '7d' | '30d';

export function getMetricHistory(
  limit = 120,
  range?: MetricHistoryRange,
): Array<Record<string, unknown>> {
  if (!dbAvailable()) return [];
  const boundedLimit = Math.max(1, Math.min(2000, Math.floor(limit)));
  const since = range
    ? (
        {
          '5m': '-5 minutes',
          '1h': '-1 hours',
          '24h': '-24 hours',
          '7d': '-7 days',
          '30d': '-30 days',
        } as const
      )[range]
    : undefined;
  return getDb().getMetricHistory(boundedLimit, since).reverse() as unknown as Array<
    Record<string, unknown>
  >;
}

// Build DashboardData from aggregated metrics (unified source)
function buildDashboardDataFromAggregated(
  aggregated: ReturnType<typeof getAggregatedDashboardMetrics>,
): DashboardData {
  // Note: We use aggregated data, not DB directly
  // const db = getDb(); // Available if needed
  const gitStats = getGitStats();
  const osMetrics = getOSMetrics();

  // Session cleanup can temporarily leave the live context directory empty.
  // Keep real counts from SQLite visible while the next live state arrives.
  let dbSessionTotal = 0;
  let dbSessionActive = 0;
  try {
    if (dbAvailable()) {
      const db = getDb();
      dbSessionTotal = db.getAllSessions().length;
      dbSessionActive = getFreshActiveSessions().length;
    }
  } catch {
    // The aggregated source remains valid when SQLite is unavailable.
  }
  const sessionTotal = Math.max(aggregated.sessionsTotal, dbSessionTotal);
  const sessionActive = Math.max(aggregated.sessionsActive, dbSessionActive);

  // Get operational metrics (velocity, efficiency, productivity)
  const operationalMetrics = OperationalMetricsTracker.calculateMetrics();

  // Get MCP stats
  const skillStats = readJson<{
    totalCalls: number;
    callsByTool: Record<string, number>;
    callsBySkill: Record<string, number>;
    lastCall: string | null;
  }>(STATS_PATH) || { totalCalls: 0, callsByTool: {}, callsBySkill: {}, lastCall: null };

  const topSkills = Object.entries(skillStats.callsBySkill || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name]) => name);
  const traceData = getTraces();
  const traceStats = traceData.stats;
  const traceDurations = traceData.traces
    .map((trace) => trace.duration || 0)
    .filter((duration) => duration > 0)
    .sort((a, b) => a - b);
  const tracePercentile = (percentile: number): number => {
    if (traceDurations.length === 0) return 0;
    const index = Math.min(
      traceDurations.length - 1,
      Math.ceil((percentile / 100) * traceDurations.length) - 1,
    );
    return traceDurations[Math.max(0, index)];
  };
  const checkpointDir = join(ROOT, '.session', 'checkpoints');
  const auditDir = join(ROOT, '.session', 'audit', 'logs');
  const traceDir = join(ROOT, '.telemetry', 'traces');
  const checkpointCount = existsSync(checkpointDir)
    ? readdirSync(checkpointDir).filter((d) => !d.includes('.')).length
    : 0;
  const auditFileCount = existsSync(auditDir)
    ? readdirSync(auditDir).filter((f) => f.endsWith('.jsonl')).length
    : 0;
  const traceFileCount = existsSync(traceDir)
    ? readdirSync(traceDir).filter((f) => f.endsWith('.jsonl')).length
    : 0;
  const cloudMetricsFile = readJson<{ executions?: unknown[] }>(
    join(ROOT, '.session', 'cloud-metrics.json'),
  );
  let sqliteMetrics = {
    skillCount: 0,
    skillAvgCost: 0,
    tokenTotalCost: 0,
    contractPassRate: 0,
    routingTotalHits: 0,
  };
  try {
    if (dbAvailable()) {
      const db = getDb();
      const topSkillsRows = db.getTopSkills(100, DEFAULT_TENANT_ID);
      const tokenRow = db
        .getDb()
        .prepare('SELECT COALESCE(SUM(cost), 0) as totalCost FROM token_usage')
        .get() as { totalCost?: number };
      const contractRows = db
        .getDb()
        .prepare(
          'SELECT status, result, COUNT(*) as cnt FROM contract_results GROUP BY status, result',
        )
        .all() as Array<{ status?: string; result?: string; cnt: number }>;
      const totalContracts = contractRows.reduce((sum, row) => sum + row.cnt, 0);
      const passedContracts = contractRows
        .filter(
          (row) =>
            ['pass', 'valid', 'success'].includes(row.status || '') ||
            ['pass', 'valid', 'success'].includes(row.result || ''),
        )
        .reduce((sum, row) => sum + row.cnt, 0);
      const routingRow = db
        .getDb()
        .prepare(
          'SELECT COALESCE(SUM(hit_count), 0) as totalHits FROM routing_rules WHERE tenant_id = ?',
        )
        .get(DEFAULT_TENANT_ID) as { totalHits?: number };
      sqliteMetrics = {
        skillCount: topSkillsRows.length,
        skillAvgCost:
          topSkillsRows.length > 0
            ? topSkillsRows.reduce((sum: number, skill: any) => sum + (skill.cost || 0), 0) /
              topSkillsRows.length
            : 0,
        tokenTotalCost: tokenRow.totalCost ?? 0,
        contractPassRate: totalContracts > 0 ? passedContracts / totalContracts : 0,
        routingTotalHits: routingRow.totalHits ?? 0,
      };
    }
  } catch {
    // Optional SQLite tables remain explicitly unavailable when empty.
  }

  // Aggregated session logs do not contain model attribution. Never manufacture a
  // model split: model-level trace rows are required before this view is shown.
  const byModel: ModelCost[] = [];
  const costInsights: CostInsight[] = [];

  return {
    timestamp: new Date().toISOString(),
    source: 'aggregated',
    sourceClassification: classifyDashboardSource({
      source: 'mixed',
      filesystemMetadata: SYSTEM_WIDE_FILESYSTEM_METADATA,
    }),
    tokens: {
      used: aggregated.totalTokens,
      limit: getConfiguredSessionTokenLimit(),
      cost: aggregated.totalCost,
      byModel,
    },
    sessions: {
      total: sessionTotal,
      active: sessionActive,
      today: aggregated.sessionsToday || (dbAvailable() ? getDb().getSessionsToday().length : 0),
      avgDuration: traceStats.avgDuration || aggregated.avgLatency,
    },
    git: gitStats,
    health: {
      status: skillStats.totalCalls > 0 || sessionTotal > 0 ? 'healthy' : 'unknown',
      routing: skillStats.totalCalls > 0 ? Math.min(100, skillStats.totalCalls) : 0,
    },
    latency: {
      avg: aggregated.avgLatency || traceStats.avgDuration,
      p50: aggregated.p50Latency || tracePercentile(50),
      p95: aggregated.p95Latency || tracePercentile(95),
      p99: tracePercentile(99),
      max: traceDurations[traceDurations.length - 1] || 0,
      samples: aggregated.sloTotal || traceStats.totalTraces,
      responseTimes: {},
    },
    mcp: {
      skills: {
        total: Object.keys(skillStats.callsBySkill || {}).length,
        byAgent: {},
        recentlyUsed: topSkills,
      },
      calls: {
        total: skillStats.totalCalls,
        byTool: skillStats.callsByTool || {},
        bySkill: skillStats.callsBySkill || {},
        lastCall: skillStats.lastCall,
      },
      performance: {
        avgResponseTime: aggregated.avgLatency || traceStats.avgDuration,
        errorRate: traceStats.errorRate,
        responseTimes: {},
      },
    },
    cloud: {
      executions: cloudMetricsFile?.executions?.length || 0,
      totalCost: 0,
    },
    checkpoints: checkpointCount,
    auditLogs: auditFileCount,
    traceFiles: traceFileCount,
    sqlite: sqliteMetrics,
    swarmWorkers: getSwarmWorkers(),
    system: osMetrics,
    // Note: cost prop moved to tokens.cost - DashboardData doesn't have top-level cost
    sla: {
      uptime:
        aggregated.sloTotal > 0
          ? aggregated.sloCompliance
          : traceStats.totalTraces > 0
            ? (1 - traceStats.errorRate) * 100
            : 0,
      incidents: aggregated.sloViolations,
      lastIncident: null,
      sloCompliance:
        aggregated.sloTotal > 0
          ? aggregated.sloCompliance
          : traceStats.totalTraces > 0
            ? (1 - traceStats.errorRate) * 100
            : 0,
      responseTime95th: aggregated.p95Latency || traceStats.avgDuration,
      throughput: sessionTotal,
    },
    feedback: {
      total: aggregated.feedbackTotal,
      thumbsUp: aggregated.feedbackUp,
      thumbsDown: aggregated.feedbackDown,
      score:
        aggregated.feedbackTotal > 0 ? (aggregated.feedbackUp / aggregated.feedbackTotal) * 100 : 0,
    },
    costInsights,
    operational: operationalMetrics || {
      velocity: {
        commitsPerHour: 0,
        filesModifiedPerSession: 0,
        linesAdded: 0,
        linesDeleted: 0,
        avgTimeBetweenCommits: 0,
      },
      efficiency: {
        avgToolLatency: 0,
        successRate: 0,
        fastestTool: 'No data',
        slowestTool: 'No data',
        responseTimeP95: 0,
      },
      productivity: {
        skillsUsed: 0,
        uniqueSkills: [],
        agentsActive: 0,
        tasksCompleted: 0,
        sessionsCompleted: 0,
      },
      quality: {
        buildSuccessRate: 0,
        testPassRate: 0,
        errorsDetected: 0,
        autoCorrections: 0,
        typeCheckFailures: 0,
      },
      totalOperations: 0,
      lastUpdated: new Date().toISOString(),
    },
    globalHealth: {
      repositories: [],
      overallStatus: 'healthy',
      totalRepos: 1,
      healthyRepos: 1,
      degradedRepos: 0,
      criticalRepos: 0,
      avgCoverage: 100,
      totalOpenPRs: 0,
      lastUpdated: new Date().toISOString(),
    },
    stackCapabilities: getStackCapabilities(),
  };
}

function getRealMetricsFromDb(tenantId = DEFAULT_TENANT_ID): DashboardData {
  const db = getDb();
  const snapshot = db.getLatestMetricSnapshot(tenantId);
  const activeSessions = db
    .getActiveSessions(tenantId)
    .filter((s) => Date.now() - new Date(s.updated_at).getTime() < 3600000);
  const allSessions = db.getAllSessions(tenantId);
  const latencyStats = db.getLatencyStats(tenantId);
  const feedbackStats = db.getFeedbackStats(tenantId);
  const gitStats = getGitStats();
  const osMetrics = getOSMetrics();

  // MCP stats from skill-stats.json (still JSON-based as it's write-only)
  const skillStats = readJson<{
    totalCalls: number;
    callsByTool: Record<string, number>;
    callsBySkill: Record<string, number>;
    lastCall: string | null;
  }>(STATS_PATH) || { totalCalls: 0, callsByTool: {}, callsBySkill: {}, lastCall: null };

  const topSkills = Object.entries(skillStats.callsBySkill || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name]) => name);

  const skills = _countSkills(REGISTRY_PATH);

  // Compute byModel from traces in DB
  const traces = db
    .getDb()
    .prepare(
      'SELECT model, SUM(input_tokens) as inputTokens, SUM(output_tokens) as outputTokens, SUM(input_tokens + output_tokens) as totalTokens, SUM(cost) as cost, COUNT(*) as calls FROM traces WHERE tenant_id = ? AND model IS NOT NULL GROUP BY model',
    )
    .all(tenantId) as Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
    calls: number;
  }>;

  const byModel =
    traces.length > 0
      ? traces.map((t) => ({
          model: t.model,
          inputTokens: t.inputTokens,
          outputTokens: t.outputTokens,
          totalTokens: t.totalTokens,
          cost: t.cost,
          calls: t.calls,
        }))
      : [];

  // Total cost
  const totalCost = snapshot?.cost ?? 0;

  // Cost insights
  const costInsights = byModel
    .map((m) => {
      const pct = totalCost > 0 ? Math.round((m.cost / totalCost) * 100) : 0;
      const pricing = MODEL_PRICING[m.model] || MODEL_PRICING['default'];
      const estimatedCost =
        (m.inputTokens / 1_000_000) * pricing.input + (m.outputTokens / 1_000_000) * pricing.output;
      const savings =
        estimatedCost > 0 ? Math.round(((estimatedCost - m.cost) / estimatedCost) * 100) : 0;
      let suggestedAction: string | undefined;
      if (pct > 50 && m.model !== 'big-pickle' && m.model !== 'claude-3-haiku') {
        suggestedAction = `Consider ${m.model} → big-pickle or claude-3-haiku for cost reduction`;
      } else if (m.inputTokens > m.outputTokens * 3 && m.outputTokens > 0) {
        suggestedAction = 'High input/output ratio — review prompt compression';
      }
      return {
        model: m.model,
        cost: m.cost,
        tokens: m.totalTokens,
        pct,
        estimatedCost,
        savingsPct: savings,
        suggestedAction,
        potentialSavings: estimatedCost - m.cost,
        roi: estimatedCost > 0 ? Math.round(((estimatedCost - m.cost) / estimatedCost) * 100) : 0,
      };
    })
    .sort((a, b) => b.cost - a.cost);

  // SLA
  const sla = {
    uptime: 0,
    incidents: 0,
    lastIncident: null,
    sloCompliance: 0,
    responseTime95th: latencyStats.p95,
    throughput: allSessions.length,
  };

  // Health
  const healthStatus = snapshot?.health_status ?? 'unknown';

  // Checkpoint / audit / trace counts (from filesystem, still JSON-based)
  const checkpointDir = join(ROOT, '.session', 'checkpoints');
  const checkpointCount = existsSync(checkpointDir)
    ? readdirSync(checkpointDir).filter((d) => !d.includes('.')).length
    : 0;
  const auditDir = join(ROOT, '.session', 'audit', 'logs');
  const auditFileCount = existsSync(auditDir)
    ? readdirSync(auditDir).filter((f) => f.endsWith('.jsonl')).length
    : 0;
  const traceDir = join(ROOT, '.telemetry', 'traces');
  const traceFileCount = existsSync(traceDir)
    ? readdirSync(traceDir).filter((f) => f.endsWith('.jsonl')).length
    : 0;
  const cloudMetricsFile = readJson<{ executions: unknown[] }>(
    join(ROOT, '.session', 'cloud-metrics.json'),
  );

  // ─── SQLite Stack Tables Metrics (Wave 37) ─────────────────────────
  let sqliteSkillCount = 0;
  let sqliteSkillAvgCost = 0;
  let sqliteTokenTotalCost = 0;
  let sqliteContractPassRate = 0;
  let sqliteRoutingTotalHits = 0;
  try {
    const topSkills = db.getTopSkills(100, tenantId);
    sqliteSkillCount = topSkills.length;
    sqliteSkillAvgCost =
      topSkills.length > 0
        ? topSkills.reduce((s: number, sk: any) => s + (sk.cost || 0), 0) / topSkills.length
        : 0;

    const tokenRows = db
      .getDb()
      .prepare('SELECT COALESCE(SUM(cost), 0) as totalCost FROM token_usage WHERE tenant_id = ?')
      .get(tenantId) as any;
    sqliteTokenTotalCost = tokenRows?.totalCost ?? 0;

    const contractRows = db
      .getDb()
      .prepare('SELECT result, COUNT(*) as cnt FROM contract_results GROUP BY result')
      .all() as Array<{ result: string; cnt: number }>;
    const totalContracts = contractRows.reduce((s: number, r: any) => s + (r.cnt || 0), 0);
    const passContracts = contractRows
      .filter((r: any) => r.result === 'pass' || r.result === 'valid' || r.result === 'success')
      .reduce((s: number, r: any) => s + (r.cnt || 0), 0);
    sqliteContractPassRate = totalContracts > 0 ? passContracts / totalContracts : 1;

    const routingHits = db
      .getDb()
      .prepare(
        'SELECT COALESCE(SUM(hit_count), 0) as totalHits FROM routing_rules WHERE tenant_id = ?',
      )
      .get(tenantId) as any;
    sqliteRoutingTotalHits = routingHits?.totalHits ?? 0;
  } catch {
    // Non-fatal — SQLite metrics default to 0
  }

  return {
    timestamp: new Date().toISOString(),
    source: 'sqlite',
    sourceClassification: classifyDashboardSource({ source: 'database', tenantId }),
    tokens: {
      used: snapshot?.tokens_used ?? 0,
      limit: getConfiguredSessionTokenLimit(),
      cost: totalCost,
      byModel,
    },
    sessions: {
      total: allSessions.length,
      active: activeSessions.length,
      today: snapshot?.sessions_today ?? 0,
      avgDuration: latencyStats.avg,
    },
    latency: {
      avg: latencyStats.avg,
      p50: latencyStats.p50,
      p95: latencyStats.p95,
      p99: 0,
      max: 0,
      samples: latencyStats.count,
      responseTimes: {},
    },
    feedback: feedbackStats,
    costInsights,
    sla,
    git: gitStats,
    system: osMetrics,
    health: {
      status: healthStatus,
      routing: skillStats.totalCalls > 0 ? Math.min(100, skillStats.totalCalls) : 0,
    },
    mcp: {
      skills: { total: skills.total, byAgent: skills.byAgent, recentlyUsed: topSkills },
      calls: {
        total: skillStats.totalCalls,
        byTool: skillStats.callsByTool,
        bySkill: skillStats.callsBySkill,
        lastCall: skillStats.lastCall,
      },
      performance: {
        avgResponseTime: skillStats.totalCalls > 0 ? latencyStats.avg : 0,
        errorRate: 0,
        responseTimes: {},
      },
    },
    cloud: {
      executions: cloudMetricsFile?.executions?.length || 0,
      totalCost:
        cloudMetricsFile?.executions?.reduce((s: number, e: any) => s + (e.cost || 0), 0) || 0,
    },
    checkpoints: checkpointCount,
    auditLogs: auditFileCount,
    traceFiles: traceFileCount,
    sqlite: {
      skillCount: sqliteSkillCount,
      skillAvgCost: sqliteSkillAvgCost,
      tokenTotalCost: sqliteTokenTotalCost,
      contractPassRate: sqliteContractPassRate,
      routingTotalHits: sqliteRoutingTotalHits,
    },
    swarmWorkers: getSwarmWorkers(),
    stackCapabilities: getStackCapabilities(),
  };
}

function getRealMetricsFromJson(): DashboardData {
  // Fallback: read from consolidated.json when DB is empty
  const consolidated = readJson<any>(CONSOLIDATED_PATH);
  const skillStats = readJson<{
    totalCalls: number;
    callsByTool: Record<string, number>;
    callsBySkill: Record<string, number>;
    lastCall: string | null;
  }>(STATS_PATH) || { totalCalls: 0, callsByTool: {}, callsBySkill: {}, lastCall: null };
  const tokenUsage = readJson<{ totalTokens?: number }>(join(ROOT, '.session', 'token-usage.json'));

  const gitLive = getGitStats();
  const osMetrics = getOSMetrics();
  const skills = _countSkills(REGISTRY_PATH);

  const topSkills = Object.entries(skillStats.callsBySkill || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name]) => name);

  const t = consolidated?.token || { usedToday: 0, budget: 120000, estCost: 0 };
  // Fallback chain for token usage: consolidated (MetricsWriter) →
  // .session/token-usage.json → Nexus token_usage (source of truth).
  if (!t.usedToday) {
    const fileTotal = tokenUsage?.totalTokens ?? 0;
    if (fileTotal > 0) {
      t.usedToday = fileTotal;
    } else if (dbAvailable()) {
      try {
        const row = getDb()
          .getDb()
          .prepare(
            'SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total FROM token_usage WHERE tenant_id = ? AND timestamp >= ?',
          )
          .get(DEFAULT_TENANT_ID, new Date(Date.now() - 24 * 3600_000).toISOString()) as {
          total: number;
        };
        if (row.total > 0) {
          t.usedToday = row.total;
        }
      } catch {
        /* keep 0 */
      }
    }
  }
  const s = consolidated?.sessions || { total: 0, active: 0, today: 0 };

  // Try to get session counts from history file
  let sessionsTotal = s.total;
  let sessionsActive = s.active;
  let sessionsToday = s.today;
  try {
    const sessionsHistory =
      readJson<Array<{ id: string; status: string; createdAt: string }>>(SESSIONS_HISTORY_PATH) ||
      [];
    const today = new Date().toISOString().slice(0, 10);
    sessionsTotal = Math.max(s.total, sessionsHistory.length);
    sessionsActive = Math.max(
      s.active,
      sessionsHistory.filter((sh) => sh.status === 'active' || sh.status === 'awaiting_input')
        .length,
    );
    sessionsToday = Math.max(
      s.today,
      sessionsHistory.filter((sh) => (sh.createdAt || '').startsWith(today)).length,
    );
  } catch {
    // best-effort
  }

  // Context states for traces
  let latencyAvg = 0;
  let latencyP50 = 0;
  let latencyP95 = 0;
  let latencyCount = 0;
  try {
    if (existsSync(CONTEXT_LOG_DIR)) {
      const dirs = readdirSync(CONTEXT_LOG_DIR, { withFileTypes: true });
      const allDurations: number[] = [];
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        const stateFile = join(CONTEXT_LOG_DIR, d.name, '.state.json');
        if (!existsSync(stateFile)) continue;
        const state = JSON.parse(readWithCache(stateFile)) as {
          turns?: Array<{ totalTokens?: number }>;
        };
        if (state?.turns) {
          for (const turn of state.turns) {
            if (turn.totalTokens) allDurations.push(turn.totalTokens);
          }
        }
      }
      if (allDurations.length > 0) {
        allDurations.sort((a, b) => a - b);
        latencyAvg = Math.round(allDurations.reduce((a, b) => a + b, 0) / allDurations.length);
        latencyP50 = allDurations[Math.floor(allDurations.length * 0.5)] || 0;
        latencyP95 = allDurations[Math.floor(allDurations.length * 0.95)] || 0;
        latencyCount = allDurations.length;
      }
    }
  } catch {
    // best-effort
  }

  return {
    timestamp: new Date().toISOString(),
    source: 'json',
    sourceClassification: classifyDashboardSource({
      source: 'filesystem',
      filesystemMetadata: SYSTEM_WIDE_FILESYSTEM_METADATA,
    }),
    tokens: {
      used: t.usedToday || tokenUsage?.totalTokens || 0,
      limit: getConfiguredSessionTokenLimit(),
      cost: t.estCost || 0,
      byModel: [],
    },
    sessions: {
      total: sessionsTotal,
      active: sessionsActive,
      today: sessionsToday,
      avgDuration: 0,
    },
    latency: {
      avg: latencyAvg,
      p50: latencyP50,
      p95: latencyP95,
      p99: latencyP95,
      max: 0,
      samples: latencyCount,
      responseTimes: {},
    },
    feedback: { thumbsUp: 0, thumbsDown: 0, total: 0, score: 0 },
    costInsights: [],
    sla: {
      uptime: 0,
      incidents: 0,
      lastIncident: null,
      sloCompliance: 0,
      responseTime95th: 0,
      throughput: 0,
    },
    git: gitLive,
    system: osMetrics,
    health: {
      status: consolidated?.live?.trafficLight === 'GREEN' ? 'healthy' : 'degraded',
      routing: skillStats.totalCalls > 0 ? Math.min(100, skillStats.totalCalls) : 0,
    },
    mcp: {
      skills: { total: skills.total, byAgent: skills.byAgent, recentlyUsed: topSkills },
      calls: {
        total: skillStats.totalCalls,
        byTool: skillStats.callsByTool,
        bySkill: skillStats.callsBySkill,
        lastCall: skillStats.lastCall,
      },
      performance: {
        avgResponseTime: 0,
        errorRate: 0,
        responseTimes: {},
      },
    },
    cloud: { executions: 0, totalCost: 0 },
    checkpoints: 0,
    auditLogs: 0,
    traceFiles: 0,
    stackCapabilities: getStackCapabilities(),
  };
}

// ─── Traces ───────────────────────────────────────────────────────────

interface Trace {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'running' | 'completed' | 'error';
  attributes: Record<string, string>;
}

interface TraceStats {
  totalTraces: number;
  avgDuration: number;
  errorRate: number;
  activeSpans: number;
}

export function getTraces(
  rangeMs?: number,
  tenantId = DEFAULT_TENANT_ID,
): {
  traces: Trace[];
  stats: TraceStats;
  sourceClassification: DashboardData['sourceClassification'];
} {
  const traces: Trace[] = [];
  const cutoff = rangeMs && rangeMs > 0 ? Date.now() - rangeMs : 0;

  // Try DB first
  if (dbAvailable()) {
    try {
      const db = getDb();
      const dbTraces = (
        cutoff > 0
          ? db
              .getDb()
              .prepare(
                'SELECT * FROM traces WHERE tenant_id = ? AND start_time >= ? ORDER BY start_time DESC LIMIT 200',
              )
              .all(tenantId, cutoff)
          : db
              .getDb()
              .prepare(
                'SELECT * FROM traces WHERE tenant_id = ? ORDER BY start_time DESC LIMIT 200',
              )
              .all(tenantId)
      ) as Array<{
        span_id: string;
        trace_id: string;
        parent_span_id: string | null;
        name: string;
        start_time: number;
        end_time: number | null;
        duration: number | null;
        status: string;
        model: string | null;
        input_tokens: number;
        output_tokens: number;
        cost: number;
        session_id: string | null;
        attributes: string | null;
      }>;

      // Enrich spans lacking a model with the session's most recent model from token_transactions.
      const sessionModels = new Map<string, string>();
      try {
        const rows = db
          .getDb()
          .prepare(
            "SELECT session_id, model FROM token_transactions WHERE tenant_id = ? AND session_id IS NOT NULL AND model IS NOT NULL AND model != '' ORDER BY created_at DESC LIMIT 500",
          )
          .all(tenantId) as Array<{ session_id: string; model: string }>;
        for (const r of rows) {
          if (!sessionModels.has(r.session_id)) sessionModels.set(r.session_id, r.model);
        }
      } catch {
        // enrichment is best-effort
      }

      for (const t of dbTraces) {
        traces.push({
          traceId: t.trace_id,
          spanId: t.span_id,
          parentSpanId: t.parent_span_id ?? undefined,
          name: t.name,
          startTime: t.start_time,
          endTime: t.end_time ?? undefined,
          duration: t.duration ?? undefined,
          status: (t.status === 'error'
            ? 'error'
            : t.status === 'completed'
              ? 'completed'
              : 'running') as Trace['status'],
          attributes: {
            model: t.model || sessionModels.get(t.session_id ?? '') || '',
            inputTokens: String(t.input_tokens),
            outputTokens: String(t.output_tokens),
            cost: String(t.cost),
            sessionId: t.session_id ?? '',
          },
        });
      }
    } catch {
      // fallback to JSON
    }
  }

  // If no traces from DB, try context-log
  if (traces.length === 0 && !dbAvailable()) {
    try {
      if (existsSync(CONTEXT_LOG_DIR)) {
        const dirs = readdirSync(CONTEXT_LOG_DIR, { withFileTypes: true });
        for (const d of dirs) {
          if (!d.isDirectory()) continue;
          const stateFile = join(CONTEXT_LOG_DIR, d.name, '.state.json');
          if (!existsSync(stateFile)) continue;
          const state = JSON.parse(readWithCache(stateFile)) as {
            sessionId?: string;
            model?: string;
            turns?: Array<{
              label?: string;
              timestamp?: string;
              inputTokens?: number;
              outputTokens?: number;
              totalTokens?: number;
              cost?: number;
              contextChars?: number;
            }>;
          };
          if (!state || !state.turns) continue;

          const sessionId = state.sessionId || d.name;
          const model = state.model || 'unknown';

          for (let i = 0; i < state.turns.length; i++) {
            const turn = state.turns[i];
            const startTime = turn.timestamp ? new Date(turn.timestamp).getTime() : Date.now();
            traces.push({
              traceId: sessionId,
              spanId: `${sessionId}-turn-${i + 1}`,
              parentSpanId: i > 0 ? `${sessionId}-turn-${i}` : sessionId,
              name: turn.label || `Turn ${i + 1}`,
              startTime,
              endTime: turn.totalTokens ? startTime + turn.totalTokens : undefined,
              duration: turn.totalTokens || 0,
              status: 'completed',
              attributes: {
                model,
                inputTokens: String(turn.inputTokens || 0),
                outputTokens: String(turn.outputTokens || 0),
                cost: String(turn.cost || 0),
                contextChars: String(turn.contextChars || 0),
                sessionId,
              },
            });
          }
        }
      }
    } catch {
      /* best-effort */
    }
  }

  // If still no traces, fall back to OTLP spans in .telemetry/traces/*.jsonl
  if (traces.length === 0 && !dbAvailable()) {
    try {
      if (existsSync(TELEMETRY_TRACES_DIR)) {
        const files = readdirSync(TELEMETRY_TRACES_DIR).filter((f) => f.endsWith('.jsonl'));
        const otlpTraces: Trace[] = [];
        for (const file of files) {
          const lines = readFileSync(join(TELEMETRY_TRACES_DIR, file), 'utf-8')
            .split('\n')
            .filter((l) => l.trim());
          for (const line of lines) {
            try {
              const span = JSON.parse(line) as {
                spanId?: string;
                traceId?: string;
                parentSpanId?: string;
                name?: string;
                startTimeUnixNano?: string | number;
                endTimeUnixNano?: string | number;
                status?: { code?: string };
                attributes?: Array<{ key?: string; value?: { stringValue?: string } }> | null;
              };
              if (!span || !span.spanId) continue;
              // Skip session-start spans: they track session lifetime (days), not
              // operation latency — they would flood the tracing waterfall.
              if (span.name === 'session-start') continue;
              const startTime = Number(span.startTimeUnixNano || 0) / 1e6;
              const endTime = Number(span.endTimeUnixNano || 0) / 1e6;
              // Skip spans with invalid timestamps (would skew avgDuration)
              if (startTime <= 0 || (endTime > 0 && endTime < startTime)) continue;
              const attrs: Record<string, string> = {};
              if (Array.isArray(span.attributes)) {
                for (const a of span.attributes) {
                  if (a.key && a.value?.stringValue !== undefined) {
                    attrs[a.key] = a.value.stringValue;
                  }
                }
              }
              otlpTraces.push({
                traceId: span.traceId || file,
                spanId: span.spanId,
                parentSpanId: span.parentSpanId || undefined,
                name: span.name || 'span',
                startTime,
                endTime: endTime > 0 ? endTime : undefined,
                duration: endTime > 0 && startTime > 0 ? Math.round(endTime - startTime) : 0,
                status:
                  span.status?.code === 'STATUS_CODE_ERROR'
                    ? 'error'
                    : span.status?.code === 'STATUS_CODE_OK'
                      ? 'completed'
                      : 'running',
                attributes: {
                  model: attrs['model'] ?? attrs['llm.model'] ?? 'unknown',
                  sessionId: attrs['sessionId'] ?? attrs['session_id'] ?? '',
                  ...attrs,
                },
              });
            } catch {
              /* skip malformed line */
            }
          }
        }
        // Most recent spans first, cap at 200 to protect the frontend
        otlpTraces.sort((a, b) => b.startTime - a.startTime);
        traces.push(...otlpTraces.slice(0, 200));
      }
    } catch {
      /* best-effort */
    }
  }

  const activeSpans = traces.filter((t) => Date.now() - t.startTime < 3600000).length;
  // Exclude session-start spans (session lifetime, not operation latency) and
  // outliers > 1h from the average — they skew the operational latency metric.
  const durations = traces
    .filter(
      (t): t is typeof t & { duration: number } =>
        t.duration !== undefined && t.name !== 'session-start' && t.duration <= 3600000,
    )
    .map((t) => t.duration);
  const avgDuration =
    durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  return {
    traces,
    sourceClassification: classifyDashboardSource({
      source: dbAvailable() ? 'database' : 'filesystem',
      tenantId: dbAvailable() ? tenantId : undefined,
      filesystemMetadata: SYSTEM_WIDE_FILESYSTEM_METADATA,
    }),
    stats: {
      totalTraces: traces.length,
      avgDuration,
      errorRate:
        traces.length > 0 ? traces.filter((t) => t.status === 'error').length / traces.length : 0,
      activeSpans,
    },
  };
}

// ─── Cloud Metrics ────────────────────────────────────────────────────

export function getCloudMetrics(): CloudMetrics {
  const cloudPath = join(ROOT, '.session', 'cloud-metrics.json');
  const cloudData = readJson<{
    executions: Array<{
      provider: string;
      timestamp: string;
      duration: number;
      success: boolean;
      cost: number;
    }>;
  }>(cloudPath);
  const execs = cloudData?.executions || [];

  const byProvider: Record<
    string,
    { executions: number[]; costs: number[]; successes: boolean[] }
  > = {};
  for (const ex of execs) {
    if (!byProvider[ex.provider])
      byProvider[ex.provider] = { executions: [], costs: [], successes: [] };
    byProvider[ex.provider].executions.push(ex.duration);
    byProvider[ex.provider].costs.push(ex.cost);
    byProvider[ex.provider].successes.push(ex.success);
  }

  const stats = {
    totalExecutions: execs.length,
    totalCost: execs.reduce((s, e) => s + e.cost, 0),
    successRate: execs.length > 0 ? execs.filter((e) => e.success).length / execs.length : 1,
    avgLatency:
      execs.length > 0 ? Math.round(execs.reduce((s, e) => s + e.duration, 0) / execs.length) : 0,
    byProvider: {} as Record<
      string,
      { executions: number; cost: number; successRate: number; avgLatency: number }
    >,
    circuitBreakerStates: { AWS: 'CLOSED', Azure: 'CLOSED' },
  };

  for (const [provider, data] of Object.entries(byProvider)) {
    stats.byProvider[provider] = {
      executions: data.executions.length,
      cost: data.costs.reduce((s, c) => s + c, 0),
      successRate: data.successes.filter(Boolean).length / data.successes.length,
      avgLatency: Math.round(data.executions.reduce((s, d) => s + d, 0) / data.executions.length),
    };
  }

  return {
    executions: execs,
    stats,
    sourceClassification: classifyDashboardSource({
      source: 'filesystem',
      filesystemMetadata: SYSTEM_WIDE_FILESYSTEM_METADATA,
    }),
  };
}

// ─── Tenant-Scoped Metrics ────────────────────────────────────────────

export function getTenantScopedMetrics(tenantId: string): DashboardData {
  // LRU-cached (TTL 3s < WS push interval): absorbs REST bursts between pushes.
  return getOrLoad('tenant-metrics', tenantId, () => computeTenantScopedMetrics(tenantId));
}

function computeTenantScopedMetrics(tenantId: string): DashboardData {
  const registryPath = join(ROOT, 'config', 'tenant-registry.json');
  let tenantName = tenantId;
  try {
    if (existsSync(registryPath)) {
      const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
      const found = (registry.tenants || []).find((t: any) => t.id === tenantId);
      if (found) tenantName = found.name || tenantId;
    }
  } catch {
    /* fallback to tenantId */
  }

  const base = dbAvailable() ? getRealMetricsFromDb(tenantId) : emptyTenantMetrics(tenantId);

  // Try DB for tenant-specific session count
  let sessionCount = 0;
  if (dbAvailable()) {
    try {
      const db = getDb();
      const result = db
        .getDb()
        .prepare('SELECT COUNT(*) as count FROM sessions WHERE tenant_id = ?')
        .get(tenantId) as { count: number };
      sessionCount = result.count;
    } catch {
      // fallback
    }
  }

  return {
    ...base,
    sessions: { ...base.sessions, total: sessionCount || base.sessions.total },
    tenantId,
    tenantName,
  };
}

function emptyTenantMetrics(tenantId: string): DashboardData {
  return {
    timestamp: new Date().toISOString(),
    source: 'sqlite',
    sourceClassification: classifyDashboardSource({ source: 'database', tenantId }),
    tenantId,
    tenantName: tenantId,
    tokens: { used: 0, limit: getConfiguredSessionTokenLimit(), cost: 0, byModel: [] },
    sessions: { total: 0, active: 0, today: 0, avgDuration: 0 },
    latency: { avg: 0, p50: 0, p95: 0, p99: 0, max: 0, samples: 0, responseTimes: {} },
    feedback: { total: 0, thumbsUp: 0, thumbsDown: 0, score: 0 },
  } as unknown as DashboardData;
}

// ─── Stack Tables (SQLite queries for Wave 36/37) ─────────────────────

export function getSkillUsageFromDb(limit = 20, tenantId = DEFAULT_TENANT_ID) {
  return getOrLoad('skill-usage', tenantId, () => computeSkillUsage(limit, tenantId), {
    ttlMs: 4000,
  });
}

function computeSkillUsage(limit: number, tenantId: string) {
  const skillStats = readJson<{ callsBySkill?: Record<string, number> }>(STATS_PATH);
  const fallbackSkills = Object.entries(skillStats?.callsBySkill || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([skillId, count]) => ({ skillId, count, tokensUsed: 0, cost: 0 }));
  if (!dbAvailable()) return { skills: fallbackSkills, total: fallbackSkills.length };
  try {
    const db = getDb();
    const skills = db.getTopSkills(limit, tenantId);
    return skills.length > 0
      ? { skills, total: skills.length }
      : { skills: fallbackSkills, total: fallbackSkills.length };
  } catch {
    return { skills: fallbackSkills, total: fallbackSkills.length, error: 'DB query failed' };
  }
}

export function getTokenUsageFromDb(sessionId?: string, tenantId = DEFAULT_TENANT_ID) {
  return getOrLoad('token-usage', tenantId, () => computeTokenUsage(sessionId, tenantId), {
    ttlMs: 4000,
  });
}

function computeTokenUsage(sessionId: string | undefined, tenantId: string) {
  if (!dbAvailable()) return { usage: null };
  try {
    const db = getDb();
    if (sessionId) {
      return { usage: db.getTokenUsageBySession(sessionId, tenantId), sessionId };
    }
    // Get recent token usage across all sessions
    const rows = db
      .getDb()
      .prepare(
        'SELECT session_id, SUM(prompt_tokens) as prompt, SUM(completion_tokens) as completion, SUM(cost) as cost, MAX(timestamp) as last_used FROM token_usage WHERE tenant_id = ? GROUP BY session_id ORDER BY last_used DESC LIMIT 20',
      )
      .all(tenantId) as Array<{
      session_id: string;
      prompt: number;
      completion: number;
      cost: number;
      last_used: string;
    }>;
    return { usage: rows, total: rows.length };
  } catch {
    return { usage: null, error: 'DB query failed' };
  }
}

export function getContractResultsFromDb(limit = 20) {
  if (!dbAvailable()) return { results: [], total: 0 };
  try {
    const db = getDb();
    const rows = db
      .getDb()
      .prepare('SELECT * FROM contract_results ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return { results: rows, total: rows.length };
  } catch {
    return { results: [], total: 0, error: 'DB query failed' };
  }
}

export function getRoutingRulesFromDb(tenantId = DEFAULT_TENANT_ID) {
  return getOrLoad('routing-rules', tenantId, () => computeRoutingRules(tenantId), { ttlMs: 5000 });
}

function computeRoutingRules(tenantId: string) {
  if (!dbAvailable()) return { rules: [], total: 0 };
  try {
    const db = getDb();
    const rules = db.getEnabledRoutingRules(tenantId);
    if (rules.length > 0) return { rules, total: rules.length };
    // Nexus routing_rules empty → derive the stack's ACTUAL static routing
    // config (subagent-mapping.json) so the panel reflects reality.
    const mappingPath = join(ROOT, 'config', 'subagent-mapping.json');
    const mapping = readJson<{
      mapping?: Record<string, { name?: string; primary_subagent?: string; triggers?: string[] }>;
    }>(mappingPath);
    if (!mapping?.mapping) return { rules: [], total: 0 };
    // Real usage per subagent as hitCount proxy.
    let hits: Record<string, number> = {};
    try {
      const rows = db
        .getDb()
        .prepare(
          'SELECT agent, COUNT(*) AS n FROM token_transactions WHERE tenant_id = ? AND agent IS NOT NULL GROUP BY agent',
        )
        .all(tenantId) as Array<{ agent: string; n: number }>;
      hits = Object.fromEntries(rows.map((r) => [r.agent, r.n]));
    } catch {
      /* hitCount stays 0 */
    }
    const CORE = ['BA', 'SAD', 'DEV', 'QA'];
    const EXTENDED = ['OPS', 'GOV', 'DOC', 'SESSION', 'PREMORTEM'];
    const rulesOut = Object.entries(mapping.mapping)
      .filter(([, v]) => v.primary_subagent)
      .map(([domain, v]) => ({
        pattern:
          v.triggers && v.triggers.length > 0
            ? v.triggers.slice(0, 3).join(', ')
            : `${domain.toLowerCase()} tasks`,
        target: v.primary_subagent as string,
        priority: CORE.includes(domain) ? 90 : EXTENDED.includes(domain) ? 70 : 50,
        hitCount: hits[v.primary_subagent as string] ?? 0,
      }));
    return { rules: rulesOut, total: rulesOut.length };
  } catch {
    return { rules: [], total: 0, error: 'DB query failed' };
  }
}

// ─── Stack Capabilities (Fase 1/2: anomalies, circuit breakers, DB healing) ────

const ANOMALY_STATE_PATH = join(ROOT, '.runtime', 'anomaly-state.json');
const ANOMALY_ALERTS_PATH = join(ROOT, '.runtime', 'anomaly-alerts.json');
const CIRCUIT_BREAKER_STATE_PATH = join(ROOT, '.runtime', 'circuit-breaker-v2', 'state.json');
const DB_HEALING_STATE_PATH = join(ROOT, '.runtime', 'db-healing', 'state.json');

export function getStackCapabilities() {
  const empty: ReturnType<typeof buildStackCapabilities> = buildStackCapabilities(
    undefined,
    undefined,
    undefined,
  );
  try {
    const anomalyState = existsSync(ANOMALY_STATE_PATH)
      ? (JSON.parse(readFileSync(ANOMALY_STATE_PATH, 'utf-8')) as {
          predictions?: Array<{ type: string; probability: number; timeToOccurrence: number }>;
          lastAlert: number;
          alertCount: number;
        })
      : undefined;

    const anomalyAlerts = existsSync(ANOMALY_ALERTS_PATH)
      ? (JSON.parse(readFileSync(ANOMALY_ALERTS_PATH, 'utf-8')) as {
          alerts?: Array<{
            id: string;
            type: 'CRITICAL' | 'WARNING' | 'PREDICTION';
            category: string;
            message: string;
            confidence: number;
            detectedAt: string;
            recommendation?: string;
            autoHealed?: boolean;
            autoHealingAction?: string;
          }>;
        })
      : undefined;

    const circuitState = existsSync(CIRCUIT_BREAKER_STATE_PATH)
      ? (JSON.parse(readFileSync(CIRCUIT_BREAKER_STATE_PATH, 'utf-8')) as Record<
          string,
          {
            name: string;
            state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
            config: {
              failureThreshold: number;
              successThreshold: number;
              resetTimeout: number;
            };
            metrics: { failures: number; successes: number };
            openedAt: number | null;
            lastStateChange: number;
          }
        >)
      : undefined;

    const dbHealing = existsSync(DB_HEALING_STATE_PATH)
      ? (JSON.parse(readFileSync(DB_HEALING_STATE_PATH, 'utf-8')) as {
          lastHealTime: number;
          healCount: number;
          healAttempts: number;
          lastError: string | null;
          lastBackup: string | null;
          metrics: {
            vacuumCount: number;
            checkpointCount: number;
            reindexCount: number;
            analyzeCount: number;
            pruneCount: number;
          };
        })
      : undefined;

    return buildStackCapabilities(anomalyState, anomalyAlerts, circuitState, dbHealing);
  } catch (err) {
    console.error('[real-data] Error reading stack capabilities:', err);
    return empty;
  }
}

function buildStackCapabilities(
  anomalyState?: { predictions?: unknown[]; lastAlert?: number; alertCount?: number },
  anomalyAlerts?: { alerts?: unknown[] },
  circuitState?: Record<string, { state: string }>,
  dbHealing?: unknown,
) {
  const alerts = anomalyAlerts?.alerts ?? [];
  const predictions = anomalyState?.predictions ?? [];

  const critical = alerts.filter((a: any) => a.type === 'CRITICAL').length;
  const warning = alerts.filter((a: any) => a.type === 'WARNING').length;
  const autoHealed = alerts.filter((a: any) => a.autoHealed).length;

  const breakers = Object.entries(circuitState ?? {}).map(([key, b]: [string, any]) => ({
    name: b.name || key,
    state: b.state,
    failureThreshold: b.config?.failureThreshold ?? 0,
    successThreshold: b.config?.successThreshold ?? 0,
    resetTimeout: b.config?.resetTimeout ?? 0,
    failures: b.metrics?.failures ?? 0,
    successes: b.metrics?.successes ?? 0,
    openedAt: b.openedAt ?? null,
    lastStateChange: b.lastStateChange ?? 0,
  }));

  return {
    anomalies: {
      total: alerts.length + predictions.length,
      critical,
      warning,
      predictions: predictions.length,
      autoHealed,
      latest: (alerts as any[]).slice(-10).reverse(),
    },
    circuitBreakers: {
      total: breakers.length,
      open: breakers.filter((b) => b.state === 'OPEN').length,
      halfOpen: breakers.filter((b) => b.state === 'HALF_OPEN').length,
      closed: breakers.filter((b) => b.state === 'CLOSED').length,
      breakers,
    },
    dbHealing: (dbHealing as any) ?? null,
    lastUpdated: new Date().toISOString(),
  };
}
