#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { runSync } from '../core/run-command.js';
import { loadConfigFile } from '../core/config-loader.js';

const ROOT = resolve(process.cwd());

export interface AdaptiveModeConfig {
  thresholdPct: number;
  action: 'log_only' | 'notify' | 'block_new_tasks' | 'critical_only';
  description: string;
}

export interface GuardConfig {
  enabled: boolean;
  non_blocking: boolean;
  require_engram: boolean;
  daily_budget_tokens: number;
  soft_threshold_pct: number;
  hard_threshold_pct: number;
  enforce_on_commands: string[];
  fallback_actions: string[];
  enforcement_mode: 'soft' | 'adaptive';
  adaptive_modes?: {
    soft?: AdaptiveModeConfig;
    warn?: AdaptiveModeConfig;
    strict?: AdaptiveModeConfig;
    emergency?: AdaptiveModeConfig;
  };
}

export interface GuardResult {
  mode: string;
  task: string;
  risk: string;
  status: string;
  estimated_tokens: number;
  used_today_tokens: number;
  projected_tokens: number;
  daily_budget_tokens: number;
  projected_pct: number;
  soft_threshold_pct: number;
  hard_threshold_pct: number;
  engram_required: boolean;
  engram_available: boolean;
  alternatives: string[];
}

const DEFAULT_CONFIG: GuardConfig = {
  enabled: true,
  non_blocking: true,
  require_engram: true,
  daily_budget_tokens: 120000,
  soft_threshold_pct: 70,
  hard_threshold_pct: 90,
  enforce_on_commands: [
    'context-pack',
    'compact-start',
    'review',
    'audit',
    'end-session',
    'publish',
  ],
  fallback_actions: [],
  enforcement_mode: 'soft',
};

const TASK_TOKENS: Record<string, number> = {
  'context-pack': 1200,
  'compact-start': 1600,
  review: 3200,
  audit: 2200,
  'end-session': 1800,
  publish: 4500,
  general: 1000,
};

const METRICS_DIR = join(ROOT, 'docs', 'sessions', 'metrics');
const USAGE_FILE = join(METRICS_DIR, 'token-guard-usage.csv');
const ORCHESTRATOR_PATH = join(ROOT, 'config', 'orchestrator.json');

function ensureDir(filePath: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadConfig(): GuardConfig {
  const config: GuardConfig = {
    ...DEFAULT_CONFIG,
    enforcement_mode: 'soft',
  };

  // Priority 1: token-budget-guard.json (single source of truth, v3) — via unified loader
  const primary = loadConfigFile<{
    tokenBudget?: {
      limits?: Record<string, number>;
      enforcement?: {
        mode?: string;
        adaptiveModes?: Record<string, AdaptiveModeConfig>;
      };
    };
  }>('token-budget-guard');

  const tb = primary.data?.tokenBudget;
  if (tb) {
    config.daily_budget_tokens = tb.limits?.daily ?? config.daily_budget_tokens;
    config.soft_threshold_pct = tb.limits?.softThreshold ?? config.soft_threshold_pct;
    config.hard_threshold_pct = tb.limits?.hardThreshold ?? config.hard_threshold_pct;

    // Load adaptive mode configuration
    if (tb.enforcement?.mode) {
      config.enforcement_mode = tb.enforcement.mode as 'soft' | 'adaptive';
      config.adaptive_modes = tb.enforcement.adaptiveModes;
    }
    return config;
  }
  for (const w of primary.warnings) console.warn(`[TOKEN-BUDGET] ${w}`);

  // Priority 2: orchestrator.json (legacy fallback)
  if (existsSync(ORCHESTRATOR_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(ORCHESTRATOR_PATH, 'utf-8'));
      const custom =
        raw?.orchestrator?.token_budget_guard || raw?.subagent_orchestration?.token_budget_guard;
      if (custom) {
        for (const key of Object.keys(DEFAULT_CONFIG)) {
          if (key in custom) (config as unknown as Record<string, unknown>)[key] = custom[key];
        }
        console.log(
          `[TOKEN-BUDGET] Loaded from orchestrator.json (legacy): daily_budget=${config.daily_budget_tokens}, soft=${config.soft_threshold_pct}%, hard=${config.hard_threshold_pct}%`,
        );
      }
    } catch (err) {
      console.warn(`[TOKEN-BUDGET] Failed to load orchestrator.json: ${err}`);
    }
  }
  return config;
}

export function estimateTokens(taskName: string, risk: string, chars: number): number {
  if (chars > 0) return Math.ceil(chars / 4);
  const base = TASK_TOKENS[taskName.toLowerCase()] ?? TASK_TOKENS['general'];
  const mult = risk === 'low' ? 0.8 : risk === 'high' ? 1.25 : 1.0;
  return Math.ceil(base * mult);
}

function ensureMetricsFile(): void {
  ensureDir(USAGE_FILE);
  if (!existsSync(USAGE_FILE)) {
    writeFileSync(
      USAGE_FILE,
      'timestamp,date,task,risk,estimated_tokens,actual_prompt_tokens,actual_completion_tokens,actual_total,status,engram_available,notes\n',
    );
  }
}

export function getUsedTokensToday(): number {
  ensureMetricsFile();
  const today = new Date().toISOString().slice(0, 10);
  const content = readFileSync(USAGE_FILE, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim());
  let sum = 0;
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    if (cols[1] === today && /^\d+$/.test(cols[4])) {
      sum += parseInt(cols[4], 10);
    }
  }
  return sum;
}

export function saveUsageRecord(opts: {
  task: string;
  risk: string;
  estimated: number;
  actualPrompt: number;
  actualCompletion: number;
  status: string;
  engramAvailable: boolean;
  notes: string;
}): void {
  ensureMetricsFile();
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const actualTotal = opts.actualPrompt + opts.actualCompletion;
  const line = [
    now.toISOString(),
    date,
    opts.task,
    opts.risk,
    opts.estimated,
    opts.actualPrompt,
    opts.actualCompletion,
    actualTotal,
    opts.status,
    opts.engramAvailable,
    opts.notes.replace(/,/g, ';'),
  ].join(',');
  appendFileSync(USAGE_FILE, line + '\n');
}

export function checkEngram(): { available: boolean; source: string } {
  try {
    // Windows compatible: try 'where' first, fallback to direct execution
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? 'where' : 'which';
    const r = runSync(cmd, ['engram'], { stdio: 'pipe', timeout: 5000 }).stdout.trim();
    if (r) return { available: true, source: r.split('\n')[0].trim() };
  } catch {
    // Fallback: try to run engram directly
    try {
      const ver = runSync('engram', ['--version'], { stdio: 'pipe', timeout: 5000 });
      if (ver.status === 0) return { available: true, source: 'engram (in PATH)' };
    } catch {
      /* not found */
    }
  }
  return { available: false, source: '' };
}

export function runGuard(opts: {
  mode: string;
  task: string;
  risk: string;
  chars: number;
  actualPrompt: number;
  actualCompletion: number;
  record: boolean;
  strict: boolean;
  asJson: boolean;
  quiet: boolean;
}): GuardResult {
  const config = loadConfig();
  if (!config.enabled) {
    if (!opts.quiet) console.log('[OK] Token budget guard is disabled in config.');
    return {
      mode: opts.mode,
      task: opts.task,
      risk: opts.risk,
      status: 'DISABLED',
      estimated_tokens: 0,
      used_today_tokens: 0,
      projected_tokens: 0,
      daily_budget_tokens: 0,
      projected_pct: 0,
      soft_threshold_pct: 0,
      hard_threshold_pct: 0,
      engram_required: false,
      engram_available: false,
      alternatives: [],
    };
  }

  const estimated = estimateTokens(opts.task, opts.risk, opts.chars);
  const used = getUsedTokensToday();
  const projected = used + estimated;
  const budget = config.daily_budget_tokens;
  const pct = budget > 0 ? Math.round((projected / budget) * 10000) / 100 : 0;

  // Determine status based on mode (soft vs adaptive)
  let status = 'PASS';

  if (config.enforcement_mode === 'adaptive' && config.adaptive_modes) {
    // Adaptive mode: use thresholds from config
    const modes = config.adaptive_modes;

    if (pct >= (modes.emergency?.thresholdPct ?? 100)) {
      status = 'EMERGENCY';
    } else if (pct >= (modes.strict?.thresholdPct ?? 95)) {
      status = 'STRICT';
    } else if (pct >= (modes.warn?.thresholdPct ?? 85)) {
      status = 'WARN';
    } else if (pct >= (modes.soft?.thresholdPct ?? 70)) {
      status = 'SOFT_LIMIT';
    }
  } else {
    // Legacy soft mode
    if (pct >= config.hard_threshold_pct) {
      status = 'HARD_LIMIT';
    } else if (pct >= config.soft_threshold_pct) {
      status = 'SOFT_LIMIT';
    }
  }

  const engram = checkEngram();
  if (config.require_engram && !engram.available && status === 'PASS') status = 'ENGRAM_MISSING';

  const alternatives = [...config.fallback_actions];
  if (!engram.available) alternatives.push('engram install');

  if (opts.mode === 'check' || opts.record) {
    saveUsageRecord({
      task: opts.task,
      risk: opts.risk,
      estimated,
      actualPrompt: opts.actualPrompt,
      actualCompletion: opts.actualCompletion,
      status,
      engramAvailable: engram.available,
      notes: `projected_pct=${pct}; actual_tracking=${opts.actualPrompt > 0 || opts.actualCompletion > 0}`,
    });
  }

  const result: GuardResult = {
    mode: opts.mode,
    task: opts.task,
    risk: opts.risk,
    status,
    estimated_tokens: estimated,
    used_today_tokens: used,
    projected_tokens: projected,
    daily_budget_tokens: budget,
    projected_pct: pct,
    soft_threshold_pct: config.soft_threshold_pct,
    hard_threshold_pct: config.hard_threshold_pct,
    engram_required: config.require_engram,
    engram_available: engram.available,
    alternatives,
  };

  if (opts.asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Token Budget Guard`);
    console.log(`Task: ${opts.task} | Risk: ${opts.risk} | Status: ${status}`);
    console.log(
      `Estimated: ${estimated} tokens | Used today: ${used} | Projected: ${projected} / ${budget} (${pct}%)`,
    );
    if (status !== 'PASS') {
      console.log('[WARN] Token budget alert triggered.');
      if (status === 'HARD_LIMIT') console.log('[WARN] Hard threshold reached.');
      if (config.require_engram && !engram.available)
        console.log('[WARN] Engram is required by policy and was not found.');
      console.log('Alternatives:');
      for (const a of alternatives) console.log(`  - ${a}`);
    } else {
      console.log('[OK] Token budget is within threshold.');
    }
  }

  if (opts.strict && (status === 'HARD_LIMIT' || status === 'ENGRAM_MISSING')) {
    process.exit(2);
  }

  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opts = {
    mode: 'status',
    task: 'general',
    risk: 'medium',
    chars: 0,
    actualPrompt: 0,
    actualCompletion: 0,
    record: false,
    strict: false,
    asJson: false,
    quiet: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '-Mode':
        opts.mode = args[++i] ?? 'status';
        break;
      case '-Task':
        opts.task = args[++i] ?? 'general';
        break;
      case '-Risk':
        opts.risk = args[++i] ?? 'medium';
        break;
      case '-EstimatedChars':
        opts.chars = parseInt(args[++i] ?? '0', 10);
        break;
      case '-ActualPromptTokens':
        opts.actualPrompt = parseInt(args[++i] ?? '0', 10);
        break;
      case '-ActualCompletionTokens':
        opts.actualCompletion = parseInt(args[++i] ?? '0', 10);
        break;
      case '-Record':
        opts.record = true;
        break;
      case '-Strict':
        opts.strict = true;
        break;
      case '-AsJson':
        opts.asJson = true;
        break;
      case '-Quiet':
        opts.quiet = true;
        break;
      default:
        if (!args[i].startsWith('-')) opts.mode = args[i];
        break;
    }
  }

  runGuard(opts);
}
