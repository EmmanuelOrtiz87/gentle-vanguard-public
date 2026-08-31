#!/usr/bin/env node
/**
 * Adaptive Codex/Windsurf Profile — dynamically optimizes .codex and .windsurf configs
 * based on peak hours and token pressure. TS migration of
 * scripts/utilities/profile/PROFILE-ADAPTIVE/adaptive-codex-windsurf-profile.ps1
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

const ROOT = resolve(process.cwd());
const SESSION_DIR = path.join(ROOT, '.session');
const STATE_PATH = path.join(SESSION_DIR, 'adaptive-codex-windsurf-state.json');
const CODEX_PATH = path.join(ROOT, '.codex', 'config.toml');
const WINDSURF_PATH = path.join(ROOT, '.windsurf', 'config.json');
const CODEX_BASELINE = path.join(SESSION_DIR, 'codex-config.baseline.toml');
const WINDSURF_BASELINE = path.join(SESSION_DIR, 'windsurf-config.baseline.json');
const BUDGET_PATH = path.join(ROOT, '.session', 'token-budget.json');

function resolve(dir: string): string {
  return path.resolve(dir);
}

const CODEX_OPTIMIZED = `model = "gpt-5.5"
approval_policy = "on-request"
sandbox_mode = "workspace-write"
allow_login_shell = false
web_search = "disabled"
project_doc_max_bytes = 16384
file_opener = "vscode"
[sandbox_workspace_write]
network_access = false
[history]
persistence = "save-all"
max_bytes = 2621440
[features]
multi_agent = true
enable_request_compression = true
shell_snapshot = true
[windows]
sandbox = "unelevated"
`;

const WINDSURF_OPTIMIZED = JSON.stringify(
  {
    name: 'Windsurf - Optimized Profile',
    version: '1.2.0',
    description: 'Optimized Windsurf for peak hour / token pressure',
    workspace: {
      projectRoot: '.',
      configFiles: ['AGENTS.md', 'CLAUDE.md'],
      skillRegistry: '.atl/skill-registry.md',
    },
    aiSettings: { temperature: 0.3, maxTokens: 2500, localFirst: true },
    toolPermissions: { websearch: 'deny', webfetch: 'deny', externalTools: 'ask' },
    contextManagement: {
      useEngramMemory: true,
      useLocalSkills: true,
      useProjectDocs: true,
      fastContext: true,
    },
    cascade: { restrictToLocal: true, allowExternalTools: false, webDocsSearch: 'disabled' },
    preProcessing: {
      enabled: true,
      mandatory: true,
      script: 'npx tsx src/tools/pre-process-input.ts',
      scriptArgs: { UserInput: 'USER_INPUT_HERE', WorkspaceRoot: '.' },
    },
    sessionManagement: {
      tracking: { project: 'gentle-vanguard', sessionIdPattern: 'session-YYYY-MM-DD-XX' },
    },
    language: { default: 'es', technicalTerms: 'en' },
  },
  null,
  2,
);

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

function isPeakHour(timeZone: string, peakStart: number, peakEnd: number): boolean {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hour: '2-digit',
      hour12: false,
    });
    return (
      parseInt(formatter.format(new Date()), 10) >= peakStart &&
      parseInt(formatter.format(new Date()), 10) < peakEnd
    );
  } catch {
    return false;
  }
}

function isTokenPressure(): boolean {
  const budget = readJson<{ used?: number; limit?: number }>(BUDGET_PATH);
  if (typeof budget?.used === 'number' && typeof budget?.limit === 'number')
    return budget.used / budget.limit > 0.8;
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
    if (!(key in s)) s[key] = d[key];
  }
  return state;
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
  if (mode === 'Optimize') shouldOptimize = true;
  if (mode === 'Restore') shouldOptimize = false;

  const state = ensureState(readJson<AdaptiveState>(STATE_PATH));

  if (shouldOptimize) {
    state.normalStreak = 0;
    if (!state.optimizationActive) {
      if (fs.existsSync(CODEX_PATH)) fs.copyFileSync(CODEX_PATH, CODEX_BASELINE);
      if (fs.existsSync(WINDSURF_PATH)) fs.copyFileSync(WINDSURF_PATH, WINDSURF_BASELINE);
      ensureDir(path.dirname(CODEX_PATH));
      fs.writeFileSync(CODEX_PATH, CODEX_OPTIMIZED, 'utf-8');
      ensureDir(path.dirname(WINDSURF_PATH));
      fs.writeFileSync(WINDSURF_PATH, WINDSURF_OPTIMIZED, 'utf-8');
      state.optimizationActive = true;
      state.lastAction = 'optimized';
      state.lastReason = reason;
      state.lastChangedAt = new Date().toISOString();
      writeJson(STATE_PATH, state);
      if (!silent) console.log(`  [OK] Adaptive Codex/Windsurf optimization enabled (${reason}).`);
    } else {
      state.lastReason = reason;
      writeJson(STATE_PATH, state);
      if (!silent) console.log(`  [INFO] Optimization already active (${reason}).`);
    }
    process.exit(0);
  }

  state.normalStreak = (state.normalStreak || 0) + 1;

  if (state.optimizationActive && state.normalStreak >= 2) {
    if (fs.existsSync(CODEX_BASELINE)) {
      fs.copyFileSync(CODEX_BASELINE, CODEX_PATH);
      fs.unlinkSync(CODEX_BASELINE);
    }
    if (fs.existsSync(WINDSURF_BASELINE)) {
      fs.copyFileSync(WINDSURF_BASELINE, WINDSURF_PATH);
      fs.unlinkSync(WINDSURF_BASELINE);
    }
    state.optimizationActive = false;
    state.normalStreak = 0;
    state.lastAction = 'restored';
    state.lastReason = 'normalized';
    state.lastChangedAt = new Date().toISOString();
    writeJson(STATE_PATH, state);
    if (!silent) console.log('  [OK] Adaptive Codex/Windsurf profile restored to baseline.');
  } else {
    writeJson(STATE_PATH, state);
    if (!silent)
      console.log(`  [INFO] No change. reason=${reason} normalStreak=${state.normalStreak}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
