#!/usr/bin/env node
/**
 * Anti-Loop Guard — detects repeated failed attempts at the same goal and forces
 * a strategy change or escalation instead of looping indefinitely.
 *
 * Problem it solves:
 *   An agent (or subagent) can get stuck retrying the SAME strategy against the
 *   SAME goal, each attempt failing identically. Without a guard, this becomes an
 *   infinite loop with no resolution and no clear signal to the user.
 *
 * How it works:
 *   - Each attempt is registered with a goal key (stable hash of the goal) and a
 *     strategy key (stable hash of the strategy/approach used).
 *   - When the SAME (goal, strategy) pair fails N times (default 3), the guard
 *     flags a LOOP and returns a signal to CHANGE STRATEGY or ESCALATE.
 *   - A successful attempt resets the counter for that (goal, strategy) pair.
 *   - State is persisted to `.session/anti-loop/` so it survives across calls and
 *     sessions (mirrors auto-escalation.ts persistence pattern).
 *
 * Usage (library):
 *   import { registerAttempt, detectLoop, getLoopStatus } from './anti-loop-guard.js';
 *   registerAttempt('fix npm audit', 'override image-size to 2.0.3', 'failed');
 *   const verdict = detectLoop('fix npm audit');
 *   // verdict = { inLoop: true, attempts: 3, action: 'change_strategy' | 'escalate', ... }
 *
 * Usage (CLI):
 *   npx tsx src/anti-loop-guard.ts register --goal "..." --strategy "..." --outcome failed
 *   npx tsx src/anti-loop-guard.ts detect --goal "..."
 *   npx tsx src/anti-loop-guard.ts status
 *   npx tsx src/anti-loop-guard.ts clear --goal "..."
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { createHash } from 'crypto';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

// ─── Types ────────────────────────────────────────────────────────────

export type AttemptOutcome = 'success' | 'failed';

export interface AttemptRecord {
  goal: string;
  strategy: string;
  outcome: AttemptOutcome;
  timestamp: string;
}

export interface LoopVerdict {
  inLoop: boolean;
  goal: string;
  attempts: number;
  maxAttempts: number;
  action: 'none' | 'change_strategy' | 'escalate';
  message: string;
  lastStrategy: string;
  lastFailure: string;
}

export interface LoopStatus {
  activeLoops: number;
  goals: Record<string, { attempts: number; inLoop: boolean; lastOutcome: string }>;
}

// ─── Constants ────────────────────────────────────────────────────────

/**
 * Resolve state paths dynamically from the current working directory on each
 * call. This keeps the guard testable (each test can chdir to a fresh temp dir)
 * and robust to cwd changes at runtime.
 */
function getStatePaths(): { stateFile: string; logFile: string } {
  const root = resolve(process.cwd());
  const dir = join(root, '.session', 'anti-loop');
  return { stateFile: join(dir, 'state.json'), logFile: join(dir, 'anti-loop.log') };
}

/** Default max attempts before flagging a loop. */
export const DEFAULT_MAX_ATTEMPTS = 3;

/** Attempts after which we escalate to the user (vs. just suggesting a change). */
export const ESCALATE_AFTER = 5;

interface PersistedState {
  goals: Record<
    string,
    {
      strategy: string;
      attempts: number;
      lastOutcome: AttemptOutcome;
      lastFailure: string;
      lastTimestamp: string;
    }
  >;
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Stable hash for a goal/strategy string (used as a map key). */
export function hashKey(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function ensureDirs(): void {
  const dir = join(resolve(process.cwd()), '.session', 'anti-loop');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function log(message: string): void {
  try {
    ensureDirs();
    const { logFile } = getStatePaths();
    appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`, 'utf-8');
  } catch {
    /* non-fatal */
  }
}

function loadState(): PersistedState {
  const { stateFile } = getStatePaths();
  if (!existsSync(stateFile)) return { goals: {} };
  try {
    return JSON.parse(readFileSync(stateFile, 'utf-8')) as PersistedState;
  } catch {
    return { goals: {} };
  }
}

function saveState(state: PersistedState): void {
  ensureDirs();
  const { stateFile } = getStatePaths();
  writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');
}

// ─── Core API ─────────────────────────────────────────────────────────

/**
 * Register an attempt to resolve a goal using a strategy.
 *
 * @param goal     The objective being pursued (natural language or task id).
 * @param strategy The approach/strategy used for this attempt.
 * @param outcome  'success' resets the counter; 'failed' increments it.
 */
export function registerAttempt(
  goal: string,
  strategy: string,
  outcome: AttemptOutcome,
): LoopVerdict {
  const state = loadState();
  const goalKey = hashKey(goal);
  const strategyKey = hashKey(strategy);
  const now = new Date().toISOString();

  const existing = state.goals[goalKey];
  const sameStrategy = existing && existing.strategy === strategyKey;

  if (outcome === 'success') {
    // Success resets the counter for this goal/strategy.
    if (existing && sameStrategy) {
      existing.attempts = 0;
      existing.lastOutcome = 'success';
      existing.lastTimestamp = now;
      existing.lastFailure = '';
    } else {
      state.goals[goalKey] = {
        strategy: strategyKey,
        attempts: 0,
        lastOutcome: 'success',
        lastFailure: '',
        lastTimestamp: now,
      };
    }
    saveState(state);
    log(`SUCCESS goal=${goalKey} strategy=${strategyKey} — counter reset`);
    return {
      inLoop: false,
      goal,
      attempts: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      action: 'none',
      message: 'Attempt succeeded — no loop.',
      lastStrategy: strategy,
      lastFailure: '',
    };
  }

  // Failed attempt.
  if (existing && sameStrategy) {
    existing.attempts += 1;
    existing.lastOutcome = 'failed';
    existing.lastFailure = strategy;
    existing.lastTimestamp = now;
  } else {
    // New goal or changed strategy — start a fresh counter.
    state.goals[goalKey] = {
      strategy: strategyKey,
      attempts: 1,
      lastOutcome: 'failed',
      lastFailure: strategy,
      lastTimestamp: now,
    };
  }
  saveState(state);

  const attempts = state.goals[goalKey].attempts;
  log(`FAILED goal=${goalKey} strategy=${strategyKey} attempts=${attempts}`);

  return buildVerdict(goal, strategy, attempts);
}

/**
 * Check whether a goal is currently in a loop, without registering a new attempt.
 */
export function detectLoop(goal: string): LoopVerdict {
  const state = loadState();
  const goalKey = hashKey(goal);
  const existing = state.goals[goalKey];
  if (!existing) {
    return {
      inLoop: false,
      goal,
      attempts: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      action: 'none',
      message: 'No attempts recorded for this goal.',
      lastStrategy: '',
      lastFailure: '',
    };
  }
  return buildVerdict(goal, existing.lastFailure || existing.strategy, existing.attempts);
}

function buildVerdict(goal: string, strategy: string, attempts: number): LoopVerdict {
  if (attempts >= ESCALATE_AFTER) {
    return {
      inLoop: true,
      goal,
      attempts,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      action: 'escalate',
      message:
        `LOOP DETECTED: goal "${goal}" failed ${attempts} times with the same strategy. ` +
        `Escalating to user — STOP retrying and surface options.`,
      lastStrategy: strategy,
      lastFailure: strategy,
    };
  }
  if (attempts >= DEFAULT_MAX_ATTEMPTS) {
    return {
      inLoop: true,
      goal,
      attempts,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      action: 'change_strategy',
      message:
        `LOOP DETECTED: goal "${goal}" failed ${attempts} times with the same strategy. ` +
        `CHANGE STRATEGY — do not retry the same approach.`,
      lastStrategy: strategy,
      lastFailure: strategy,
    };
  }
  return {
    inLoop: false,
    goal,
    attempts,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    action: 'none',
    message: `Goal "${goal}" has ${attempts}/${DEFAULT_MAX_ATTEMPTS} failed attempts — not yet a loop.`,
    lastStrategy: strategy,
    lastFailure: strategy,
  };
}

/** Clear the attempt history for a goal. */
export function clearGoal(goal: string): void {
  const state = loadState();
  const goalKey = hashKey(goal);
  delete state.goals[goalKey];
  saveState(state);
  log(`CLEAR goal=${goalKey}`);
}

/** Get a summary of all tracked goals and active loops. */
export function getLoopStatus(): LoopStatus {
  const state = loadState();
  const goals: LoopStatus['goals'] = {};
  let activeLoops = 0;
  for (const [key, g] of Object.entries(state.goals)) {
    goals[key] = {
      attempts: g.attempts,
      inLoop: g.attempts >= DEFAULT_MAX_ATTEMPTS,
      lastOutcome: g.lastOutcome,
    };
    if (g.attempts >= DEFAULT_MAX_ATTEMPTS) activeLoops++;
  }
  return { activeLoops, goals };
}

// ─── CLI ──────────────────────────────────────────────────────────────

function printVerdict(v: LoopVerdict): void {
  console.log(JSON.stringify(v, null, 2));
}

function main(): void {
  const args = process.argv.slice(2);
  const action = args[0];

  if (action === 'register') {
    const goal = args[args.indexOf('--goal') + 1];
    const strategy = args[args.indexOf('--strategy') + 1];
    const outcome = (args[args.indexOf('--outcome') + 1] || 'failed') as AttemptOutcome;
    if (!goal || !strategy) {
      console.error('Usage: anti-loop-guard register --goal "..." --strategy "..." [--outcome failed|success]');
      process.exit(2);
    }
    printVerdict(registerAttempt(goal, strategy, outcome));
  } else if (action === 'detect') {
    const goal = args[args.indexOf('--goal') + 1];
    if (!goal) {
      console.error('Usage: anti-loop-guard detect --goal "..."');
      process.exit(2);
    }
    printVerdict(detectLoop(goal));
  } else if (action === 'status') {
    console.log(JSON.stringify(getLoopStatus(), null, 2));
  } else if (action === 'clear') {
    const goal = args[args.indexOf('--goal') + 1];
    if (!goal) {
      console.error('Usage: anti-loop-guard clear --goal "..."');
      process.exit(2);
    }
    clearGoal(goal);
    console.log(JSON.stringify({ cleared: goal }));
  } else {
    console.log('Anti-Loop Guard');
    console.log('  Commands: register, detect, status, clear');
    console.log('  register --goal "..." --strategy "..." [--outcome failed|success]');
    console.log('  detect --goal "..."');
    console.log('  status');
    console.log('  clear --goal "..."');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
