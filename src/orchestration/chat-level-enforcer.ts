#!/usr/bin/env node
/**
 * Chat Level Enforcer — Enforces chat response verbosity levels
 *
 * Enforces chat levels (chat-compact/chat-balanced/chat-detailed)
 * Automatic line limiting and token management
 * Integration with response profiles
 * Break-glass override support
 *
 * Usage:
 *   npx tsx src/orchestration/chat-level-enforcer.ts --level chat-compact --input "response"
 *   npx tsx src/orchestration/chat-level-enforcer.ts --level chat-balanced --file response.txt
 *   npx tsx src/orchestration/chat-level-enforcer.ts --profile ultra
 *   npx tsx src/orchestration/chat-level-enforcer.ts --status
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { pathToFileURL } from 'url';
import {
  getConfig as getOutputConfig,
  compressOutput,
  CompressionProfile,
} from '../compression/output-compression.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

export type ChatLevel = 'chat-compact' | 'chat-balanced' | 'chat-detailed';

export interface ChatLevelEnforcementResult {
  original: string;
  enforced: string;
  level: ChatLevel;
  profile: CompressionProfile;
  originalLines: number;
  enforcedLines: number;
  originalTokens: number;
  enforcedTokens: number;
  linesExcess: number;
  tokensExcess: number;
  wasEnforced: boolean;
  overridden: boolean;
  overrideReason?: string;
  durationMs: number;
}

export interface BreakGlassState {
  sessionId: string;
  overridesUsed: number;
  lastOverrideAt: string | null;
  cooldownRemaining: number;
}

export interface ChatLevelMetrics {
  totalEnforcements: number;
  enforcedCount: number;
  overriddenCount: number;
  byLevel: Record<
    ChatLevel,
    {
      count: number;
      avgLinesSaved: number;
      avgTokensSaved: number;
    }
  >;
  breakGlassUsage: {
    totalOverrides: number;
    byReason: Record<string, number>;
  };
}

export interface EnforcerConfig {
  defaultLevel: ChatLevel;
  enforceOnSessionStart: boolean;
  autoEscalateOnComplexTasks: boolean;
  autoEscalateTriggers: string[];
  breakGlass: {
    enabled: boolean;
    maxOverridesPerSession: number;
    maxOverridesPerHour: number;
    cooldownTurns: number;
    requiresReason: boolean;
    auditLog: string;
  };
}

// ─── Paths ────────────────────────────────────────────────────────────────────

const ROOT = resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd());
const ORCHESTRATOR_PATH = join(ROOT, 'config', 'orchestrator.json');
const STATE_PATH = join(ROOT, '.runtime', 'chat-level-state.json');
const METRICS_PATH = join(ROOT, '.runtime', 'chat-level-metrics.json');
const BREAKGLASS_LOG = join(ROOT, '.logs', 'chat-level-breakglass.jsonl');

// ─── State Management ───────────────────────────────────────────────────────────

function getSessionId(): string {
  // Try to get from environment or generate
  return process.env.GENTLE_VANGUARD_SESSION_ID ?? `session-${Date.now()}`;
}

function loadState(): BreakGlassState {
  const sessionId = getSessionId();
  try {
    if (existsSync(STATE_PATH)) {
      const states: Record<string, BreakGlassState> = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
      if (states[sessionId]) return states[sessionId];
    }
  } catch {
    /* ignore */
  }

  return {
    sessionId,
    overridesUsed: 0,
    lastOverrideAt: null,
    cooldownRemaining: 0,
  };
}

function saveState(state: BreakGlassState): void {
  try {
    let states: Record<string, BreakGlassState> = {};
    if (existsSync(STATE_PATH)) {
      states = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
    }
    states[state.sessionId] = state;
    ensureDir(STATE_PATH);
    writeFileSync(STATE_PATH, JSON.stringify(states, null, 2));
  } catch {
    /* ignore */
  }
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ─── Config Loaders ───────────────────────────────────────────────────────────

export function getOrchestratorConfig(): Partial<EnforcerConfig> {
  try {
    if (existsSync(ORCHESTRATOR_PATH)) {
      const raw = JSON.parse(readFileSync(ORCHESTRATOR_PATH, 'utf-8'));
      const chat = raw?.chat_response;
      const policy = raw?.response_policy;

      return {
        defaultLevel: chat?.default_level ?? 'chat-compact',
        enforceOnSessionStart: chat?.enforce_on_session_start ?? false,
        autoEscalateOnComplexTasks: chat?.auto_escalate_on_complex_tasks ?? true,
        autoEscalateTriggers: chat?.auto_escalate_triggers ?? [],
        breakGlass: {
          enabled: policy?.break_glass?.enabled ?? true,
          maxOverridesPerSession:
            policy?.break_glass?.abuse_prevention?.max_overrides_per_session ?? 3,
          maxOverridesPerHour: policy?.break_glass?.abuse_prevention?.max_overrides_per_hour ?? 2,
          cooldownTurns: policy?.break_glass?.cooldown_turns ?? 5,
          requiresReason: true,
          auditLog: policy?.break_glass?.audit_log ?? '.logs/break-glass-audit.jsonl',
        },
      };
    }
  } catch {
    /* ignore */
  }

  return {
    defaultLevel: 'chat-compact',
    enforceOnSessionStart: false,
    autoEscalateOnComplexTasks: true,
    autoEscalateTriggers: ['multi-step', 'implement', 'refactor'],
    breakGlass: {
      enabled: true,
      maxOverridesPerSession: 3,
      maxOverridesPerHour: 2,
      cooldownTurns: 5,
      requiresReason: true,
      auditLog: '.logs/break-glass-audit.jsonl',
    },
  };
}

// ─── Token Estimation ─────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  // Simple estimation: chars / 4
  return Math.ceil(text.length / 4);
}

// ─── Chat Level Configuration ───────────────────────────────────────────────────

export function getChatLevelConfig(level: ChatLevel): {
  maxLines: number;
  maxTokens: number;
  enforceLineLimit: boolean;
  enforceTokenLimit: boolean;
  defaultProfile: CompressionProfile;
} {
  const outputConfig = getOutputConfig();
  const chatConfig = outputConfig.chatLevels?.[level];

  if (chatConfig) {
    return {
      maxLines: chatConfig.maxLines,
      maxTokens: chatConfig.maxTokens,
      enforceLineLimit: chatConfig.enforceLineLimit,
      enforceTokenLimit: chatConfig.enforceTokenLimit,
      defaultProfile: chatConfig.defaultProfile,
    };
  }

  // Defaults
  const defaults = {
    'chat-compact': {
      maxLines: 10,
      maxTokens: 500,
      enforceLineLimit: true,
      enforceTokenLimit: true,
      defaultProfile: 'ultra' as CompressionProfile,
    },
    'chat-balanced': {
      maxLines: 25,
      maxTokens: 1500,
      enforceLineLimit: true,
      enforceTokenLimit: true,
      defaultProfile: 'lleno' as CompressionProfile,
    },
    'chat-detailed': {
      maxLines: 100,
      maxTokens: 4000,
      enforceLineLimit: false,
      enforceTokenLimit: false,
      defaultProfile: 'lite' as CompressionProfile,
    },
  };

  return defaults[level];
}

// ─── Break-Glass Logic ────────────────────────────────────────────────────────

export function canUseBreakGlass(_reason: string): { allowed: boolean; reason?: string } {
  const state = loadState();
  const config = getOrchestratorConfig();

  if (!config.breakGlass?.enabled) {
    return { allowed: false, reason: 'Break-glass is disabled' };
  }

  // Check session limit
  if (state.overridesUsed >= (config.breakGlass?.maxOverridesPerSession ?? 3)) {
    return { allowed: false, reason: 'Session override limit reached' };
  }

  // Check hourly limit
  if (state.lastOverrideAt) {
    const lastAt = new Date(state.lastOverrideAt).getTime();
    const hoursSince = (Date.now() - lastAt) / (1000 * 60 * 60);
    if (hoursSince < 1 && state.overridesUsed >= (config.breakGlass?.maxOverridesPerHour ?? 2)) {
      return { allowed: false, reason: 'Hourly override limit reached' };
    }
  }

  // Check cooldown
  if (state.cooldownRemaining > 0) {
    return { allowed: false, reason: `Cooldown: ${state.cooldownRemaining} turns remaining` };
  }

  return { allowed: true };
}

export function applyBreakGlass(reason: string): void {
  const state = loadState();
  const config = getOrchestratorConfig();

  state.overridesUsed++;
  state.lastOverrideAt = new Date().toISOString();
  state.cooldownRemaining = config.breakGlass?.cooldownTurns ?? 5;
  saveState(state);

  // Log to audit
  const auditLog = config.breakGlass?.auditLog ?? BREAKGLASS_LOG;
  ensureDir(auditLog);

  const entry = {
    timestamp: new Date().toISOString(),
    sessionId: state.sessionId,
    reason,
    overridesUsed: state.overridesUsed,
  };

  try {
    appendFileSync(auditLog, JSON.stringify(entry) + '\n');
  } catch {
    /* ignore */
  }
}

export function decrementCooldown(): void {
  const state = loadState();
  if (state.cooldownRemaining > 0) {
    state.cooldownRemaining--;
    saveState(state);
  }
}

// ─── Complex Task Detection ───────────────────────────────────────────────────

export function detectComplexTask(input: string): boolean {
  const config = getOrchestratorConfig();
  const triggers = config.autoEscalateTriggers ?? [];
  const lower = input.toLowerCase();

  for (const trigger of triggers) {
    if (lower.includes(trigger.toLowerCase())) return true;
  }
  return false;
}

// ─── Core Enforcement ───────────────────────────────────────────────────────────

export function enforceChatLevel(
  input: string,
  level: ChatLevel = 'chat-compact',
  options: {
    autoEscalate?: boolean;
    breakGlassReason?: string;
    profile?: CompressionProfile;
  } = {},
): ChatLevelEnforcementResult {
  const startTime = Date.now();

  // Handle empty input
  if (!input || !input.trim()) {
    return {
      original: input,
      enforced: input,
      level,
      profile: options.profile ?? 'lleno',
      originalLines: 0,
      enforcedLines: 0,
      originalTokens: 0,
      enforcedTokens: 0,
      linesExcess: 0,
      tokensExcess: 0,
      wasEnforced: false,
      overridden: false,
      durationMs: 0,
    };
  }

  // Auto-escalate if complex task detected
  let targetLevel = level;
  let overrideReason: string | undefined;

  if (options.autoEscalate !== false && detectComplexTask(input)) {
    if (level === 'chat-compact') {
      targetLevel = 'chat-balanced';
      overrideReason = 'auto-escalate: complex task detected';
    } else if (level === 'chat-balanced') {
      targetLevel = 'chat-detailed';
      overrideReason = 'auto-escalate: complex task detected';
    }
  }

  // Check for break-glass override
  let overridden = false;
  if (options.breakGlassReason) {
    const bgCheck = canUseBreakGlass(options.breakGlassReason);
    if (!bgCheck.allowed) {
      // Cannot override, continue with enforcement
      overrideReason = undefined;
    } else {
      // Apply break-glass
      applyBreakGlass(options.breakGlassReason);
      overridden = true;

      // Use a more permissive level
      if (targetLevel === 'chat-compact') {
        targetLevel = 'chat-balanced';
        overrideReason = options.breakGlassReason;
      } else if (targetLevel === 'chat-balanced') {
        targetLevel = 'chat-detailed';
        overrideReason = options.breakGlassReason;
      }
    }
  }

  // Get level config
  const levelConfig = getChatLevelConfig(targetLevel);
  const profile = options.profile ?? levelConfig.defaultProfile;

  // Apply output compression with the level's settings
  const compressionResult = compressOutput(input, profile, {
    maxLines: levelConfig.enforceLineLimit ? levelConfig.maxLines : undefined,
    maxTokens: levelConfig.enforceTokenLimit ? levelConfig.maxTokens : undefined,
  });

  const originalLines = input.split('\n').length;
  const enforcedLines = compressionResult.compressedLines;
  const originalTokens = estimateTokens(input);
  const enforcedTokens = compressionResult.compressedTokens;

  const linesExcess = Math.max(0, originalLines - levelConfig.maxLines);
  const tokensExcess = Math.max(0, originalTokens - levelConfig.maxTokens);

  // Determine if enforcement actually happened
  const wasEnforced = levelConfig.enforceLineLimit || levelConfig.enforceTokenLimit;

  const result: ChatLevelEnforcementResult = {
    original: input,
    enforced: compressionResult.compressed,
    level: targetLevel,
    profile,
    originalLines,
    enforcedLines,
    originalTokens,
    enforcedTokens,
    linesExcess,
    tokensExcess,
    wasEnforced,
    overridden,
    overrideReason,
    durationMs: Date.now() - startTime,
  };

  // Save metrics
  saveChatMetrics(result);

  // Decrement cooldown (one turn has passed)
  decrementCooldown();

  return result;
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

function loadChatMetrics(): ChatLevelMetrics {
  try {
    if (existsSync(METRICS_PATH)) {
      return JSON.parse(readFileSync(METRICS_PATH, 'utf-8')) as ChatLevelMetrics;
    }
  } catch {
    /* ignore */
  }

  return {
    totalEnforcements: 0,
    enforcedCount: 0,
    overriddenCount: 0,
    byLevel: {
      'chat-compact': { count: 0, avgLinesSaved: 0, avgTokensSaved: 0 },
      'chat-balanced': { count: 0, avgLinesSaved: 0, avgTokensSaved: 0 },
      'chat-detailed': { count: 0, avgLinesSaved: 0, avgTokensSaved: 0 },
    },
    breakGlassUsage: {
      totalOverrides: 0,
      byReason: {},
    },
  };
}

function saveChatMetrics(result: ChatLevelEnforcementResult): void {
  try {
    const metrics = loadChatMetrics();
    metrics.totalEnforcements++;

    if (result.enforced) metrics.enforcedCount++;
    if (result.overridden) metrics.overriddenCount++;

    // Update per-level stats
    const levelStats = metrics.byLevel[result.level];
    if (levelStats) {
      const linesSaved = result.originalLines - result.enforcedLines;
      const tokensSaved = result.originalTokens - result.enforcedTokens;
      levelStats.count++;
      levelStats.avgLinesSaved =
        (levelStats.avgLinesSaved * (levelStats.count - 1) + linesSaved) / levelStats.count;
      levelStats.avgTokensSaved =
        (levelStats.avgTokensSaved * (levelStats.count - 1) + tokensSaved) / levelStats.count;
    }

    // Update break-glass stats
    if (result.overridden && result.overrideReason) {
      metrics.breakGlassUsage.totalOverrides++;
      metrics.breakGlassUsage.byReason[result.overrideReason] =
        (metrics.breakGlassUsage.byReason[result.overrideReason] ?? 0) + 1;
    }

    ensureDir(METRICS_PATH);
    writeFileSync(METRICS_PATH, JSON.stringify(metrics, null, 2));
  } catch {
    /* ignore */
  }
}

// ─── Profile Selection ──────────────────────────────────────────────────────────

export function selectProfileForLevel(level: ChatLevel): CompressionProfile {
  const levelConfig = getChatLevelConfig(level);
  return levelConfig.defaultProfile;
}

export function selectLevelForTask(task: string): ChatLevel {
  if (detectComplexTask(task)) {
    return 'chat-balanced';
  }
  return 'chat-compact';
}

// ─── Status Report ──────────────────────────────────────────────────────────────

export function getStatus(): {
  currentLevel: ChatLevel;
  config: ReturnType<typeof getChatLevelConfig>;
  state: BreakGlassState;
  metrics: ChatLevelMetrics;
} {
  const orchestratorConfig = getOrchestratorConfig();
  const level = orchestratorConfig.defaultLevel ?? 'chat-compact';

  return {
    currentLevel: level,
    config: getChatLevelConfig(level),
    state: loadState(),
    metrics: loadChatMetrics(),
  };
}

// ─── CLI ───────────────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
Chat Level Enforcer

Usage:
  npx tsx src/orchestration/chat-level-enforcer.ts --level <chat-compact|chat-balanced|chat-detailed> [--input "text" | --file path]
  npx tsx src/orchestration/chat-level-enforcer.ts --profile <ultra|lleno|lite|simple> [--input "text"]
  npx tsx src/orchestration/chat-level-enforcer.ts --detect "task description"
  npx tsx src/orchestration/chat-level-enforcer.ts --status
  npx tsx src/orchestration/chat-level-enforcer.ts --break-glass "reason" [--input "text"]

Levels:
  chat-compact   - Essential info only (10 lines, 500 tokens)
  chat-balanced  - Balanced detail (25 lines, 1500 tokens)
  chat-detailed  - Full detail (100 lines, 4000 tokens)

Profiles:
  ultra   - Aggressive compression
  lleno   - Compressed with fragments
  lite    - Professional concise
  simple  - Minimum viable detail

Options:
  --input TEXT          Input text to enforce
  --file PATH           Read input from file
  --level NAME          Chat level to enforce (default: chat-compact)
  --profile NAME        Override compression profile
  --auto-escalate       Enable automatic escalation for complex tasks
  --no-auto-escalate    Disable auto-escalation
  --break-glass REASON  Use break-glass override with reason
  --detect TEXT         Detect if text is a complex task
  --status              Show current status and metrics
  --json                Output as JSON
  --quiet               Suppress extra output

Examples:
  npx tsx src/orchestration/chat-level-enforcer.ts --level chat-compact --input "Hello world"
  npx tsx src/orchestration/chat-level-enforcer.ts --level chat-compact --level chat-balanced --input "Implement a feature"
  npx tsx src/orchestration/chat-level-enforcer.ts --break-glass "Task spans 3+ turns" --input "..."
`);
}

function formatResult(result: ChatLevelEnforcementResult): string {
  const savings = result.originalTokens - result.enforcedTokens;
  const lines: string[] = [
    '',
    '╔══════════════════════════════════════╗',
    '║       Chat Level Enforcement         ║',
    '╚══════════════════════════════════════╝',
    '',
    `  Level:           ${result.level}`,
    `  Profile:         ${result.profile}`,
    `  Duration:        ${result.durationMs}ms`,
    '',
  ];

  if (result.overridden) {
    lines.push(
      `  ⚠️  BREAK-GLASS OVERRIDE APPLIED`,
      `  Reason:          ${result.overrideReason}`,
      '',
    );
  }

  lines.push(
    `  Original:        ${result.originalLines} lines, ~${result.originalTokens} tokens`,
    `  Enforced:        ${result.enforcedLines} lines, ~${result.enforcedTokens} tokens`,
    `  Savings:         ${savings} tokens, ${result.originalLines - result.enforcedLines} lines`,
    '',
  );

  if (result.linesExcess > 0) {
    lines.push(`  Lines excess:    ${result.linesExcess} over limit`);
  }
  if (result.tokensExcess > 0) {
    lines.push(`  Tokens excess:   ${result.tokensExcess} over limit`);
  }

  lines.push('', '  ⚡ Enforced output:', '', result.enforced.slice(0, 500));
  if (result.enforced.length > 500) lines.push('  ... (truncated)');

  return lines.join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  const inputIdx = args.indexOf('--input');
  const fileIdx = args.indexOf('--file');
  const levelIdx = args.indexOf('--level');
  const profileIdx = args.indexOf('--profile');
  const detectIdx = args.indexOf('--detect');
  const breakGlassIdx = args.indexOf('--break-glass');
  const statusFlag = args.includes('--status');
  const autoEscalateFlag = args.includes('--auto-escalate');
  const noAutoEscalateFlag = args.includes('--no-auto-escalate');
  const jsonFlag = args.includes('--json');
  const quietFlag = args.includes('--quiet');

  if (statusFlag) {
    const status = getStatus();
    if (jsonFlag) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║         Chat Level Status            ║');
    console.log('╚══════════════════════════════════════╝');
    console.log('');
    console.log(`  Current Level:       ${status.currentLevel}`);
    console.log(`  Max Lines:           ${status.config.maxLines}`);
    console.log(`  Max Tokens:          ${status.config.maxTokens}`);
    console.log(`  Default Profile:     ${status.config.defaultProfile}`);
    console.log(`  Enforce Line Limit:  ${status.config.enforceLineLimit}`);
    console.log(`  Enforce Token Limit: ${status.config.enforceTokenLimit}`);
    console.log('');
    console.log(`  Break-Glass State:`);
    console.log(`    Overrides Used:    ${status.state.overridesUsed}`);
    console.log(`    Last Override:     ${status.state.lastOverrideAt ?? 'never'}`);
    console.log(`    Cooldown:          ${status.state.cooldownRemaining} turns`);
    console.log('');
    console.log(`  Metrics:`);
    console.log(`    Total enforcements: ${status.metrics.totalEnforcements}`);
    console.log(`    Break-glass used:   ${status.metrics.breakGlassUsage.totalOverrides}`);
    console.log('');
    return;
  }

  if (detectIdx >= 0) {
    const task = args[detectIdx + 1] ?? '';
    const isComplex = detectComplexTask(task);
    const level = selectLevelForTask(task);

    if (jsonFlag) {
      console.log(JSON.stringify({ task, isComplex, recommendedLevel: level }, null, 2));
      return;
    }

    console.log(`Task: ${task}`);
    console.log(`Complex: ${isComplex ? 'Yes' : 'No'}`);
    console.log(`Recommended level: ${level}`);
    return;
  }

  let input = '';
  let level: ChatLevel = 'chat-compact';
  const options: {
    autoEscalate?: boolean;
    breakGlassReason?: string;
    profile?: CompressionProfile;
  } = {};

  if (inputIdx >= 0) {
    input = args[inputIdx + 1] ?? '';
  } else if (fileIdx >= 0) {
    const filePath = args[fileIdx + 1] ?? '';
    if (!filePath || !existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    input = readFileSync(filePath, 'utf-8');
  }

  if (levelIdx >= 0) {
    const l = args[levelIdx + 1] as ChatLevel;
    if (l === 'chat-compact' || l === 'chat-balanced' || l === 'chat-detailed') {
      level = l;
    }
  }

  if (profileIdx >= 0) {
    const p = args[profileIdx + 1] as CompressionProfile;
    if (p === 'ultra' || p === 'lleno' || p === 'lite' || p === 'simple') {
      options.profile = p;
    }
  }

  if (breakGlassIdx >= 0) {
    options.breakGlassReason = args[breakGlassIdx + 1] ?? 'manual override';
  }

  if (autoEscalateFlag) options.autoEscalate = true;
  if (noAutoEscalateFlag) options.autoEscalate = false;

  if (!input && !statusFlag && detectIdx < 0) {
    printUsage();
    process.exit(1);
  }

  const result = enforceChatLevel(input, level, options);

  if (jsonFlag) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!quietFlag) {
    console.log(formatResult(result));
  } else {
    console.log(result.enforced);
  }
}

// ─── Run CLI if called directly ─────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
