import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { ROOT, STATS_PATH, getConfig } from './config.js';
import type { PipelineResult, OrchestratorConfig, OrchestratorStats } from './types.js';

/**
 * Honesty rules for this file (audit 2026-11-18):
 * - The orchestrator's process stage is simulated, so every run carries
 *   `simulated: true` and its token "savings" never count as production spend.
 * - Stats are recomputed from the stored runs on every write instead of being
 *   accumulated in place: legacy rows written before the `simulated` flag existed
 *   are classified by their content, so old benchmark noise cannot inflate real
 *   savings.
 * - Records are stored redacted: chars/tokens per prompt and response, never the
 *   prompt or response text itself.
 */

const MAX_RECORDS = 1000;

interface StoredStage {
  stage: string;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  savings: number;
  success: boolean;
  error?: string;
}

interface StoredRun {
  simulated: boolean;
  recordedAt: string | null;
  durationMs: number;
  input: {
    promptChars: number;
    promptTokens: number;
    promptHash: string | null;
    context: string | null;
    skill: string | null;
    sessionId: string | null;
    chatLevel: string | null;
    cacheEnabled: boolean | null;
  };
  output: {
    responseChars: number;
    responseHash: string | null;
    fromCache: boolean;
    cacheKey: string | null;
  };
  metrics: {
    cacheHit: boolean;
    cacheTokensSaved: number;
    totalTokensIn: number;
    totalTokensOut: number;
    totalSavings: number;
    totalReduction: number;
    estimatedCostSaved: number;
  };
  stages: StoredStage[];
}

type LooseRecord = Record<string, unknown> & {
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  stages?: Array<Record<string, unknown>>;
};

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * The process stage has never called a real LLM, so any row without an explicit
 * `simulated: false` is benchmark data — legacy rows (written before the flag
 * existed) are simulated by default rather than trusted as production spend.
 */
export function isSimulatedRun(record: LooseRecord): boolean {
  return record.simulated !== false;
}

export function redactRecord(record: LooseRecord): StoredRun {
  const prompt = str(record.input?.prompt) ?? '';
  const response = str(record.output?.response) ?? '';
  const stages = Array.isArray(record.stages) ? record.stages : [];
  return {
    simulated: isSimulatedRun(record),
    recordedAt: str(record.recordedAt) ?? str(record.savedAt),
    durationMs: num(record.durationMs),
    input: {
      promptChars: prompt.length || num(record.input?.promptChars),
      promptTokens: num(record.input?.promptTokens) || num(record.metrics?.totalTokensIn),
      promptHash: str(record.input?.promptHash) ?? (prompt ? digest(prompt) : null),
      context: str(record.input?.context),
      skill: str(record.input?.skill),
      sessionId: str(record.input?.sessionId),
      chatLevel: str(record.input?.chatLevel),
      cacheEnabled:
        typeof record.input?.cacheEnabled === 'boolean'
          ? (record.input?.cacheEnabled as boolean)
          : null,
    },
    output: {
      responseChars: response.length || num(record.output?.responseChars),
      responseHash: str(record.output?.responseHash) ?? (response ? digest(response) : null),
      fromCache: record.output?.fromCache === true,
      cacheKey: str(record.output?.cacheKey),
    },
    metrics: {
      cacheHit: record.metrics?.cacheHit === true,
      cacheTokensSaved: num(record.metrics?.cacheTokensSaved),
      totalTokensIn: num(record.metrics?.totalTokensIn),
      totalTokensOut: num(record.metrics?.totalTokensOut),
      totalSavings: num(record.metrics?.totalSavings),
      totalReduction: num(record.metrics?.totalReduction),
      estimatedCostSaved: num(record.metrics?.estimatedCostSaved),
    },
    stages: stages.map((stage) => ({
      stage: str(stage.stage) ?? 'unknown',
      durationMs: num(stage.durationMs),
      tokensIn: num(stage.tokensIn),
      tokensOut: num(stage.tokensOut),
      savings: num(stage.savings),
      success: stage.success !== false,
      error: str(stage.error) ?? undefined,
    })),
  };
}

function emptyByStage(): OrchestratorStats['byStage'] {
  return {
    'cache-check': { runs: 0, avgDurationMs: 0, avgSavings: 0 },
    'pre-process': { runs: 0, avgDurationMs: 0, avgSavings: 0 },
    process: { runs: 0, avgDurationMs: 0, avgSavings: 0 },
    'post-process': { runs: 0, avgDurationMs: 0, avgSavings: 0 },
    'cache-store': { runs: 0, avgDurationMs: 0, avgSavings: 0 },
  };
}

export function recomputeStats(records: StoredRun[]): OrchestratorStats {
  const stats: OrchestratorStats = {
    totalRuns: records.length,
    successfulRuns: 0,
    failedRuns: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheHitRate: 0,
    simulatedRuns: 0,
    simulatedTokenSavings: 0,
    realRuns: 0,
    realTokenSavings: 0,
    totalTokenSavings: 0,
    avgSavingsPct: 0,
    byStage: emptyByStage(),
  };

  for (const record of records) {
    const failed = record.stages.some((stage) => !stage.success);
    if (failed) stats.failedRuns++;
    else stats.successfulRuns++;

    if (record.metrics.cacheHit) stats.cacheHits++;
    else stats.cacheMisses++;

    if (record.simulated) {
      stats.simulatedRuns++;
      stats.simulatedTokenSavings += record.metrics.totalSavings;
    } else {
      stats.realRuns++;
      stats.realTokenSavings += record.metrics.totalSavings;
    }

    for (const stage of record.stages) {
      const bucket = stats.byStage[stage.stage as keyof OrchestratorStats['byStage']];
      if (!bucket) continue;
      bucket.runs++;
      bucket.avgDurationMs =
        (bucket.avgDurationMs * (bucket.runs - 1) + stage.durationMs) / bucket.runs;
      bucket.avgSavings = (bucket.avgSavings * (bucket.runs - 1) + stage.savings) / bucket.runs;
    }
  }

  const cacheTotal = stats.cacheHits + stats.cacheMisses;
  stats.cacheHitRate = cacheTotal > 0 ? (stats.cacheHits / cacheTotal) * 100 : 0;
  stats.totalTokenSavings = stats.realTokenSavings;
  stats.avgSavingsPct = stats.realRuns > 0 ? stats.realTokenSavings / stats.realRuns : 0;
  return stats;
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadRecords(metricsPath: string): LooseRecord[] {
  try {
    if (!existsSync(metricsPath)) return [];
    const existing = JSON.parse(readFileSync(metricsPath, 'utf-8'));
    return Array.isArray(existing) ? (existing as LooseRecord[]) : [];
  } catch {
    return [];
  }
}

function saveMetrics(result: PipelineResult): void {
  try {
    const config = getConfig();
    if (!config.metricsEnabled) return;

    const metricsPath = join(ROOT, config.metricsStoragePath);
    // Redact on every write: legacy rows lose their raw prompt/response text too.
    const records = loadRecords(metricsPath).map(redactRecord);
    records.push(redactRecord(result as unknown as LooseRecord));
    while (records.length > MAX_RECORDS) records.shift();

    ensureDir(metricsPath);
    writeFileSync(metricsPath, JSON.stringify(records));

    ensureDir(STATS_PATH);
    writeFileSync(STATS_PATH, JSON.stringify(recomputeStats(records), null, 2));
  } catch {
    /* ignore */
  }
}

function loadStats(): OrchestratorStats {
  try {
    // The metrics file is the source of truth: recomputing on read heals stats
    // written before simulated/real were separated.
    const metricsPath = join(ROOT, getConfig().metricsStoragePath);
    if (existsSync(metricsPath)) {
      return recomputeStats(loadRecords(metricsPath).map(redactRecord));
    }
    if (existsSync(STATS_PATH)) {
      return JSON.parse(readFileSync(STATS_PATH, 'utf-8')) as OrchestratorStats;
    }
  } catch {
    /* ignore */
  }

  return recomputeStats([]);
}

export function generateReport(): {
  stats: OrchestratorStats;
  config: OrchestratorConfig;
  recommendations: string[];
} {
  const stats = loadStats();
  const config = getConfig();

  const recommendations: string[] = [];

  if (stats.realRuns === 0) {
    recommendations.push(
      'No real runs recorded: the pipeline process stage is simulated, so these figures benchmark compression, not production spend (see Nexus token_transactions for real usage)',
    );
  }

  if (stats.cacheHitRate < 10 && stats.totalRuns > 0) {
    recommendations.push('Consider increasing cache TTL to improve hit rate');
  }

  if (stats.byStage['pre-process'].avgSavings < 50) {
    recommendations.push('Pre-process compression savings are low - review prompt patterns');
  }

  if (stats.byStage['post-process'].avgSavings < 100) {
    recommendations.push(
      'Post-process compression savings are low - consider stricter chat levels',
    );
  }

  return { stats, config, recommendations };
}

export { ensureDir, saveMetrics, loadStats };

/** Test seam: pure stats computation over stored records. */
export type { StoredRun };
