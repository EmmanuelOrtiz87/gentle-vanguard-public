#!/usr/bin/env node
/**
 * Self-Reflection Loop — Meta-cognitive layer for Gentle-Vanguard.
 *
 * Reads operational data (.session/, audit logs, git history, checkpoints, metrics),
 * identifies patterns, generates insights, and suggests improvements.
 *
 * The loop closes the meta-cognitive gap:
 *   Executar → Observar → Medir → Reflexionar → Decidir → Adaptar
 *
 * Flags:
 *   --dry-run   Preview insights without saving
 *   --auto      Auto-apply safe suggestions (config tweaks)
 *   --quiet     Minimal output (pipeline mode)
 *   --force     Force full reflection (ignore cache)
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { runSync } from '../core/run-command.js';
import { pathToFileURL } from 'url';
import { assertConfigIntegrity } from '../security/self-mutation-guard.js';

// ─── Types ────────────────────────────────────────────────────────────

interface ReflectionArgs {
  dryRun: boolean;
  autoApply: boolean;
  quiet: boolean;
  force: boolean;
}

interface SessionRecord {
  id: string;
  timestamp: string;
  type: 'session.start' | 'session.end';
  status: string;
  message: string;
  component: string;
  date: string; // YYYY-MM-DD
}

interface CorrectionRecord {
  timestamp: string;
  action: string;
  target?: string;
  error?: string;
  resolution?: string;
}

interface Pattern {
  id: string;
  type:
    | 'error_recurrence'
    | 'config_oscillation'
    | 'learning_repetition'
    | 'skill_usage_gap'
    | 'performance_trend'
    | 'token_trend'
    | 'correction_pattern'
    | 'session_stability';
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  frequency: number;
  evidence: string[];
  recommendation: string;
}

interface Insight {
  category: string;
  finding: string;
  impact: string;
  recommendation: string;
  confidence: number; // 0..1
}

interface Suggestion {
  target: string;
  change: string;
  current: string;
  proposed: string;
  reason: string;
  autoApplySafe: boolean;
}

interface ReflectionOutput {
  timestamp: string;
  sessionCount: number;
  dateRange: { from: string; to: string };
  patterns: Pattern[];
  insights: Insight[];
  suggestions: Suggestion[];
  appliedChanges: string[];
  qualityScore: number;
}

// ─── Constants ────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const SESSION_DIR = join(ROOT, '.session');
const AUDIT_DIR = join(SESSION_DIR, 'audit', 'logs');
const REFLECTIONS_DIR = join(SESSION_DIR, 'reflections');
const METRICS_FILE = join(SESSION_DIR, 'metrics-report.json');
const CORRECTIONS_LOG = join(SESSION_DIR, 'corrections-log.jsonl');
const CORRECTION_ENGINE_LOG = join(SESSION_DIR, 'correction-engine.log');
const CHECKPOINTS_DIR = join(SESSION_DIR, 'checkpoints');
const CONFIG_DIR = join(ROOT, 'config');
const PIPELINE_CONFIG = join(CONFIG_DIR, 'session-autostart.config.json');
const REFLECTION_CONFIG = join(CONFIG_DIR, 'self-reflection.json');

const DEFAULT_CONFIG = {
  minSessionsForTrend: 3,
  maxPatterns: 15,
  maxInsights: 10,
  maxSuggestions: 8,
  autoApplyThreshold: 0.8,
  outputDir: REFLECTIONS_DIR,
};

// ─── Helpers ──────────────────────────────────────────────────────────

function log(msg: string, quiet: boolean, level: string = 'INFO'): void {
  if (quiet && level === 'INFO') return;
  const prefix =
    level === 'WARN'
      ? '\x1b[33m[REFLECT]'
      : level === 'ERR'
        ? '\x1b[31m[REFLECT]'
        : '\x1b[36m[REFLECT]';
  console.log(`${prefix} ${msg}\x1b[0m`);
}

function loadJson<T>(path: string, fallback: T): T {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    /* fallback */
  }
  return fallback;
}

function readJsonLines(filePath: string): Record<string, unknown>[] {
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function getDateRange(logs: SessionRecord[]): { from: string; to: string } {
  const dates = logs
    .map((l) => l.date)
    .filter(Boolean)
    .sort();
  return { from: dates[0] || 'unknown', to: dates[dates.length - 1] || 'unknown' };
}

// ─── Data Collection ─────────────────────────────────────────────────

function readAuditSessions(): SessionRecord[] {
  if (!existsSync(AUDIT_DIR)) return [];
  const files = readdirSync(AUDIT_DIR).filter((f) => f.endsWith('.jsonl'));
  const sessions: SessionRecord[] = [];
  for (const file of files) {
    const entries = readJsonLines(join(AUDIT_DIR, file));
    for (const entry of entries) {
      const ts = (entry.timestamp as string) || '';
      sessions.push({
        id: (entry.id as string) || '',
        timestamp: ts,
        type: (entry.type as 'session.start' | 'session.end') || 'session.start',
        status: (entry.status as string) || '',
        message: (entry.message as string) || '',
        component: (entry.component as string) || '',
        date: ts.slice(0, 10),
      });
    }
  }
  return sessions;
}

function readCorrections(): CorrectionRecord[] {
  const entries = readJsonLines(CORRECTIONS_LOG);
  if (entries.length > 0) return entries as unknown as CorrectionRecord[];
  // Fallback: parse correction-engine.log
  if (!existsSync(CORRECTION_ENGINE_LOG)) return [];
  try {
    const raw = readFileSync(CORRECTION_ENGINE_LOG, 'utf-8');
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
        return { timestamp: m?.[1] || '', action: 'log', target: 'engine', error: line };
      });
  } catch {
    return [];
  }
}

function countCheckpoints(): number {
  if (!existsSync(CHECKPOINTS_DIR)) return 0;
  return readdirSync(CHECKPOINTS_DIR).filter((d) => d.startsWith('ckpt-')).length;
}

function getMetricsSummary(): Record<string, number> {
  const m = loadJson<Record<string, unknown>>(METRICS_FILE, {});
  const s = (m.summary as Record<string, number>) || {};
  return {
    delegations: (s.total_delegations as number) || 0,
    corrections: (s.total_corrections as number) || 0,
    qualityScore: (s.quality_score as number) || 100,
    uptimeSeconds: (s.uptime_seconds as number) || 0,
  };
}

function getGitHistory(days: number = 7): {
  commits: number;
  authors: string[];
  recentMessages: string[];
} {
  try {
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const log = runSync('git', ['log', `--since=${since}`, '--format=%an|%s'], {
      cwd: ROOT,
      timeout: 5000,
    }).stdout.trim();
    if (!log) return { commits: 0, authors: [], recentMessages: [] };
    const lines = log.split('\n').filter(Boolean);
    const authors = [...new Set(lines.map((l) => l.split('|')[0]))];
    const messages = lines.map((l) => l.split('|')[1]).filter(Boolean);
    return { commits: lines.length, authors, recentMessages: messages };
  } catch {
    return { commits: 0, authors: [], recentMessages: [] };
  }
}

// ─── Pattern Detection ────────────────────────────────────────────────

function detectPatterns(
  sessions: SessionRecord[],
  corrections: CorrectionRecord[],
  metrics: Record<string, number>,
  git: { commits: number; authors: string[]; recentMessages: string[] },
): Pattern[] {
  const patterns: Pattern[] = [];
  const now = new Date().toISOString();

  // 1. Session stability
  const starts = sessions.filter((s) => s.type === 'session.start');
  const ends = sessions.filter((s) => s.type === 'session.end');
  const openSessions = starts.length - ends.length;
  if (openSessions > 2) {
    patterns.push({
      id: `pat-${now}-session-accum`,
      type: 'session_stability',
      title: 'Open sessions accumulating',
      description: `${openSessions} sessions started but not ended — possible crash recovery pattern`,
      severity: 'warning',
      frequency: openSessions,
      evidence: [`${starts.length} starts vs ${ends.length} ends`],
      recommendation:
        'Review session-cleanup-start.ts for crash handling; consider forced cleanup threshold',
    });
  }

  // 2. Daily session frequency
  const sessionsByDay = new Map<string, number>();
  for (const s of starts) {
    sessionsByDay.set(s.date, (sessionsByDay.get(s.date) || 0) + 1);
  }
  const maxSessionsPerDay = Math.max(...sessionsByDay.values(), 0);
  if (maxSessionsPerDay > 8) {
    const heavyDays = [...sessionsByDay.entries()].filter(([, c]) => c > 8).map(([d]) => d);
    patterns.push({
      id: `pat-${now}-high-session-freq`,
      type: 'session_stability',
      title: 'High session frequency detected',
      description: `${maxSessionsPerDay} sessions on peak day — possible inefficiency`,
      severity: 'warning',
      frequency: maxSessionsPerDay,
      evidence: [`Peak days: ${heavyDays.join(', ')}`],
      recommendation: 'Check if sessions are completing goals; consider larger session timeouts',
    });
  }

  // 3. Correction patterns
  if (corrections.length > 0) {
    const errorTypes = new Map<string, number>();
    for (const c of corrections) {
      const key = c.action || c.error?.slice(0, 50) || 'unknown';
      errorTypes.set(key, (errorTypes.get(key) || 0) + 1);
    }
    const topErrors = [...errorTypes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (topErrors.length > 0 && topErrors[0][1] >= 2) {
      patterns.push({
        id: `pat-${now}-recurring-errors`,
        type: 'correction_pattern',
        title: `Recurring corrections: ${topErrors[0][0].slice(0, 40)}`,
        description: `"${topErrors[0][0].slice(0, 60)}" appeared ${topErrors[0][1]} times`,
        severity: topErrors[0][1] > 5 ? 'critical' : 'warning',
        frequency: topErrors[0][1],
        evidence: topErrors.map(([e, c]) => `${e} (${c}x)`),
        recommendation: 'Add auto-correction rule or fix root cause via watchtower remediation',
      });
    }
  }

  // 4. Git activity trend
  if (git.commits === 0) {
    patterns.push({
      id: `pat-${now}-no-git-activity`,
      type: 'performance_trend',
      title: 'No commits in last 7 days',
      description: 'Zero git activity detected — possible idle period or uncommitted work',
      severity: 'info',
      frequency: 1,
      evidence: ['git log --since=7 days returns empty'],
      recommendation: 'Review uncommitted changes; consider auto-commit for non-critical files',
    });
  } else if (git.authors.length > 1) {
    patterns.push({
      id: `pat-${now}-multi-author`,
      type: 'performance_trend',
      title: `Multi-author activity: ${git.authors.join(', ')}`,
      description: `${git.commits} commits by ${git.authors.length} authors in 7 days`,
      severity: 'info',
      frequency: git.authors.length,
      evidence: [`${git.commits} commits`, `Authors: ${git.authors.join(', ')}`],
      recommendation: 'Ensure consistent merge strategy across authors',
    });
  }

  // 5. Quality score trend
  if (metrics.qualityScore < 80) {
    patterns.push({
      id: `pat-${now}-quality-drop`,
      type: 'performance_trend',
      title: 'Quality score below threshold',
      description: `Current quality score: ${metrics.qualityScore}/100`,
      severity: 'critical',
      frequency: 100 - metrics.qualityScore,
      evidence: [`Score: ${metrics.qualityScore}`, `Corrections: ${metrics.corrections}`],
      recommendation: 'Run watchtower autoheal; review recent changes for regression',
    });
  }

  return patterns;
}

// ─── Insight Generation ──────────────────────────────────────────────

function generateInsights(
  patterns: Pattern[],
  sessions: SessionRecord[],
  metrics: Record<string, number>,
): Insight[] {
  const insights: Insight[] = [];

  // Insight 1: Session consistency
  const starts = sessions.filter((s) => s.type === 'session.start').length;
  if (starts > 0) {
    insights.push({
      category: 'session',
      finding: `Total sessions observed: ${starts}`,
      impact: 'Base de referencia para métricas de continuidad',
      recommendation:
        starts > 20 ? 'Alta actividad — evaluar necesidad de consolidation' : 'Actividad normal',
      confidence: 1.0,
    });
  }

  // Insight 2: Correction density
  if (metrics.corrections > 0) {
    const density = metrics.corrections / Math.max(starts, 1);
    insights.push({
      category: 'quality',
      finding: `Correction density: ${density.toFixed(2)} per session`,
      impact:
        density > 0.5 ? 'Alta tasa de correcciones — posible deuda técnica' : 'Baja tasa — estable',
      recommendation:
        density > 0.5
          ? 'Revisar patrones de error recurrentes; fortalecer auto-correction rules'
          : 'Mantener tendencia actual',
      confidence: 0.85,
    });
  }

  // Insight 3: Checkpoint coverage
  const checkpointCount = countCheckpoints();
  if (checkpointCount > 0) {
    insights.push({
      category: 'resilience',
      finding: `${checkpointCount} checkpoint(s) created`,
      impact: 'Capacidad de rollback disponible',
      recommendation:
        checkpointCount < 2 ? 'Considerar checkpoints más frecuentes' : 'Cobertura adecuada',
      confidence: 0.9,
    });
  }

  // Insight 4: Pattern-driven insights
  const criticalPatterns = patterns.filter((p) => p.severity === 'critical');
  if (criticalPatterns.length > 0) {
    insights.push({
      category: 'risk',
      finding: `${criticalPatterns.length} critical pattern(s) detected`,
      impact: 'Riesgo operativo identificado',
      recommendation: `Priorizar: ${criticalPatterns.map((p) => p.title).join('; ')}`,
      confidence: 0.95,
    });
  }

  // Insight 5: General health
  if (metrics.qualityScore >= 90) {
    insights.push({
      category: 'health',
      finding: `Score de calidad: ${metrics.qualityScore}/100`,
      impact: 'Stack saludable',
      recommendation: 'Continuar monitoreo preventivo',
      confidence: 0.9,
    });
  }

  return insights;
}

// ─── Suggestion Engine ────────────────────────────────────────────────

function generateSuggestions(patterns: Pattern[], _insights: Insight[]): Suggestion[] {
  const suggestions: Suggestion[] = [];

  for (const pattern of patterns) {
    if (pattern.severity === 'critical') {
      suggestions.push({
        target: 'watchtower',
        change: `Add auto-remediation rule for: ${pattern.title}`,
        current: 'No rule configured',
        proposed: `watchtower autoheal step for "${pattern.type}"`,
        reason: pattern.recommendation,
        autoApplySafe: false,
      });
    }
  }

  // Suggestion: enable reflection step if not in pipeline
  if (existsSync(PIPELINE_CONFIG)) {
    try {
      const config = JSON.parse(readFileSync(PIPELINE_CONFIG, 'utf-8')) as {
        pipeline?: { steps?: Array<{ id: string }> };
      };
      const hasReflection = config?.pipeline?.steps?.some((s) => s.id === 'self-reflection');
      if (!hasReflection) {
        suggestions.push({
          target: 'config/session-autostart.config.json',
          change: 'Add self-reflection step to pipeline',
          current: 'Step "self-reflection" not found in pipeline',
          proposed: 'Add lazy step with script src/self-reflection-loop.ts',
          reason: 'Close the meta-cognitive loop — stack learns from its own operation',
          autoApplySafe: true,
        });
      }
    } catch {
      /* skip */
    }
  }

  // Suggestion: adjustment based on session frequency
  const highFreqPattern = patterns.find(
    (p) => p.type === 'session_stability' && p.title.includes('High session'),
  );
  if (highFreqPattern) {
    suggestions.push({
      target: 'config/session-autostart.config.json',
      change: 'Increase session timeout',
      current: 'sessionExpiryHours: 8',
      proposed: 'sessionExpiryHours: 12',
      reason: 'High session frequency suggests sessions are too short',
      autoApplySafe: true,
    });
  }

  return suggestions;
}

// ─── Apply Changes ────────────────────────────────────────────────────

function applySafeSuggestions(suggestions: Suggestion[], quiet: boolean): string[] {
  const applied: string[] = [];
  const safeSuggestions = suggestions.filter((s) => s.autoApplySafe);

  for (const s of safeSuggestions) {
    if (
      s.target === 'config/session-autostart.config.json' &&
      s.change.includes('self-reflection')
    ) {
      try {
        const raw = readFileSync(PIPELINE_CONFIG, 'utf-8');
        const config = JSON.parse(raw) as {
          pipeline?: {
            steps?: Array<Record<string, unknown>>;
            onStepFailure?: string;
            requiredStepFailureAction?: string;
          };
        };

        // Check if step already exists
        const steps = config.pipeline?.steps || [];
        const exists = steps.some((st) => st.id === 'self-reflection');
        if (!exists) {
          steps.push({
            id: 'self-reflection',
            enabled: true,
            lazy: true,
            script: 'src/self-reflection-loop.ts',
            args: '--quiet',
            required: false,
            phase: 99,
            description:
              'Self-reflection loop — analyze patterns, generate insights, suggest improvements',
          });
          writeFileSync(PIPELINE_CONFIG, JSON.stringify(config, null, 2) + '\n', 'utf-8');
          // M7: verify the written config is still valid JSON + schema before
          // accepting the mutation. If the write corrupted the file, the guard
          // reports it so the change is flagged instead of silently breaking
          // the pipeline on next session.
          try {
            assertConfigIntegrity('config/session-autostart.config.json');
          } catch (guardErr) {
            log(
              `M7 guard FAILED after self-mutation: ${
                guardErr instanceof Error ? guardErr.message : String(guardErr)
              }`,
              quiet,
              'ERR',
            );
          }
          applied.push(`Added self-reflection step to ${s.target}`);
          log(`Applied: ${s.change}`, quiet, 'OK');
        }
      } catch (e) {
        log(
          `Failed to apply: ${s.change} — ${e instanceof Error ? e.message : String(e)}`,
          quiet,
          'ERR',
        );
      }
    }
  }

  return applied;
}

// ─── Quality Score ────────────────────────────────────────────────────

function computeQualityScore(metrics: Record<string, number>, patterns: Pattern[]): number {
  let score = metrics.qualityScore || 100;
  for (const p of patterns) {
    if (p.severity === 'critical') score -= 15;
    else if (p.severity === 'warning') score -= 5;
  }
  return Math.max(0, Math.min(100, score));
}

// ─── Save Reflection ──────────────────────────────────────────────────

function saveReflection(output: ReflectionOutput): void {
  if (!existsSync(REFLECTIONS_DIR)) mkdirSync(REFLECTIONS_DIR, { recursive: true });
  const filePath = join(
    REFLECTIONS_DIR,
    `reflection-${output.timestamp.replace(/[:.]/g, '-').slice(0, 19)}.json`,
  );
  writeFileSync(filePath, JSON.stringify(output, null, 2), 'utf-8');
}

// ─── Report ───────────────────────────────────────────────────────────

function printReport(output: ReflectionOutput, quiet: boolean): void {
  if (quiet) {
    console.log(
      JSON.stringify({
        patterns: output.patterns.length,
        insights: output.insights.length,
        suggestions: output.suggestions.length,
        applied: output.appliedChanges.length,
        qualityScore: output.qualityScore,
      }),
    );
    return;
  }

  const colors = {
    critical: '\x1b[31m',
    warning: '\x1b[33m',
    info: '\x1b[36m',
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
  };

  console.log(`\n${colors.bold}=== SELF-REFLECTION REPORT ===${colors.reset}`);
  console.log(
    `${colors.dim}${output.timestamp} | Sessions: ${output.sessionCount} (${output.dateRange.from} → ${output.dateRange.to})${colors.reset}`,
  );
  console.log(
    `Quality Score: ${output.qualityScore >= 80 ? '\x1b[32m' : output.qualityScore >= 60 ? '\x1b[33m' : '\x1b[31m'}${output.qualityScore}/100${colors.reset}\n`,
  );

  if (output.patterns.length > 0) {
    console.log(`${colors.bold}📊 Patterns Detected (${output.patterns.length}):${colors.reset}`);
    for (const p of output.patterns) {
      const c = colors[p.severity] || colors.info;
      console.log(`  ${c}[${p.severity.toUpperCase()}]${colors.reset} ${p.title}`);
      console.log(`         ${p.description}`);
      console.log(`         ${colors.dim}Recommendation: ${p.recommendation}${colors.reset}`);
    }
    console.log();
  }

  if (output.insights.length > 0) {
    console.log(`${colors.bold}💡 Insights (${output.insights.length}):${colors.reset}`);
    for (const ins of output.insights) {
      console.log(`  [${ins.category}] ${ins.finding}`);
      console.log(`         ${colors.dim}→ ${ins.recommendation}${colors.reset}`);
    }
    console.log();
  }

  if (output.suggestions.length > 0) {
    console.log(`${colors.bold}🔧 Suggestions (${output.suggestions.length}):${colors.reset}`);
    for (const s of output.suggestions) {
      console.log(`  ${s.autoApplySafe ? '✅' : '⚠️'} [${s.target}] ${s.change}`);
      console.log(`     ${colors.dim}Reason: ${s.reason}${colors.reset}`);
      console.log(
        `     ${colors.dim}Current → Proposed: "${s.current}" → "${s.proposed}"${colors.reset}`,
      );
    }
    console.log();
  }

  if (output.appliedChanges.length > 0) {
    console.log(
      `${colors.bold}✅ Applied Changes (${output.appliedChanges.length}):${colors.reset}`,
    );
    for (const a of output.appliedChanges) {
      console.log(`  ✔ ${a}`);
    }
    console.log();
  }

  console.log(`${colors.dim}${'─'.repeat(50)}${colors.reset}`);
}

// ─── Main ─────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): ReflectionArgs {
  return {
    dryRun: argv.includes('--dry-run'),
    autoApply: argv.includes('--auto'),
    quiet: argv.includes('--quiet'),
    force: argv.includes('--force'),
  };
}

function main(): void {
  const args = parseArgs(process.argv);
  const ts = new Date().toISOString();

  log(`Starting self-reflection loop...`, args.quiet);

  // 1. Load configuration
  const config = loadJson(REFLECTION_CONFIG, DEFAULT_CONFIG);

  // 2. Collect data
  log(`Collecting data...`, args.quiet);
  const sessions = readAuditSessions();
  const corrections = readCorrections();
  const metrics = getMetricsSummary();
  const git = getGitHistory(7);
  log(`  Sessions: ${sessions.length}, Corrections: ${corrections.length}`, args.quiet);

  // 3. Detect patterns
  log(`Analyzing patterns...`, args.quiet);
  const patterns = detectPatterns(sessions, corrections, metrics, git);
  const topPatterns = patterns.slice(0, config.maxPatterns);
  log(`  Patterns detected: ${topPatterns.length}`, args.quiet);

  // 4. Generate insights
  log(`Generating insights...`, args.quiet);
  const insights = generateInsights(topPatterns, sessions, metrics).slice(0, config.maxInsights);
  log(`  Insights generated: ${insights.length}`, args.quiet);

  // 5. Generate suggestions
  log(`Generating suggestions...`, args.quiet);
  const suggestions = generateSuggestions(topPatterns, insights).slice(0, config.maxSuggestions);
  log(`  Suggestions generated: ${suggestions.length}`, args.quiet);

  // 6. Apply safe changes (unless dry-run)
  let appliedChanges: string[] = [];
  if (!args.dryRun && args.autoApply) {
    log(`Applying safe suggestions...`, args.quiet);
    appliedChanges = applySafeSuggestions(suggestions, args.quiet);
  }

  // 7. Build output
  const qualityScore = computeQualityScore(metrics, topPatterns);
  const output: ReflectionOutput = {
    timestamp: ts,
    sessionCount: sessions.length,
    dateRange: getDateRange(sessions),
    patterns: topPatterns,
    insights,
    suggestions,
    appliedChanges,
    qualityScore,
  };

  // 8. Save (unless dry-run)
  if (!args.dryRun) {
    saveReflection(output);
    log(`Reflection saved to ${REFLECTIONS_DIR}`, args.quiet);
  } else {
    log(`Dry-run mode — nothing saved or applied`, args.quiet);
  }

  // 9. Print report
  printReport(output, args.quiet);

  // 10. Exit with status
  const hasCritical = topPatterns.some((p) => p.severity === 'critical');
  if (hasCritical) {
    log(`Critical patterns found — consider running watchtower autoheal`, args.quiet, 'WARN');
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
