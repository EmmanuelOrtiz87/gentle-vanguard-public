#!/usr/bin/env node
/**
 * Convergence Monitor — tracks if the stack is converging, oscillating, or diverging.
 *
 * Lee de todas las etapas anteriores para determinar:
 *   ¿Estamos mejorando? ¿Las mismas decisiones se repiten? ¿Hay deriva?
 *
 * Flags:
 *   --stability    Track decision stability only
 *   --improvement  Measure improvement rate only
 *   --divergence   Check for divergence only
 *   --quiet        Minimal output (pipeline mode)
 *   --dry-run      Preview without saving
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { runSync } from '../core/run-command.js';
import { pathToFileURL } from 'url';
import { getEffectiveProcessTimeout } from '../core/timeout-config';

// ─── Types ────────────────────────────────────────────────────────────

interface ConvArgs {
  mode: 'all' | 'stability' | 'improvement' | 'divergence';
  quiet: boolean;
  dryRun: boolean;
}

interface DecisionChange {
  timestamp: string;
  component: string;
  changeType: string;
  fromValue: string;
  toValue: string;
  reason: string;
}

interface StabilityMetric {
  component: string;
  totalChanges: number;
  uniqueChanges: number;
  oscillationCount: number;
  isStable: boolean;
  stabilityScore: number; // 0..1
  trend: 'improving' | 'stable' | 'oscillating' | 'degrading';
}

interface ImprovementPoint {
  date: string;
  qualityScore: number;
  correctionRate: number;
  patternCount: number;
  suggestionCount: number;
}

interface ImprovementTrend {
  direction: 'improving' | 'stable' | 'degrading';
  slope: number;
  confidence: number;
  description: string;
}

interface DivergenceSignal {
  component: string;
  signal: string;
  severity: 'info' | 'warning' | 'critical';
  score: number;
  evidence: string[];
  recommendation: string;
}

interface ConvOutput {
  timestamp: string;
  stabilityMetrics: StabilityMetric[];
  improvementTrend: ImprovementTrend | null;
  divergenceSignals: DivergenceSignal[];
  overallScore: number;
  verdict: 'converging' | 'stable' | 'oscillating' | 'diverging';
  summary: {
    stableComponents: number;
    oscillatingComponents: number;
    degradingComponents: number;
    divergenceSignals: number;
    overallScore: number;
    verdict: string;
    sinceDate: string;
  };
}

// ─── Constants ────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const SESSION_DIR = join(ROOT, '.session');
const REFLECTIONS_DIR = join(SESSION_DIR, 'reflections');
const METRICS_FILE = join(SESSION_DIR, 'metrics-report.json');
const CONV_DIR = join(SESSION_DIR, 'convergence');
const CONV_CONFIG = join(ROOT, 'config', 'convergence-monitor.json');
const CONFIG_DIR = join(ROOT, 'config');

const DEFAULT_CONFIG = {
  decisionStability: { windowDays: 14, maxConfigChangesBeforeAlert: 5, minStabilityPeriods: 3 },
  improvementRate: {
    enabled: true,
    minDataPoints: 3,
    improvementThreshold: 0.05,
    degradationThreshold: -0.05,
  },
  divergence: {
    enabled: true,
    alertOnDivergence: true,
    minDivergenceScore: 0.6,
    consecutiveDivergencesToAlert: 2,
  },
  metrics: {
    qualityScoreWeight: 0.3,
    correctionRateWeight: 0.2,
    patternRecurrenceWeight: 0.2,
    configStabilityWeight: 0.15,
    skillHealthWeight: 0.15,
  },
  outputDir: CONV_DIR,
};

// ─── Helpers ──────────────────────────────────────────────────────────

type LogFn = (msg: string) => void;

function loadJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function getLogger(quiet: boolean): LogFn {
  return (msg: string) => {
    if (!quiet) console.log(msg);
  };
}

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function now(): string {
  return new Date().toISOString();
}

// ─── Data Collection ──────────────────────────────────────────────────

function collectReflections(): Array<Record<string, unknown>> {
  if (!existsSync(REFLECTIONS_DIR)) return [];
  return readdirSync(REFLECTIONS_DIR)
    .filter((f) => f.startsWith('reflection-') && f.endsWith('.json'))
    .sort()
    .map((f) => loadJson<Record<string, unknown>>(join(REFLECTIONS_DIR, f), {}))
    .filter((r) => Object.keys(r).length > 0);
}

function collectConfigChanges(log: LogFn): DecisionChange[] {
  const changes: DecisionChange[] = [];
  const configFiles = [
    'session-autostart.config.json',
    'adaptive-router.json',
    'predictive-governor.json',
    'root-cause-correlator.json',
    'skill-evolution-engine.json',
    'convergence-monitor.json',
  ];

  try {
    const since = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    for (const cfg of configFiles) {
      const cfgPath = join(CONFIG_DIR, cfg);
      if (!existsSync(cfgPath)) continue;
      try {
        const logOut = runSync(
          'git',
          ['log', `--since=${since}`, '--format=%aI|%s', '--', cfgPath],
          { cwd: ROOT, timeout: getEffectiveProcessTimeout('default') },
        ).stdout.trim();
        if (logOut) {
          for (const line of logOut.split('\n')) {
            const parts = line.split('|');
            changes.push({
              timestamp: parts[0] || now(),
              component: cfg,
              changeType: 'config',
              fromValue: 'previous',
              toValue: 'current',
              reason: parts.slice(1).join('|') || 'Config updated',
            });
          }
        }
      } catch {
        /* git not available */
      }
    }
  } catch {
    /* skip */
  }

  log(`  Config changes: ${changes.length}`);
  return changes;
}

function getMetricsHistory(log: LogFn): ImprovementPoint[] {
  const points: ImprovementPoint[] = [];

  // Current metrics
  const metrics = loadJson<Record<string, unknown>>(METRICS_FILE, {});
  const summary = (metrics.summary as Record<string, unknown>) || {};
  const qualityScore = (summary.quality_score as number) || 0;
  const corrections = (summary.total_corrections as number) || 0;
  const delegations = (summary.total_delegations as number) || 0;

  const correctionRate = delegations > 0 ? corrections / delegations : 0;

  // Get pattern counts from reflections
  const reflections = collectReflections();
  const totalPatterns = reflections.reduce((s, r) => {
    const patterns = (r.patterns as Array<unknown>) || [];
    return s + patterns.length;
  }, 0);
  const totalSuggestions = reflections.reduce((s, r) => {
    const suggestions = (r.suggestions as Array<unknown>) || [];
    return s + suggestions.length;
  }, 0);

  points.push({
    date: now().slice(0, 10),
    qualityScore,
    correctionRate,
    patternCount: totalPatterns,
    suggestionCount: totalSuggestions,
  });

  // Try to read historical points from previous convergence reports
  if (existsSync(CONV_DIR)) {
    const prevFiles = readdirSync(CONV_DIR)
      .filter((f) => f.startsWith('convergence-'))
      .sort()
      .reverse()
      .slice(1);
    for (const f of prevFiles) {
      const prev = loadJson<Record<string, unknown>>(join(CONV_DIR, f), {});
      const summary = (prev.summary as Record<string, unknown>) || {};
      points.push({
        date: ((prev.timestamp as string) || now()).slice(0, 10),
        qualityScore: (summary.overallScore as number) || 0,
        correctionRate: 0,
        patternCount: 0,
        suggestionCount: 0,
      });
    }
  }

  log(`  Metrics points: ${points.length}`);
  return points;
}

// ─── Decision Stability ───────────────────────────────────────────────

function trackDecisionStability(
  configChanges: DecisionChange[],
  _reflections: Array<Record<string, unknown>>,
  config: typeof DEFAULT_CONFIG,
  log: LogFn,
): StabilityMetric[] {
  const metrics: StabilityMetric[] = [];
  const ds = config.decisionStability;

  // Group changes by component
  const changesByComponent = new Map<string, DecisionChange[]>();
  for (const ch of configChanges) {
    const existing = changesByComponent.get(ch.component) || [];
    existing.push(ch);
    changesByComponent.set(ch.component, existing);
  }

  for (const [component, changes] of changesByComponent) {
    const totalChanges = changes.length;
    const uniqueReasons = new Set(changes.map((c) => c.reason)).size;

    // Detect oscillation: same reason appearing multiple times (revert/re-apply patterns)
    const reasonCounts = new Map<string, number>();
    for (const c of changes) {
      reasonCounts.set(c.reason, (reasonCounts.get(c.reason) || 0) + 1);
    }
    const oscillationCount = [...reasonCounts.values()].filter((count) => count > 1).length;

    // Score: fewer changes + fewer oscillations = more stable
    const changePenalty = Math.min(totalChanges / ds.maxConfigChangesBeforeAlert, 1);
    const oscillationPenalty = Math.min(oscillationCount / Math.max(totalChanges, 1), 1);
    const stabilityScore = Math.max(0, 1 - (changePenalty * 0.6 + oscillationPenalty * 0.4));

    let trend: StabilityMetric['trend'] = 'stable';
    if (oscillationCount >= 2 && totalChanges >= 4) trend = 'oscillating';
    else if (stabilityScore < 0.3) trend = 'degrading';
    else if (stabilityScore >= 0.8) trend = 'improving';

    metrics.push({
      component,
      totalChanges,
      uniqueChanges: uniqueReasons,
      oscillationCount,
      isStable: stabilityScore >= 0.6,
      stabilityScore: Math.round(stabilityScore * 100) / 100,
      trend,
    });
  }

  log(`  Stability metrics: ${metrics.length}`);
  return metrics;
}

// ─── Improvement Rate ────────────────────────────────────────────────

function measureImprovementRate(
  points: ImprovementPoint[],
  config: typeof DEFAULT_CONFIG,
): ImprovementTrend | null {
  if (!config.improvementRate.enabled || points.length < config.improvementRate.minDataPoints) {
    return { direction: 'stable', slope: 0, confidence: 0, description: 'Insufficient data' };
  }

  const ir = config.improvementRate;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));

  // Use last 2 points for slope
  if (sorted.length >= 2) {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const scoreDiff = last.qualityScore - first.qualityScore;
    const slope = sorted.length > 1 ? scoreDiff / (sorted.length - 1) : 0;

    // Weight: quality score + correction reduction + pattern reduction
    const correctionImprovement =
      first.correctionRate > 0
        ? (first.correctionRate - last.correctionRate) / first.correctionRate
        : 0;
    const patternImprovement =
      first.patternCount > 0 ? (first.patternCount - last.patternCount) / first.patternCount : 0;

    const weightedScore =
      slope * config.metrics.qualityScoreWeight +
      correctionImprovement * config.metrics.correctionRateWeight +
      patternImprovement * config.metrics.patternRecurrenceWeight;

    let direction: ImprovementTrend['direction'];
    let description: string;

    if (weightedScore > ir.improvementThreshold) {
      direction = 'improving';
      description = `Quality +${slope.toFixed(1)}/point, corrections ${correctionImprovement > 0 ? '↓' : '↑'}, patterns ${patternImprovement > 0 ? '↓' : '↑'}`;
    } else if (weightedScore < ir.degradationThreshold) {
      direction = 'degrading';
      description = `Quality ${slope.toFixed(1)}/point — negative trend detected`;
    } else {
      direction = 'stable';
      description = `Quality ${slope > 0 ? '+' : ''}${slope.toFixed(1)}/point — within normal range`;
    }

    const confidence = Math.min(0.3 + Math.abs(weightedScore) * 2 + points.length * 0.05, 0.95);

    return {
      direction,
      slope: Math.round(weightedScore * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
      description,
    };
  }

  return { direction: 'stable', slope: 0, confidence: 0.3, description: 'Single data point' };
}

// ─── Divergence Detection ─────────────────────────────────────────────

function alertOnDivergence(
  stabilityMetrics: StabilityMetric[],
  improvementTrend: ImprovementTrend | null,
  _reflections: Array<Record<string, unknown>>,
  config: typeof DEFAULT_CONFIG,
  log: LogFn,
): DivergenceSignal[] {
  if (!config.divergence.enabled) return [];
  const signals: DivergenceSignal[] = [];
  const dv = config.divergence;

  // Signal 1: Oscillating components
  const oscillating = stabilityMetrics.filter((m) => m.trend === 'oscillating');
  for (const m of oscillating) {
    const score = Math.min(0.4 + (m.oscillationCount / m.totalChanges) * 0.4, 0.95);
    if (score >= dv.minDivergenceScore) {
      signals.push({
        component: m.component,
        signal: `Config oscillation detected in ${m.component}`,
        severity: 'warning',
        score,
        evidence: [`${m.totalChanges} changes, ${m.oscillationCount} oscillation(s)`],
        recommendation: `Review change history for ${m.component}. Consider locking config or implementing approval gate.`,
      });
    }
  }

  // Signal 2: Degrading improvement trend
  if (
    improvementTrend &&
    improvementTrend.direction === 'degrading' &&
    improvementTrend.confidence >= 0.5
  ) {
    signals.push({
      component: 'system',
      signal: 'Overall system quality is degrading',
      severity: 'critical',
      score: Math.min(Math.abs(improvementTrend.slope) + 0.5, 0.95),
      evidence: [`Slope: ${improvementTrend.slope}`, improvementTrend.description],
      recommendation:
        'Run root-cause analysis and prioritize corrective actions. Consider rolling back recent changes.',
    });
  }

  // Signal 3: Many stale components + no improvement = divergence
  const stableCount = stabilityMetrics.filter((m) => m.isStable).length;
  const totalCount = stabilityMetrics.length;
  if (
    totalCount > 0 &&
    stableCount / totalCount < 0.3 &&
    improvementTrend?.direction === 'stable'
  ) {
    signals.push({
      component: 'system',
      signal: 'System is stable but not improving — potential plateau',
      severity: 'info',
      score: 0.5,
      evidence: [`${stableCount}/${totalCount} components stable`, 'No positive quality trend'],
      recommendation: 'Introduce new optimizations or targets to break out of plateau.',
    });
  }

  log(`  Divergence signals: ${signals.length}`);
  return signals;
}

// ─── Overall Score ────────────────────────────────────────────────────

function computeOverallScore(
  stabilityMetrics: StabilityMetric[],
  improvementTrend: ImprovementTrend | null,
  divergenceSignals: DivergenceSignal[],
): { score: number; verdict: ConvOutput['verdict'] } {
  let score = 70; // baseline

  // Stability contribution
  const stableRatio =
    stabilityMetrics.length > 0
      ? stabilityMetrics.filter((m) => m.isStable).length / stabilityMetrics.length
      : 0.5;
  score += (stableRatio - 0.5) * 30;

  // Improvement contribution
  if (improvementTrend) {
    if (improvementTrend.direction === 'improving') score += 15;
    else if (improvementTrend.direction === 'degrading') score -= 20;
  }

  // Divergence penalty
  const criticalSignals = divergenceSignals.filter((s) => s.severity === 'critical').length;
  const warningSignals = divergenceSignals.filter((s) => s.severity === 'warning').length;
  score -= criticalSignals * 15;
  score -= warningSignals * 8;

  // Clamp
  score = Math.max(0, Math.min(100, score));

  // Verdict
  let verdict: ConvOutput['verdict'];
  if (score >= 75) verdict = 'converging';
  else if (score >= 50) verdict = 'stable';
  else if (score >= 30) verdict = 'oscillating';
  else verdict = 'diverging';

  return { score: Math.round(score), verdict };
}

// ─── Main ─────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): ConvArgs {
  const args: ConvArgs = { mode: 'all', quiet: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--stability') args.mode = 'stability';
    else if (arg === '--improvement') args.mode = 'improvement';
    else if (arg === '--divergence') args.mode = 'divergence';
    else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--dry-run') args.dryRun = true;
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv);
  const log = getLogger(args.quiet);

  log('[CONVERGENCE-MONITOR] Starting...');
  log('═'.repeat(50));

  const config = loadJson<typeof DEFAULT_CONFIG>(CONV_CONFIG, DEFAULT_CONFIG);
  const outputDir = join(ROOT, config.outputDir);
  ensureDir(outputDir);

  // 1. Collect data from all previous stages
  log('Collecting data from all stages...');
  const configChanges = collectConfigChanges(log);
  const reflections = collectReflections();
  log(`  Reflections: ${reflections.length}`);
  const metricsPoints = getMetricsHistory(log);

  // 2. Track decision stability
  let stabilityMetrics: StabilityMetric[] = [];
  if (args.mode === 'all' || args.mode === 'stability') {
    log('─'.repeat(30));
    log('Tracking decision stability...');
    stabilityMetrics = trackDecisionStability(configChanges, reflections, config, log);
    for (const m of stabilityMetrics) {
      const icon =
        { improving: '📈', stable: '✅', oscillating: '🔄', degrading: '📉' }[m.trend] || '❓';
      log(
        `  ${icon} ${m.component}: ${m.totalChanges} changes, score=${m.stabilityScore}, ${m.trend}`,
      );
    }
  }

  // 3. Measure improvement rate
  let improvementTrend: ImprovementTrend | null = null;
  if (args.mode === 'all' || args.mode === 'improvement') {
    log('─'.repeat(30));
    log('Measuring improvement rate...');
    improvementTrend = measureImprovementRate(metricsPoints, config);
    if (improvementTrend) {
      log(`  Direction: ${improvementTrend.direction}`);
      log(`  Slope: ${improvementTrend.slope}`);
      log(`  Confidence: ${(improvementTrend.confidence * 100).toFixed(0)}%`);
      log(`  ${improvementTrend.description}`);
    }
  }

  // 4. Alert on divergence
  let divergenceSignals: DivergenceSignal[] = [];
  if (args.mode === 'all' || args.mode === 'divergence') {
    log('─'.repeat(30));
    log('Checking for divergence...');
    divergenceSignals = alertOnDivergence(
      stabilityMetrics,
      improvementTrend,
      reflections,
      config,
      log,
    );
    for (const s of divergenceSignals) {
      const icon = { critical: '🔴', warning: '🟡', info: '🔵' }[s.severity] || '⚪';
      log(`  ${icon} [${s.severity}] ${s.signal} (score: ${(s.score * 100).toFixed(0)}%)`);
    }
    if (divergenceSignals.length === 0) {
      log('  ✅ No divergence detected');
    }
  }

  // 5. Overall score and verdict
  log('─'.repeat(30));
  const { score, verdict } = computeOverallScore(
    stabilityMetrics,
    improvementTrend,
    divergenceSignals,
  );
  log(`Overall convergence score: ${score}/100`);
  const verdictIcons: Record<string, string> = {
    converging: '🚀',
    stable: '✅',
    oscillating: '🔄',
    diverging: '🔴',
  };
  log(`Verdict: ${verdictIcons[verdict] || '❓'} ${verdict}`);

  // 6. Assemble output
  const stableComps = stabilityMetrics.filter((m) => m.isStable).length;
  const oscComps = stabilityMetrics.filter((m) => m.trend === 'oscillating').length;
  const degComps = stabilityMetrics.filter((m) => m.trend === 'degrading').length;

  const output: ConvOutput = {
    timestamp: now(),
    stabilityMetrics,
    improvementTrend,
    divergenceSignals,
    overallScore: score,
    verdict,
    summary: {
      stableComponents: stableComps,
      oscillatingComponents: oscComps,
      degradingComponents: degComps,
      divergenceSignals: divergenceSignals.length,
      overallScore: score,
      verdict,
      sinceDate: new Date(Date.now() - config.decisionStability.windowDays * 86400000)
        .toISOString()
        .slice(0, 10),
    },
  };

  if (!args.dryRun) {
    const outFile = join(outputDir, `convergence-${now().slice(0, 10)}.json`);
    writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf-8');
    log(`[OK] Convergence report saved: ${outFile}`);
  }

  if (!args.quiet) {
    console.log(
      JSON.stringify({
        stability: stabilityMetrics.length,
        trend: improvementTrend?.direction || 'unknown',
        divergence: divergenceSignals.length,
        score,
        verdict,
      }),
    );
  }

  log('═'.repeat(50));
  log('[CONVERGENCE-MONITOR] Done');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
