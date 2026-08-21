#!/usr/bin/env node
/**
 * Proactive Intelligence Engine
 *
 * Anticipates user needs based on:
 *   - Usage patterns from session history
 *   - Time-of-day patterns
 *   - Project context
 *   - Recent activity
 *   - Learned norms
 *
 * Generates contextual suggestions BEFORE user asks
 *
 * Usage:
 *   npx tsx src/proactive-intelligence-engine.ts [--analyze] [--suggest] [--apply]
 *
 * Integration:
 *   - session-autostart pipeline (lazy step)
 *   - Called before user input (pre-process-input.ts)
 *   - Stored in Nexus for dashboard visibility
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { runSync } from './core/run-command.js';

// ─── Types ────────────────────────────────────────────────────────────

interface UsagePattern {
  type: 'time_based' | 'file_based' | 'task_based' | 'sequence_based';
  id: string;
  description: string;
  confidence: number;
  occurrences: number;
  lastTriggered: string;
  triggers: string[];
  suggests: ProactiveSuggestion[];
}

interface ProactiveSuggestion {
  id: string;
  type: 'skill' | 'command' | 'context' | 'reminder' | 'action';
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  action: string;
  args?: Record<string, unknown>;
  confidence: number;
  rationale: string;
  autoApplyThreshold: number; // Confidence threshold for auto-apply
  requiresConfirmation: boolean;
  estimatedTokens: number;
}

interface SessionPattern {
  sessionId: string;
  timestamp: string;
  filesAccessed: string[];
  skillsUsed: string[];
  commandsExecuted: string[];
  taskType?: string;
  duration: number;
  success: boolean;
}

interface ContextSnapshot {
  timestamp: string;
  dayOfWeek: number;
  hour: number;
  activeFiles: string[];
  recentCommits: string[];
  branch: string;
  projectState: string;
  pendingTasks: string[];
}

interface AnticipationResult {
  timestamp: string;
  context: ContextSnapshot;
  patterns: UsagePattern[];
  suggestions: ProactiveSuggestion[];
  highConfidenceActions: ProactiveSuggestion[];
  metrics: {
    patternsAnalyzed: number;
    suggestionsGenerated: number;
    autoApplyCandidates: number;
    confidence: number;
  };
}

interface PIEConfig {
  enabled: boolean;
  minConfidence: number;
  maxSuggestions: number;
  autoApplyEnabled: boolean;
  autoApplyMinConfidence: number;
  retentionDays: number;
  analysisWindow: number;
  learningRate: number;
}

// ─── Constants ────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const SESSION_DIR = join(ROOT, '.session');
const CONTEXT_LOG_DIR = join(SESSION_DIR, 'context-log');
const PIE_DIR = join(SESSION_DIR, 'proactive-intelligence');
const PIE_CONFIG = join(ROOT, 'config', 'proactive-intelligence.json');
const PATTERNS_DB = join(PIE_DIR, 'patterns.json');
const SUGGESTIONS_DB = join(PIE_DIR, 'suggestions.json');

const DEFAULT_CONFIG: PIEConfig = {
  enabled: true,
  minConfidence: 0.5,
  maxSuggestions: 5,
  autoApplyEnabled: true,
  autoApplyMinConfidence: 0.85,
  retentionDays: 90,
  analysisWindow: 30,
  learningRate: 0.1,
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

function saveJson(path: string, data: unknown): void {
  try {
    const dir = path.split('/').slice(0, -1).join('/') || path.split('\\').slice(0, -1).join('\\');
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('[PIE] Failed to save:', e);
  }
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

function dayName(day: number): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day];
}

// ─── Pattern Recognition ──────────────────────────────────────────────

function analyzeTimePatterns(sessions: SessionPattern[]): UsagePattern[] {
  const patterns: UsagePattern[] = [];

  // Group by hour
  const hourFrequency = new Map<number, number>();
  const hourTasks = new Map<number, Map<string, number>>();

  for (const session of sessions) {
    const hour = new Date(session.timestamp).getHours();
    hourFrequency.set(hour, (hourFrequency.get(hour) || 0) + 1);

    if (!hourTasks.has(hour)) hourTasks.set(hour, new Map());
    const tasks = hourTasks.get(hour)!;
    const taskType = session.taskType || 'general';
    tasks.set(taskType, (tasks.get(taskType) || 0) + 1);
  }

  // Find peak hours
  const maxFreq = Math.max(...hourFrequency.values(), 1);
  for (const [hour, freq] of hourFrequency) {
    if (freq > maxFreq * 0.4) {
      const tasks = hourTasks.get(hour);
      const commonTask = tasks
        ? [...tasks.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'general'
        : 'general';

      patterns.push({
        type: 'time_based',
        id: `time-${hour}`,
        description: `Active hour: ${hour}:00 (frequency: ${freq})`,
        confidence: Math.min(freq / 5, 0.9),
        occurrences: freq,
        lastTriggered: now(),
        triggers: [`hour:${hour}`],
        suggests: [generateTimeSuggestion(hour, commonTask)],
      });
    }
  }

  return patterns;
}

function analyzeFilePatterns(sessions: SessionPattern[]): UsagePattern[] {
  const patterns: UsagePattern[] = [];
  const fileGroups = new Map<string, { count: number; files: Set<string> }>();

  for (const session of sessions) {
    const keyFiles = session.filesAccessed
      .filter((f) => f.includes('/src/') || f.includes('\\src\\'))
      .map((f) => f.replace(/\\/g, '/').split('/src/')[1]?.split('/')[0] || '')
      .filter(Boolean);

    for (const key of new Set(keyFiles)) {
      const existing = fileGroups.get(key);
      if (existing) {
        existing.count++;
        session.filesAccessed.forEach((f) => existing.files.add(f));
      } else {
        fileGroups.set(key, { count: 1, files: new Set(session.filesAccessed) });
      }
    }
  }

  for (const [key, data] of fileGroups) {
    if (data.count >= 3) {
      patterns.push({
        type: 'file_based',
        id: `files-${key}`,
        description: `Frequent work in: ${key} (${data.count} sessions)`,
        confidence: Math.min(data.count / 10, 0.85),
        occurrences: data.count,
        lastTriggered: now(),
        triggers: [`file_pattern:${key}`],
        suggests: [generateFileSuggestion(key, data.files)],
      });
    }
  }

  return patterns;
}

function analyzeSequencePatterns(sessions: SessionPattern[]): UsagePattern[] {
  const patterns: UsagePattern[] = [];

  // Find common skill sequences
  const sequences = new Map<string, { count: number; nextSkills: string[] }>();

  for (let i = 0; i < sessions.length - 1; i++) {
    const current = sessions[i];
    const next = sessions[i + 1];

    for (const skill of current.skillsUsed) {
      const key = `after:${skill}`;
      const existing = sequences.get(key);
      if (existing) {
        existing.count++;
        existing.nextSkills.push(...next.skillsUsed);
      } else {
        sequences.set(key, { count: 1, nextSkills: [...next.skillsUsed] });
      }
    }
  }

  for (const [key, data] of sequences) {
    if (data.count >= 2) {
      // Find most common next skill
      const skillCounts = new Map<string, number>();
      for (const skill of data.nextSkills) {
        skillCounts.set(skill, (skillCounts.get(skill) || 0) + 1);
      }
      const mostCommon = [...skillCounts.entries()].sort((a, b) => b[1] - a[1])[0];

      if (mostCommon && mostCommon[1] >= 2) {
        const prevSkill = key.replace('after:', '');
        patterns.push({
          type: 'sequence_based',
          id: `seq-${prevSkill}-${mostCommon[0]}`,
          description: `After "${prevSkill}" often uses "${mostCommon[0]}"`,
          confidence: Math.min(mostCommon[1] / data.count, 0.8),
          occurrences: mostCommon[1],
          lastTriggered: now(),
          triggers: [`skill:${prevSkill}`],
          suggests: [generateSequenceSuggestion(prevSkill, mostCommon[0])],
        });
      }
    }
  }

  return patterns;
}

// ─── Suggestion Generators ────────────────────────────────────────────

function generateTimeSuggestion(hour: number, taskType: string): ProactiveSuggestion {
  const hourLabel = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

  const suggestions: Record<string, ProactiveSuggestion> = {
    morning: {
      id: `suggest-morning-${hour}`,
      type: 'reminder',
      title: 'Good morning! Review overnight changes?',
      description: 'You typically check for updates in the morning.',
      priority: 'low',
      action: 'run_command',
      args: { command: 'git status && git log --oneline -5' },
      confidence: 0.6,
      rationale: 'Morning pattern detected',
      autoApplyThreshold: 0.9,
      requiresConfirmation: true,
      estimatedTokens: 800,
    },
    afternoon: {
      id: `suggest-afternoon-${hour}`,
      type: 'skill',
      title: 'Focus session?',
      description: 'Afternoon is your productive time. Start a deep work session?',
      priority: 'medium',
      action: 'load_skill',
      args: { skill: 'incremental-implementation', focus: 'deep' },
      confidence: 0.65,
      rationale: 'Afternoon productivity pattern',
      autoApplyThreshold: 0.85,
      requiresConfirmation: true,
      estimatedTokens: 1200,
    },
    evening: {
      id: `suggest-evening-${hour}`,
      type: 'action',
      title: 'Session summary?',
      description: "Would you like a summary of today's work?",
      priority: 'low',
      action: 'generate_digest',
      args: { type: 'daily' },
      confidence: 0.55,
      rationale: 'End-of-day pattern',
      autoApplyThreshold: 0.95,
      requiresConfirmation: true,
      estimatedTokens: 1500,
    },
    general: {
      id: `suggest-general-${hour}`,
      type: 'context',
      title: `Ready for ${hourLabel} tasks?`,
      description: `You often work on ${taskType} around this time.`,
      priority: 'low',
      action: 'preload_context',
      args: { context: taskType },
      confidence: 0.5,
      rationale: 'Time-based usage pattern',
      autoApplyThreshold: 0.9,
      requiresConfirmation: true,
      estimatedTokens: 500,
    },
  };

  return suggestions[taskType] || suggestions.general;
}

function generateFileSuggestion(key: string, files: Set<string>): ProactiveSuggestion {
  const fileList = [...files].slice(0, 5);

  return {
    id: `suggest-files-${key}`,
    type: 'context',
    title: `Working on ${key}?`,
    description: `You've been active in ${key}. Relevant files: ${fileList.join(', ')}`,
    priority: 'medium',
    action: 'suggest_files',
    args: { files: fileList },
    confidence: 0.7,
    rationale: 'Recent file access pattern',
    autoApplyThreshold: 0.8,
    requiresConfirmation: true,
    estimatedTokens: 600,
  };
}

function generateSequenceSuggestion(prevSkill: string, nextSkill: string): ProactiveSuggestion {
  return {
    id: `suggest-seq-${prevSkill}-${nextSkill}`,
    type: 'skill',
    title: `After ${prevSkill}...`,
    description: `You often use ${nextSkill} next. Load it now?`,
    priority: 'high',
    action: 'load_skill',
    args: { skill: nextSkill, previous: prevSkill },
    confidence: 0.75,
    rationale: 'Sequential usage pattern detected',
    autoApplyThreshold: 0.85,
    requiresConfirmation: false,
    estimatedTokens: 400,
  };
}

// ─── Context Analysis ─────────────────────────────────────────────────

function captureContext(): ContextSnapshot {
  let activeFiles: string[] = [];
  let branch = 'unknown';
  let recentCommits: string[] = [];

  try {
    // Get git info
    const gitStatus = runSync('git', ['status', '--porcelain'], { cwd: ROOT }).stdout;
    activeFiles = gitStatus
      .split('\n')
      .filter((l: string) => l.trim())
      .map((l: string) => l.slice(3));

    branch = runSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT }).stdout.trim();

    const gitLog = runSync('git', ['log', '--oneline', '-5'], { cwd: ROOT }).stdout;
    recentCommits = gitLog.split('\n').filter(Boolean);
  } catch {
    // Git not available or error
  }

  return {
    timestamp: now(),
    dayOfWeek: currentDayOfWeek(),
    hour: currentHour(),
    activeFiles,
    recentCommits,
    branch,
    projectState: activeFiles.length > 0 ? 'dirty' : 'clean',
    pendingTasks: [],
  };
}

// ─── Session Loader ───────────────────────────────────────────────────

function loadRecentSessions(days: number): SessionPattern[] {
  const sessions: SessionPattern[] = [];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  if (!existsSync(CONTEXT_LOG_DIR)) return sessions;

  try {
    const dirs = readdirSync(CONTEXT_LOG_DIR)
      .filter((d) => d.startsWith('session-'))
      .sort()
      .slice(-30); // Last 30 sessions

    for (const dir of dirs) {
      const statePath = join(CONTEXT_LOG_DIR, dir, '.state.json');
      if (existsSync(statePath)) {
        const state = loadJson<{
          sessionId: string;
          startTime: string;
          filesRead?: string[];
          filesModified?: string[];
          skillsInvoked?: string[];
        } | null>(statePath, null);

        if (state && new Date(state.startTime).getTime() > cutoff) {
          sessions.push({
            sessionId: state.sessionId,
            timestamp: state.startTime,
            filesAccessed: [...(state.filesRead || []), ...(state.filesModified || [])],
            skillsUsed: state.skillsInvoked || [],
            commandsExecuted: [],
            taskType: inferTaskType(state.filesRead || []),
            duration: 0,
            success: true,
          });
        }
      }
    }
  } catch (e) {
    console.error('[PIE] Error loading sessions:', e);
  }

  return sessions;
}

function inferTaskType(files: string[]): string {
  if (files.some((f) => f.includes('test') || f.includes('spec'))) return 'testing';
  if (files.some((f) => f.includes('docs') || f.endsWith('.md'))) return 'documentation';
  if (files.some((f) => f.includes('config') || f.endsWith('.json'))) return 'configuration';
  if (files.some((f) => f.includes('src/') && f.endsWith('.ts'))) return 'development';
  return 'general';
}

// ─── Main Engine ──────────────────────────────────────────────────────

function generateProactiveSuggestions(
  patterns: UsagePattern[],
  _context: ContextSnapshot,
  config: PIEConfig,
): ProactiveSuggestion[] {
  // Context used for future contextual filtering
  void _context;
  const suggestions: ProactiveSuggestion[] = [];

  for (const pattern of patterns) {
    if (pattern.confidence >= config.minConfidence) {
      suggestions.push(...pattern.suggests);
    }
  }

  // Sort by confidence
  suggestions.sort((a, b) => b.confidence - a.confidence);

  // Limit and deduplicate
  const unique = new Map<string, ProactiveSuggestion>();
  for (const s of suggestions.slice(0, config.maxSuggestions * 2)) {
    if (!unique.has(s.id)) {
      unique.set(s.id, s);
    }
  }

  return [...unique.values()].slice(0, config.maxSuggestions);
}

function executeProactiveAction(suggestion: ProactiveSuggestion): void {
  const triggerDir = join(SESSION_DIR, 'proactive-actions');
  ensureDir(triggerDir);

  const actionFile = join(triggerDir, `${suggestion.id}.json`);
  writeFileSync(
    actionFile,
    JSON.stringify(
      {
        ...suggestion,
        executedAt: now(),
      },
      null,
      2,
    ),
    'utf-8',
  );
}

interface CLIArgs {
  analyze: boolean;
  suggest: boolean;
  apply: boolean;
  quiet: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CLIArgs {
  return {
    analyze: argv.includes('--analyze'),
    suggest: argv.includes('--suggest'),
    apply: argv.includes('--apply'),
    quiet: argv.includes('--quiet'),
    dryRun: argv.includes('--dry-run'),
  };
}

function main(): void {
  const args = parseArgs(process.argv);
  const config = loadJson<PIEConfig>(PIE_CONFIG, DEFAULT_CONFIG);

  if (!config.enabled) {
    if (!args.quiet) console.log('[PIE] Proactive Intelligence Engine disabled');
    return;
  }

  ensureDir(PIE_DIR);

  if (!args.quiet) console.log('[PIE] Proactive Intelligence Engine starting...');

  // 1. Capture current context
  const context = captureContext();
  if (!args.quiet)
    console.log(
      `[PIE] Context: ${dayName(context.dayOfWeek)} ${context.hour}:00, branch: ${context.branch}`,
    );

  // 2. Load recent sessions
  const sessions = loadRecentSessions(config.analysisWindow);
  if (!args.quiet) console.log(`[PIE] Loaded ${sessions.length} recent sessions`);

  // 3. Analyze patterns
  let patterns: UsagePattern[] = [];
  if (args.analyze || args.suggest || (!args.analyze && !args.suggest && !args.apply)) {
    const timePatterns = analyzeTimePatterns(sessions);
    const filePatterns = analyzeFilePatterns(sessions);
    const seqPatterns = analyzeSequencePatterns(sessions);

    patterns = [...timePatterns, ...filePatterns, ...seqPatterns];
    if (!args.quiet) console.log(`[PIE] Detected ${patterns.length} patterns`);

    if (!args.dryRun) {
      saveJson(PATTERNS_DB, patterns);
    }
  } else {
    patterns = loadJson<UsagePattern[]>(PATTERNS_DB, []);
  }

  // 4. Generate suggestions
  let suggestions: ProactiveSuggestion[] = [];
  if (args.suggest || (!args.analyze && !args.suggest && !args.apply)) {
    suggestions = generateProactiveSuggestions(patterns, context, config);
    if (!args.quiet) console.log(`[PIE] Generated ${suggestions.length} proactive suggestions`);

    if (!args.dryRun) {
      saveJson(SUGGESTIONS_DB, { timestamp: now(), suggestions });
    }

    // 5. Display suggestions
    if (!args.quiet && suggestions.length > 0) {
      console.log('\n[PIE] Proactive Suggestions:');
      for (const s of suggestions) {
        const auto = s.confidence >= config.autoApplyMinConfidence ? ' [AUTO]' : '';
        console.log(`\n  [${s.priority.toUpperCase()}] ${s.title}${auto}`);
        console.log(`         ${s.description}`);
        console.log(
          `         Confidence: ${(s.confidence * 100).toFixed(0)}% | Tokens: ~${s.estimatedTokens}`,
        );
        console.log(`         Rationale: ${s.rationale}`);
      }
    }
  }

  // 6. Execute auto-apply candidates
  const highConfidenceActions = suggestions.filter(
    (s) => s.confidence >= config.autoApplyMinConfidence && config.autoApplyEnabled,
  );

  if (args.apply || (!args.dryRun && highConfidenceActions.length > 0)) {
    if (!args.quiet)
      console.log(`\n[PIE] Auto-applying ${highConfidenceActions.length} high-confidence actions`);

    for (const action of highConfidenceActions) {
      if (!args.dryRun) {
        executeProactiveAction(action);
      }
      if (!args.quiet) console.log(`  → Queued: ${action.title}`);
    }
  }

  // 7. Assemble result
  const result: AnticipationResult = {
    timestamp: now(),
    context,
    patterns,
    suggestions,
    highConfidenceActions,
    metrics: {
      patternsAnalyzed: patterns.length,
      suggestionsGenerated: suggestions.length,
      autoApplyCandidates: highConfidenceActions.length,
      confidence:
        patterns.length > 0 ? patterns.reduce((s, p) => s + p.confidence, 0) / patterns.length : 0,
    },
  };

  // 8. Save result
  if (!args.dryRun) {
    const resultPath = join(PIE_DIR, `result-${now().slice(0, 10)}.json`);
    saveJson(resultPath, result);
  }

  // 9. Output summary
  if (!args.quiet) {
    console.log('\n[PIE] Summary:');
    console.log(`  Patterns: ${result.metrics.patternsAnalyzed}`);
    console.log(`  Suggestions: ${result.metrics.suggestionsGenerated}`);
    console.log(`  Auto-apply: ${result.metrics.autoApplyCandidates}`);
    console.log(`  Avg confidence: ${(result.metrics.confidence * 100).toFixed(0)}%`);
    console.log('[PIE] Done');
  }

  // Output JSON for pipeline
  console.log(
    JSON.stringify({
      patterns: result.metrics.patternsAnalyzed,
      suggestions: result.metrics.suggestionsGenerated,
      autoApply: result.metrics.autoApplyCandidates,
      confidence: Math.round(result.metrics.confidence * 100),
    }),
  );
}

// Run if called directly
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export {
  analyzeTimePatterns,
  analyzeFilePatterns,
  analyzeSequencePatterns,
  generateProactiveSuggestions,
  captureContext,
  type UsagePattern,
  type ProactiveSuggestion,
  type ContextSnapshot,
  type AnticipationResult,
};
