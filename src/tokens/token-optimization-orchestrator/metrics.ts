import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { ROOT, STATS_PATH, getConfig } from './config.js';
import type { PipelineResult, OrchestratorConfig, OrchestratorStats } from './types.js';

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function saveMetrics(result: PipelineResult): void {
  try {
    const config = getConfig();
    if (!config.metricsEnabled) return;

    const metricsPath = join(ROOT, config.metricsStoragePath);
    const metrics: PipelineResult[] = [];

    if (existsSync(metricsPath)) {
      const existing = JSON.parse(readFileSync(metricsPath, 'utf-8'));
      if (Array.isArray(existing)) metrics.push(...existing);
    }

    metrics.push(result);

    // Keep only last 1000 results
    while (metrics.length > 1000) metrics.shift();

    ensureDir(metricsPath);
    writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));

    // Update aggregate stats
    updateStats(result);
  } catch {
    /* ignore */
  }
}

function updateStats(result: PipelineResult): void {
  try {
    let stats: OrchestratorStats = {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheHitRate: 0,
      totalTokenSavings: 0,
      avgSavingsPct: 0,
      byStage: {
        'cache-check': { runs: 0, avgDurationMs: 0, avgSavings: 0 },
        'pre-process': { runs: 0, avgDurationMs: 0, avgSavings: 0 },
        process: { runs: 0, avgDurationMs: 0, avgSavings: 0 },
        'post-process': { runs: 0, avgDurationMs: 0, avgSavings: 0 },
        'cache-store': { runs: 0, avgDurationMs: 0, avgSavings: 0 },
      },
    };

    if (existsSync(STATS_PATH)) {
      stats = JSON.parse(readFileSync(STATS_PATH, 'utf-8'));
    }

    stats.totalRuns++;
    stats.successfulRuns++;
    stats.totalTokenSavings += result.metrics.totalSavings;

    if (result.metrics.cacheHit) {
      stats.cacheHits++;
    } else {
      stats.cacheMisses++;
    }

    const total = stats.cacheHits + stats.cacheMisses;
    stats.cacheHitRate = total > 0 ? (stats.cacheHits / total) * 100 : 0;

    // Update per-stage stats
    for (const stage of result.stages) {
      const s = stats.byStage[stage.stage];
      if (s) {
        s.runs++;
        s.avgDurationMs = (s.avgDurationMs * (s.runs - 1) + stage.durationMs) / s.runs;
        s.avgSavings = (s.avgSavings * (s.runs - 1) + stage.savings) / s.runs;
      }
    }

    // Calculate average savings
    const orchestratorConfig = getConfig();
    const allRuns = JSON.parse(
      readFileSync(join(ROOT, orchestratorConfig.metricsStoragePath), 'utf-8') || '[]',
    );
    if (Array.isArray(allRuns) && allRuns.length > 0) {
      const totalSavings = allRuns.reduce(
        (sum: number, r: PipelineResult) => sum + r.metrics.totalSavings,
        0,
      );
      stats.avgSavingsPct = totalSavings / allRuns.length;
    }

    ensureDir(STATS_PATH);
    writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));
  } catch {
    /* ignore */
  }
}

function loadStats(): OrchestratorStats {
  try {
    if (existsSync(STATS_PATH)) {
      return JSON.parse(readFileSync(STATS_PATH, 'utf-8')) as OrchestratorStats;
    }
  } catch {
    /* ignore */
  }

  return {
    totalRuns: 0,
    successfulRuns: 0,
    failedRuns: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheHitRate: 0,
    totalTokenSavings: 0,
    avgSavingsPct: 0,
    byStage: {
      'cache-check': { runs: 0, avgDurationMs: 0, avgSavings: 0 },
      'pre-process': { runs: 0, avgDurationMs: 0, avgSavings: 0 },
      process: { runs: 0, avgDurationMs: 0, avgSavings: 0 },
      'post-process': { runs: 0, avgDurationMs: 0, avgSavings: 0 },
      'cache-store': { runs: 0, avgDurationMs: 0, avgSavings: 0 },
    },
  };
}

export function generateReport(): {
  stats: OrchestratorStats;
  config: OrchestratorConfig;
  recommendations: string[];
} {
  const stats = loadStats();
  const config = getConfig();

  const recommendations: string[] = [];

  if (stats.cacheHitRate < 10) {
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

export { ensureDir, saveMetrics, updateStats, loadStats };
