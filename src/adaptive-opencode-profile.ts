#!/usr/bin/env node
/**
 * Adaptive OpenCode Profile — dynamically optimizes opencode.json based on peak hours and token pressure.
 * TS migration of scripts/utilities/profile/PROFILE-ADAPTIVE/adaptive-opencode-profile.ps1
 * Includes inlined helpers from adaptive-common.ps1
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

type ProfileMode = 'Auto' | 'Optimize' | 'Restore' | 'Status';

interface AdaptiveState {
  optimizationActive: boolean;
  normalStreak: number;
  lastAction: string;
  lastReason: string;
  lastChangedAt: string | null;
}

interface OpenCodeConfig {
  default_agent?: string;
  share?: string;
  compaction?: { auto?: boolean; prune?: boolean };
  watcher?: { ignore?: string[] };
  permission?: Record<string, unknown>;
  agent?: Record<string, { permission?: Record<string, unknown>; steps?: number }>;
  [key: string]: unknown;
}

function getRepoRoot(): string {
  let dir = path.resolve(process.cwd());
  while (dir && dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

const ROOT = getRepoRoot();
const SESSION_DIR = path.join(ROOT, '.session');
const STATE_PATH = path.join(SESSION_DIR, 'adaptive-opencode-state.json');
const BASELINE_PATH = path.join(SESSION_DIR, 'opencode-baseline.json');
const OPENCODE_PATH = path.join(ROOT, 'opencode.json');
const BUDGET_PATH = path.join(ROOT, '.session', 'token-budget.json');

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function readJson<T>(p: string): T | null {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
  } catch {
    /* ignore */
  }
  return null;
}

function writeJson(p: string, data: unknown): void {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
}

/** Detect if current time is within peak hours */
function isPeakHour(timeZone: string, peakStart: number, peakEnd: number): boolean {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hour: '2-digit',
      hour12: false,
    });
    const hour = parseInt(formatter.format(new Date()), 10);
    return hour >= peakStart && hour < peakEnd;
  } catch {
    return false;
  }
}

/** Detect if token usage exceeds 80% of budget */
function isTokenPressure(): boolean {
  const budget = readJson<{ used?: number; limit?: number }>(BUDGET_PATH);
  if (typeof budget?.used === 'number' && typeof budget?.limit === 'number') {
    return budget.used / budget.limit > 0.8;
  }
  return false;
}

function getAdaptiveReason(peak: boolean, pressure: boolean): string {
  if (peak && pressure) return 'peak+pressure';
  if (peak) return 'peak-hours';
  if (pressure) return 'token-pressure';
  return 'normal';
}

function getDefaultState(): AdaptiveState {
  return {
    optimizationActive: false,
    normalStreak: 0,
    lastAction: 'none',
    lastReason: 'none',
    lastChangedAt: null,
  };
}

function ensureState(state: AdaptiveState | null): AdaptiveState {
  if (!state) return getDefaultState();
  const def = getDefaultState();
  const s = state as unknown as Record<string, unknown>;
  const d = def as unknown as Record<string, unknown>;
  for (const key of Object.keys(def)) {
    if (!(key in s)) {
      s[key] = d[key];
    }
  }
  return state;
}

/** Apply optimizations to opencode config */
function applyOptimizedOverlay(config: OpenCodeConfig): void {
  config.default_agent = 'orchestrator';
  config.share = 'manual';
  config.compaction = { auto: true, prune: true };
  config.watcher = {
    ignore: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '.git/**',
      '.engram-data/**',
      'tmp-session-debug/**',
      'logs/**',
      'session/**',
    ],
  };
  config.permission = {
    read: 'allow',
    glob: 'allow',
    grep: 'allow',
    skill: 'allow',
    question: 'allow',
    todowrite: 'allow',
    lsp: 'ask',
    webfetch: 'deny',
    websearch: 'deny',
    external_directory: 'ask',
    doom_loop: 'deny',
    edit: 'allow',
    bash: {
      '*': 'ask',
      'git status*': 'allow',
      'git log*': 'allow',
      'git diff*': 'allow',
      'git show*': 'allow',
      'rg *': 'allow',
      'Get-ChildItem *': 'allow',
      'Test-Path *': 'allow',
    },
    task: { '*': 'allow' },
  };

  if (config.agent) {
    for (const agentName of Object.keys(config.agent)) {
      const agent = config.agent[agentName];
      if (agent.permission && 'codesearch' in agent.permission) {
        delete agent.permission.codesearch;
      }
      if (agentName === 'orchestrator') {
        if (!agent.permission) agent.permission = {};
        agent.permission.websearch = 'deny';
        agent.permission.webfetch = 'deny';
        agent.permission.task = { '*': 'allow' };
        agent.steps = 12;
      } else {
        agent.steps = 6;
      }
    }
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const mode = (
    args.includes('--mode') ? args[args.indexOf('--mode') + 1] : args[0] || 'Auto'
  ) as ProfileMode;
  const timeZone = args.includes('--timezone')
    ? args[args.indexOf('--timezone') + 1]
    : 'America/Argentina/Buenos_Aires';
  const peakStart = args.includes('--peak-start')
    ? parseInt(args[args.indexOf('--peak-start') + 1], 10)
    : 9;
  const peakEnd = args.includes('--peak-end')
    ? parseInt(args[args.indexOf('--peak-end') + 1], 10)
    : 15;
  const silent = args.includes('--silent') || args.includes('-Silent');

  // Check opencode.json exists
  if (!fs.existsSync(OPENCODE_PATH)) {
    if (!silent) console.log('  [WARN] opencode.json not found. Skipped.');
    process.exit(0);
  }

  const peak = isPeakHour(timeZone, peakStart, peakEnd);
  const pressure = isTokenPressure();
  let shouldOptimize = peak || pressure;
  const reason = getAdaptiveReason(peak, pressure);

  if (mode === 'Status') {
    const state = readJson<AdaptiveState>(STATE_PATH);
    console.log(
      `[STATUS] optimizationActive=${state?.optimizationActive ?? false} shouldOptimize=${shouldOptimize} reason=${reason} normalStreak=${state?.normalStreak ?? 0}`,
    );
    process.exit(0);
  }
  if (mode === 'Optimize') {
    shouldOptimize = true;
  }
  if (mode === 'Restore') {
    shouldOptimize = false;
  }

  const state = ensureState(readJson<AdaptiveState>(STATE_PATH));

  if (shouldOptimize) {
    state.normalStreak = 0;
    if (!state.optimizationActive) {
      const config = readJson<OpenCodeConfig>(OPENCODE_PATH);
      if (!config) {
        if (!silent) console.log('  [WARN] opencode.json invalid');
        process.exit(0);
      }
      // Save baseline
      fs.copyFileSync(OPENCODE_PATH, BASELINE_PATH);
      applyOptimizedOverlay(config);
      writeJson(OPENCODE_PATH, config);
      state.optimizationActive = true;
      state.lastAction = 'optimized';
      state.lastReason = reason;
      state.lastChangedAt = new Date().toISOString();
      writeJson(STATE_PATH, state);
      if (!silent) console.log(`  [OK] Adaptive OpenCode optimization enabled (${reason}).`);
    } else {
      state.lastReason = reason;
      writeJson(STATE_PATH, state);
      if (!silent) console.log(`  [INFO] Optimization already active (${reason}).`);
    }
    process.exit(0);
  }

  // Normal mode — increase streak
  state.normalStreak = (state.normalStreak || 0) + 1;

  if (state.optimizationActive && state.normalStreak >= 2) {
    if (fs.existsSync(BASELINE_PATH)) {
      fs.copyFileSync(BASELINE_PATH, OPENCODE_PATH);
      fs.unlinkSync(BASELINE_PATH);
      state.optimizationActive = false;
      state.lastReason = 'normalized';
      state.lastAction = 'restored';
      state.lastChangedAt = new Date().toISOString();
      state.normalStreak = 0;
      writeJson(STATE_PATH, state);
      if (!silent) console.log('  [OK] Adaptive profile restored to baseline.');
    } else {
      if (!silent) console.log('  [WARN] Baseline missing. No restore performed.');
    }
  } else {
    writeJson(STATE_PATH, state);
    if (!silent)
      console.log(`  [INFO] No change. reason=${reason} normalStreak=${state.normalStreak}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
