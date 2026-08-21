#!/usr/bin/env node
/**
 * Predictive Resource Governor — anticipa carga, precarga recursos, ajusta budgets.
 *
 * Pasa de reactivo a predictivo:
 *   Historial → Patrones → Predicción → Acción Preventiva
 *
 * Flags:
 *   --analyze     Analyze usage patterns only
 *   --prewarm     Pre-warm resources based on predictions
 *   --adjust      Adjust token budget based on predictions (default: all)
 *   --quiet       Minimal output (pipeline mode)
 *   --dry-run     Preview without saving
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { runSync } from './core/run-command.js';
import { pathToFileURL } from 'url';

// ─── Types ────────────────────────────────────────────────────────────

interface GovArgs {
  mode: 'all' | 'analyze' | 'prewarm' | 'adjust';
  quiet: boolean;
  dryRun: boolean;
}

interface UsageRecord {
  date: string;
  hour: number;
  dayOfWeek: number;
  tokensUsed: number;
  sessionCount: number;
  avgDuration: number;
  corrections: number;
}

interface UsagePattern {
  type: 'hourly' | 'daily' | 'weekly' | 'trend';
  label: string;
  description: string;
  confidence: number;
  data: number[];
  recommendation: string;
}

interface PeakWindow {
  dayOfWeek: number;
  hourStart: number;
  hourEnd: number;
  intensity: number; // 0..1
  avgTokens: number;
  sampleCount: number;
}

interface PrewarmAction {
  resource: string;
  action: string;
  reason: string;
  estimatedImpact: string;
  priority: 'low' | 'medium' | 'high';
}

interface BudgetAdjustment {
  currentBudget: number;
  suggestedBudget: number;
  reason: string;
  multiplier: number;
  confidence: number;
  peakWindow: string;
}

interface GovOutput {
  timestamp: string;
  sessionCount: number;
  patterns: UsagePattern[];
  peakWindows: PeakWindow[];
  prewarmActions: PrewarmAction[];
  budgetAdjustment: BudgetAdjustment | null;
  summary: {
    totalSessions: number;
    avgTokensPerSession: number;
    peakHours: string;
    recommendedBudget: number;
    prewarmCount: number;
    confidence: number;
  };
}

// ─── Constants ────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const SESSION_DIR = join(ROOT, '.session');
const AUDIT_DIR = join(SESSION_DIR, 'audit', 'logs');
const METRICS_FILE = join(SESSION_DIR, 'metrics-report.json');
const TOKEN_USAGE_FILE = join(SESSION_DIR, 'token-usage.json');
const TOKEN_BUDGET_FILE = join(ROOT, '.session', 'token-budget.json');
const GOV_DIR = join(SESSION_DIR, 'governor');
const GOV_CONFIG = join(ROOT, 'config', 'predictive-governor.json');
const CODE_GRAPH_DIR = join(ROOT, '.codegraph');

const DEFAULT_CONFIG = {
  prediction: {
    windowDays: 14,
    minDataPoints: 5,
    seasonalityDetection: true,
    trendDetection: true,
    anomalyThreshold: 2.5,
  },
  prewarming: {
    enabled: true,
    codegraphPrefetchThreshold: 0.7,
    knowledgeBasePrefetch: false,
    leadMinutes: 15,
  },
  budgetAdjustment: {
    enabled: true,
    maxIncreasePct: 30,
    maxDecreasePct: 20,
    peakMultiplier: 1.3,
    offPeakMultiplier: 0.8,
    floorTokens: 5000,
    ceilingTokens: 200000,
  },
  outputDir: GOV_DIR,
};

// ─── Helpers ──────────────────────────────────────────────────────────

function loadJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function loadJsonLines(path: string): Record<string, unknown>[] {
  try {
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Record<string, unknown>[];
  } catch {
    return [];
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

function currentHour(): number {
  return new Date().getHours();
}

function currentDayOfWeek(): number {
  return new Date().getDay();
}

// ─── Data Collection ──────────────────────────────────────────────────

type LogFn = (msg: string) => void;

function collectUsageHistory(log: LogFn): UsageRecord[] {
  const records: UsageRecord[] = [];

  // Source 1: Audit logs — session starts/ends give us timing patterns
  if (existsSync(AUDIT_DIR)) {
    const files = readdirSync(AUDIT_DIR)
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .slice(-20);
    const sessionStarts = new Map<string, number>();
    const sessionEnds = new Map<string, number>();

    for (const f of files) {
      const entries = loadJsonLines(join(AUDIT_DIR, f));
      for (const e of entries) {
        const id = (e.sessionId as string) || (e.id as string) || '';
        const type = (e.type as string) || '';
        const ts = (e.timestamp as string) || '';
        if (!id || !ts) continue;
        const dt = new Date(ts);
        if (isNaN(dt.getTime())) continue;

        if (type === 'session.start') {
          sessionStarts.set(id, dt.getTime());
        } else if (type === 'session.end') {
          sessionEnds.set(id, dt.getTime());
        }
      }
    }

    // Combine into records
    const allIds = new Set([...sessionStarts.keys(), ...sessionEnds.keys()]);
    for (const id of allIds) {
      const start = sessionStarts.get(id);
      const end = sessionEnds.get(id);
      const ts = start || end || Date.now();
      const dt = new Date(ts);
      const duration = start && end ? Math.round((end - start) / 1000) : 0;

      records.push({
        date: dt.toISOString().slice(0, 10),
        hour: dt.getHours(),
        dayOfWeek: dt.getDay(),
        tokensUsed: 0, // filled from token source
        sessionCount: 1,
        avgDuration: duration,
        corrections: 0,
      });
    }
  }

  // Source 2: Token usage data
  const tokenUsage = loadJson<Record<string, unknown>>(TOKEN_USAGE_FILE, {});
  if (tokenUsage.totalTokens) {
    const tokens = (tokenUsage.totalTokens as number) || 0;
    if (records.length > 0) {
      // Distribute tokens across records (estimate)
      const perSession = Math.round(tokens / Math.max(records.length, 1));
      for (const r of records) r.tokensUsed = perSession;
    } else {
      // Create a synthetic record for today
      const now_ = new Date();
      records.push({
        date: now().slice(0, 10),
        hour: now_.getHours(),
        dayOfWeek: now_.getDay(),
        tokensUsed: tokens,
        sessionCount: 1,
        avgDuration: 0,
        corrections: 0,
      });
    }
  }

  // Source 3: Metrics for corrections data
  const metrics = loadJson<Record<string, unknown>>(METRICS_FILE, {});
  const summary = (metrics.summary as Record<string, unknown>) || {};
  const corrections = (summary.total_corrections as number) || 0;
  if (corrections > 0 && records.length > 0) {
    const perSession = Math.round(corrections / Math.max(records.length, 1));
    for (const r of records) r.corrections = perSession;
  }

  log(`  Usage records: ${records.length}`);
  return records;
}

function getCurrentTokenBudget(): { limit: number; used: number; remaining: number } {
  const budget = loadJson<Record<string, unknown>>(TOKEN_BUDGET_FILE, {});
  const limit = (budget.limit as number) || 120000;
  const used = (budget.used as number) || 0;
  return { limit, used, remaining: limit - used };
}

function getCodegraphAge(): number | null {
  const indexPath = join(CODE_GRAPH_DIR, 'codegraph.db');
  if (!existsSync(indexPath)) return null;
  try {
    const stat = runSync(
      'powershell',
      ['-Command', `(Get-Item '${indexPath}').LastWriteTime.ToString('o')`],
      { cwd: ROOT, timeout: 5000 },
    ).stdout.trim();
    const mtime = new Date(stat).getTime();
    return Math.round((Date.now() - mtime) / 60000); // age in minutes
  } catch {
    return null;
  }
}

// ─── Pattern Analysis ─────────────────────────────────────────────────

function analyzeUsagePatterns(
  records: UsageRecord[],
  config: typeof DEFAULT_CONFIG,
): { patterns: UsagePattern[]; peakWindows: PeakWindow[] } {
  const patterns: UsagePattern[] = [];
  const windowDays = config.prediction.windowDays;
  const minPoints = config.prediction.minDataPoints;

  if (records.length < minPoints) {
    patterns.push({
      type: 'trend',
      label: 'Insufficient Data',
      description: `Only ${records.length} records (need ${minPoints}). Patterns will improve with more sessions.`,
      confidence: 0,
      data: [],
      recommendation: 'Continue collecting session data for accurate predictions',
    });
    return { patterns, peakWindows: [] };
  }

  // ── Hourly distribution ──
  const hourlyTokens = new Array(24).fill(0);
  const hourlySessions = new Array(24).fill(0);
  for (const r of records) {
    hourlyTokens[r.hour] += r.tokensUsed;
    hourlySessions[r.hour] += r.sessionCount;
  }

  const maxHourlyTokens = Math.max(...hourlyTokens, 1);
  const peakHours: number[] = [];
  for (let h = 0; h < 24; h++) {
    if (hourlyTokens[h] > maxHourlyTokens * 0.6) peakHours.push(h);
  }

  patterns.push({
    type: 'hourly',
    label: 'Hourly Token Distribution',
    description:
      peakHours.length > 0
        ? `Peak usage hours: ${peakHours.map((h) => `${h}:00`).join(', ')}`
        : 'No clear peak hours detected',
    confidence: Math.min(records.length / (windowDays * 2), 0.9),
    data: hourlyTokens,
    recommendation:
      peakHours.length > 0
        ? `Schedule prewarming 15min before peak: ${peakHours[0]}:00`
        : 'Monitor for emerging peak patterns',
  });

  // ── Daily distribution (day of week) ──
  const dailyTokens = new Array(7).fill(0);
  const dailySessions = new Array(7).fill(0);
  for (const r of records) {
    dailyTokens[r.dayOfWeek] += r.tokensUsed;
    dailySessions[r.dayOfWeek] += r.sessionCount;
  }

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const maxDailyTokens = Math.max(...dailyTokens, 1);
  const peakDays: number[] = [];
  for (let d = 0; d < 7; d++) {
    if (dailyTokens[d] > maxDailyTokens * 0.6) peakDays.push(d);
  }

  patterns.push({
    type: 'daily',
    label: 'Day-of-Week Distribution',
    description:
      peakDays.length > 0
        ? `Peak days: ${peakDays.map((d) => dayNames[d]).join(', ')}`
        : 'Usage evenly distributed across week',
    confidence: Math.min(records.length / (windowDays * 2), 0.85),
    data: dailyTokens,
    recommendation:
      peakDays.length > 0
        ? `Increase budget on ${peakDays.map((d) => dayNames[d]).join(', ')}`
        : 'Standard daily budget adequate',
  });

  // ── Trend detection ──
  if (records.length >= 5 && config.prediction.trendDetection) {
    const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
    const firstHalf = sorted.slice(0, Math.floor(sorted.length / 2));
    const secondHalf = sorted.slice(-Math.floor(sorted.length / 2));

    const firstAvg =
      firstHalf.reduce((s, r) => s + r.tokensUsed, 0) / Math.max(firstHalf.length, 1);
    const secondAvg =
      secondHalf.reduce((s, r) => s + r.tokensUsed, 0) / Math.max(secondHalf.length, 1);

    let trendLabel = 'Stable';
    let trendRec = 'Usage patterns are stable — maintain current configuration';
    if (secondAvg > firstAvg * 1.2) {
      trendLabel = 'Growing';
      trendRec = 'Usage is increasing — consider raising daily budget ceiling';
    } else if (secondAvg < firstAvg * 0.8) {
      trendLabel = 'Declining';
      trendRec = 'Usage is decreasing — may have room to optimize costs';
    }

    patterns.push({
      type: 'trend',
      label: `Token Usage Trend: ${trendLabel}`,
      description: `First half avg: ${Math.round(firstAvg)}, Second half avg: ${Math.round(secondAvg)}`,
      confidence: Math.min(records.length / 10, 0.9),
      data: [firstAvg, secondAvg],
      recommendation: trendRec,
    });
  }

  // ── Build peak windows ──
  const peakWindows: PeakWindow[] = [];
  for (const d of peakDays.length > 0 ? peakDays : [0, 1, 2, 3, 4, 5, 6]) {
    const dayRecords = records.filter((r) => r.dayOfWeek === d);
    if (dayRecords.length < 2) continue;

    // Find peak hours for this day
    const dayHourlyTokens = new Array(24).fill(0);
    const dayHourlyCount = new Array(24).fill(0);
    for (const r of dayRecords) {
      dayHourlyTokens[r.hour] += r.tokensUsed;
      dayHourlyCount[r.hour] += r.sessionCount;
    }

    const maxDayTokens = Math.max(...dayHourlyTokens, 1);
    const highHours = dayHourlyTokens
      .map((t, h) => ({ hour: h, tokens: t, ratio: t / maxDayTokens }))
      .filter((x) => x.ratio > 0.5);

    if (highHours.length > 0) {
      const avgTokens = highHours.reduce((s, h) => s + h.tokens, 0) / highHours.length;
      peakWindows.push({
        dayOfWeek: d,
        hourStart: highHours[0].hour,
        hourEnd: highHours[highHours.length - 1].hour,
        intensity: highHours.reduce((s, h) => s + h.ratio, 0) / highHours.length,
        avgTokens: Math.round(avgTokens),
        sampleCount: dayRecords.length,
      });
    }
  }

  peakWindows.sort((a, b) => b.intensity - a.intensity);

  return { patterns, peakWindows };
}

// ─── Prewarming ────────────────────────────────────────────────────────

function generatePrewarmActions(
  peakWindows: PeakWindow[],
  codegraphAge: number | null,
  config: typeof DEFAULT_CONFIG,
): PrewarmAction[] {
  const actions: PrewarmAction[] = [];
  const nowHour = currentHour();
  const nowDay = currentDayOfWeek();

  if (!config.prewarming.enabled) return actions;

  // Check if we're approaching a peak window
  let approachingPeak = false;
  let nextPeakWindow: PeakWindow | null = null;

  for (const pw of peakWindows) {
    if (pw.dayOfWeek === nowDay) {
      // Check if peak is within lead time
      const leadMinutes = config.prewarming.leadMinutes;
      const minutesToPeak = pw.hourStart * 60 - nowHour * 60;
      if (minutesToPeak > 0 && minutesToPeak <= leadMinutes) {
        approachingPeak = true;
        nextPeakWindow = pw;
        break;
      }
    }
  }

  // Codegraph prewarming
  if (codegraphAge !== null && codegraphAge > 30) {
    const priority: 'low' | 'medium' | 'high' = approachingPeak ? 'high' : 'medium';
    actions.push({
      resource: 'codegraph',
      action: approachingPeak
        ? 'Pre-warm codegraph index before peak'
        : 'Codegraph index is stale — consider refresh',
      reason: approachingPeak
        ? `Codegraph is ${codegraphAge}min old and peak approaching (${nextPeakWindow ? `${nextPeakWindow.hourStart}:00` : 'soon'})`
        : `Codegraph index was last updated ${codegraphAge} minutes ago`,
      estimatedImpact: 'Reduce first-query latency during peak by 40-60%',
      priority,
    });
  }

  // Adaptive profile prewarming
  if (approachingPeak && nextPeakWindow) {
    actions.push({
      resource: 'adaptive-profile',
      action: 'Pre-activate optimization profile before peak',
      reason: `Peak window ${nextPeakWindow.hourStart}:00-${nextPeakWindow.hourEnd}:00 starting within ${config.prewarming.leadMinutes}min`,
      estimatedImpact: 'Optimize token usage during high-demand window',
      priority: 'high',
    });
  }

  // Token budget pre-adjustment
  if (approachingPeak) {
    actions.push({
      resource: 'token-budget',
      action: 'Increase token budget ahead of peak',
      reason: `Peak window detected — historically ${nextPeakWindow ? `${Math.round(nextPeakWindow.intensity * 100)}% intensity` : ''}`,
      estimatedImpact: 'Prevent soft/hard threshold hits during peak',
      priority: 'high',
    });
  }

  return actions;
}

// ─── Budget Adjustment ────────────────────────────────────────────────

function computeBudgetAdjustment(
  peakWindows: PeakWindow[],
  patterns: UsagePattern[],
  currentBudget: { limit: number; used: number; remaining: number },
  config: typeof DEFAULT_CONFIG,
): BudgetAdjustment | null {
  if (!config.budgetAdjustment.enabled) return null;

  const nowHour = currentHour();
  const nowDay = currentDayOfWeek();
  const ba = config.budgetAdjustment;

  // Determine if we're in a peak window
  let inPeak = false;
  let peakIntensity = 0;
  let peakLabel = 'off-peak';

  for (const pw of peakWindows) {
    if (pw.dayOfWeek === nowDay && nowHour >= pw.hourStart && nowHour < pw.hourEnd) {
      inPeak = true;
      peakIntensity = pw.intensity;
      peakLabel = `peak (${pw.hourStart}:00-${pw.hourEnd}:00)`;
      break;
    }
  }

  // Check if approaching peak
  let approachingPeak = false;
  for (const pw of peakWindows) {
    if (pw.dayOfWeek === nowDay) {
      const minutesToPeak = pw.hourStart * 60 - nowHour * 60;
      if (minutesToPeak > 0 && minutesToPeak <= config.prewarming.leadMinutes) {
        approachingPeak = true;
        peakIntensity = pw.intensity;
        peakLabel = `pre-peak (${pw.hourStart}:00 in ${minutesToPeak}min)`;
        break;
      }
    }
  }

  let multiplier: number;
  let reason: string;
  let confidence: number;

  if (inPeak || approachingPeak) {
    multiplier = ba.peakMultiplier;
    reason = inPeak
      ? `Currently in ${peakLabel} window — increasing budget by ${Math.round((multiplier - 1) * 100)}%`
      : `Approaching ${peakLabel} — pre-adjusting budget by ${Math.round((multiplier - 1) * 100)}%`;
    confidence = 0.6 + peakIntensity * 0.3;
  } else {
    // Off-peak — reduce to save tokens
    const trendPattern = patterns.find((p) => p.type === 'trend');
    const isDeclining = trendPattern?.label.includes('Declining');

    if (isDeclining && currentBudget.remaining > currentBudget.limit * 0.5) {
      multiplier = ba.offPeakMultiplier;
      reason = `Off-peak and usage declining — reducing budget by ${Math.round((1 - multiplier) * 100)}% to save tokens`;
      confidence = 0.7;
    } else {
      // Standard off-peak: slight reduction
      multiplier = 1.0;
      reason = 'Standard operating conditions — no adjustment needed';
      confidence = 0.5;
    }
  }

  const suggestedBudget = Math.round(currentBudget.limit * multiplier);
  const clampedBudget = Math.max(ba.floorTokens, Math.min(ba.ceilingTokens, suggestedBudget));

  // Only adjust if change is meaningful
  if (Math.abs(clampedBudget - currentBudget.limit) < 1000) {
    return null;
  }

  const actualMultiplier = clampedBudget / currentBudget.limit;

  return {
    currentBudget: currentBudget.limit,
    suggestedBudget: clampedBudget,
    reason,
    multiplier: Math.round(actualMultiplier * 100) / 100,
    confidence: Math.min(confidence, 0.95),
    peakWindow: peakLabel,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): GovArgs {
  const args: GovArgs = { mode: 'all', quiet: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--analyze') args.mode = 'analyze';
    else if (arg === '--prewarm') args.mode = 'prewarm';
    else if (arg === '--adjust') args.mode = 'adjust';
    else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--dry-run') args.dryRun = true;
  }
  return args;
}

// ─── Auto-Apply Integration ──────────────────────────────────────────

function triggerAutoApply(_confidence: number, budgetAdjustment: BudgetAdjustment | null): void {
  if (!budgetAdjustment) return;
  if (budgetAdjustment.confidence < 0.8) return;

  try {
    // Signal auto-apply-safe by creating a trigger file
    const triggerDir = join(ROOT, '.session', 'auto-apply');
    if (!existsSync(triggerDir)) mkdirSync(triggerDir, { recursive: true });

    const triggerFile = join(triggerDir, 'trigger-budget.json');
    writeFileSync(
      triggerFile,
      JSON.stringify(
        {
          source: 'predictive-governor',
          type: 'budget',
          confidence: budgetAdjustment.confidence,
          currentBudget: budgetAdjustment.currentBudget,
          suggestedBudget: budgetAdjustment.suggestedBudget,
          reason: budgetAdjustment.reason,
          timestamp: now(),
          autoApply: budgetAdjustment.confidence >= 0.8,
        },
        null,
        2,
      ),
      'utf-8',
    );
  } catch {
    // Non-critical — auto-apply-safe will pick it up next cycle
  }
}

function main(): void {
  const args = parseArgs(process.argv);
  const log = getLogger(args.quiet);

  log('[PREDICTIVE-GOVERNOR] Starting...');

  // 1. Load config
  const config = loadJson<typeof DEFAULT_CONFIG>(GOV_CONFIG, DEFAULT_CONFIG);
  const outputDir = join(ROOT, config.outputDir);
  ensureDir(outputDir);

  // 2. Collect data
  log('Collecting usage data...');
  const records = collectUsageHistory(log);
  const currentBudget = getCurrentTokenBudget();
  log(
    `  Current budget: ${currentBudget.limit}, used: ${currentBudget.used}, remaining: ${currentBudget.remaining}`,
  );

  const codegraphAge = getCodegraphAge();
  log(`  Codegraph age: ${codegraphAge !== null ? `${codegraphAge}min` : 'N/A'}`);

  // 3. Analyze patterns
  let patterns: UsagePattern[] = [];
  let peakWindows: PeakWindow[] = [];
  if (args.mode === 'all' || args.mode === 'analyze') {
    log('Analyzing usage patterns...');
    const analysis = analyzeUsagePatterns(records, config);
    patterns = analysis.patterns;
    peakWindows = analysis.peakWindows;
    log(`  Patterns: ${patterns.length}, Peak windows: ${peakWindows.length}`);
    for (const p of patterns) {
      log(`    ${p.label} (conf: ${(p.confidence * 100).toFixed(0)}%)`);
    }
    for (const pw of peakWindows.slice(0, 3)) {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      log(
        `    ${dayNames[pw.dayOfWeek]} ${pw.hourStart}:00-${pw.hourEnd}:00 (intensity: ${(pw.intensity * 100).toFixed(0)}%)`,
      );
    }
  }

  // 4. Generate prewarm actions
  let prewarmActions: PrewarmAction[] = [];
  if (args.mode === 'all' || args.mode === 'prewarm') {
    log('Generating prewarm actions...');
    prewarmActions = generatePrewarmActions(peakWindows, codegraphAge, config);
    log(`  Prewarm actions: ${prewarmActions.length}`);
    for (const a of prewarmActions) {
      log(`    [${a.priority}] ${a.resource}: ${a.action}`);
    }
  }

  // 5. Compute budget adjustment
  let budgetAdjustment: BudgetAdjustment | null = null;
  if (args.mode === 'all' || args.mode === 'adjust') {
    log('Computing budget adjustment...');
    budgetAdjustment = computeBudgetAdjustment(peakWindows, patterns, currentBudget, config);
    if (budgetAdjustment) {
      log(
        `  Budget: ${budgetAdjustment.currentBudget} → ${budgetAdjustment.suggestedBudget} (${budgetAdjustment.reason})`,
      );
    } else {
      log('  No budget adjustment needed');
    }
  }

  // 6. Assemble output
  const output: GovOutput = {
    timestamp: now(),
    sessionCount: records.length,
    patterns,
    peakWindows,
    prewarmActions,
    budgetAdjustment,
    summary: {
      totalSessions: records.length,
      avgTokensPerSession:
        records.length > 0
          ? Math.round(records.reduce((s, r) => s + r.tokensUsed, 0) / records.length)
          : 0,
      peakHours:
        peakWindows.length > 0
          ? peakWindows
              .slice(0, 3)
              .map(
                (pw) =>
                  `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][pw.dayOfWeek]} ${pw.hourStart}:00`,
              )
              .join(', ')
          : 'Not yet determined',
      recommendedBudget: budgetAdjustment?.suggestedBudget || currentBudget.limit,
      prewarmCount: prewarmActions.length,
      confidence:
        patterns.length > 0
          ? Math.round((patterns.reduce((s, p) => s + p.confidence, 0) / patterns.length) * 100) /
            100
          : 0,
    },
  };

  // 7. Save & output
  if (!args.dryRun) {
    const outFile = join(outputDir, `governor-${now().slice(0, 10)}.json`);
    writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf-8');
    log(`[OK] Governor report saved: ${outFile}`);
  }

  // 8. Auto-apply signal
  if (budgetAdjustment && budgetAdjustment.confidence >= 0.8 && !args.dryRun) {
    triggerAutoApply(budgetAdjustment.confidence, budgetAdjustment);
    log(`  Auto-apply triggered (confidence: ${(budgetAdjustment.confidence * 100).toFixed(0)}%)`);
  }

  // Pipeline summary
  if (!args.quiet) {
    console.log(
      JSON.stringify({
        patterns: output.patterns.length,
        peakWindows: output.peakWindows.length,
        prewarmActions: output.prewarmActions.length,
        budgetAdjustment: output.budgetAdjustment
          ? `${output.budgetAdjustment.currentBudget}→${output.budgetAdjustment.suggestedBudget}`
          : 'none',
        confidence: output.summary.confidence,
      }),
    );
  }

  log('[PREDICTIVE-GOVERNOR] Done');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
