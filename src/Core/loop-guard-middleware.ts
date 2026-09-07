#!/usr/bin/env node
/**
 * Loop Guard Middleware - Easy integration for any workflow
 *
 * This is a simple middleware that wraps any async function and checks
 * for loops before/during execution. Use this to protect any workflow.
 *
 * Usage:
 *   import { withLoopGuard } from './loop-guard-middleware.js';
 *
 *   const safeTask = withLoopGuard(myTask, {
 *     taskName: 'my-task',
 *     maxRetries: 2
 *   });
 *   await safeTask();
 *
 * CLI for direct use:
 *   npx tsx src/core/loop-guard-middleware.ts --task "verify files" --command "npm run lint"
 */

import { pathToFileURL } from 'url';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { runSync } from './run-command.js';

const ROOT = resolve(process.cwd());
const SESSION_DIR = join(ROOT, '.session');
const STATE_FILE = join(SESSION_DIR, 'loop-guard-state.json');

export interface LoopGuardConfig {
  /** Name for this specific task (for logging) */
  taskName: string;
  /** Maximum retries before giving up */
  maxRetries: number;
  /** Fail immediately on loop detection */
  failFast: boolean;
  /** Log level */
  verbose: boolean;
}

const DEFAULT_CONFIG: LoopGuardConfig = {
  taskName: 'unknown',
  maxRetries: 3,
  failFast: true,
  verbose: false,
};

/**
 * State management
 */
interface LoopState {
  taskHistory: Record<string, TaskEntry[]>;
  loopDetected: boolean;
  lastLoopKind?: string;
  lastLoopTime?: string;
}

interface TaskEntry {
  task: string;
  timestamp: string;
  completed: boolean;
}

function loadState(): LoopState {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch {
    /* ignore */
  }
  return { taskHistory: {}, loopDetected: false };
}

function saveState(state: LoopState): void {
  mkdirSync(SESSION_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Check if a specific task is in a loop
 */
function checkTaskLoop(
  taskName: string,
  state: LoopState,
): {
  inLoop: boolean;
  kind?: string;
  count: number;
} {
  const history = state.taskHistory[taskName] || [];

  // Need at least 3 attempts to detect loop
  if (history.length < 3) {
    return { inLoop: false, count: history.length };
  }

  const recent = history.slice(-3);

  // Check for repeated failed attempts
  if (recent.every((h) => !h.completed)) {
    return { inLoop: true, kind: 'repeated-failure', count: recent.length };
  }

  // Check for alternating pattern (A-fail, B-fail, A-fail)
  if (recent.length >= 4) {
    const pattern = recent.map((h) => h.task).join('-');
    if (pattern.includes(taskName) && pattern.split(taskName).length >= 3) {
      // Check if alternating
      const tasks = recent.map((h) => h.task);
      if (tasks[0] === tasks[2] && tasks[1] !== tasks[0]) {
        return { inLoop: true, kind: 'alternating', count: recent.length };
      }
    }
  }

  return { inLoop: false, count: history.length };
}

/**
 * Wrap a function with loop protection
 */
export function withLoopGuard<T extends (...args: any[]) => any>(
  fn: T,
  config: Partial<LoopGuardConfig> = {},
): T {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    const state = loadState();
    const taskName = cfg.taskName;

    // Check for loop before executing
    const { inLoop, kind, count } = checkTaskLoop(taskName, state);

    if (inLoop) {
      const error = new Error(
        `LOOP DETECTED: Task "${taskName}" failed ${count} times consecutively (kind: ${kind}). ` +
          `Aborting to prevent infinite loop.`,
      );
      (error as any).loopDetected = true;
      (error as any).loopKind = kind;
      throw error;
    }

    // Track this attempt
    if (!state.taskHistory[taskName]) {
      state.taskHistory[taskName] = [];
    }

    const entry: TaskEntry = {
      task: taskName,
      timestamp: new Date().toISOString(),
      completed: false,
    };

    state.taskHistory[taskName].push(entry);

    // Trim history to last 10 entries per task
    if (state.taskHistory[taskName].length > 10) {
      state.taskHistory[taskName] = state.taskHistory[taskName].slice(-10);
    }

    saveState(state);

    if (cfg.verbose) {
      console.log(`[LOOP-GUARD] Starting task: ${taskName}`);
    }

    try {
      const result = await fn(...args);

      // Mark as completed successfully
      const history = state.taskHistory[taskName];
      if (history.length > 0) {
        history[history.length - 1].completed = true;
      }

      // Reset loop detection on success
      state.loopDetected = false;
      state.lastLoopKind = undefined;
      saveState(state);

      if (cfg.verbose) {
        console.log(`[LOOP-GUARD] Task completed: ${taskName}`);
      }

      return result;
    } catch (error) {
      // Mark as failed (already done - completed: false)
      saveState(state);

      if (cfg.verbose) {
        console.log(`[LOOP-GUARD] Task failed: ${taskName}`);
      }

      // Check if we should retry
      const currentCount = (state.taskHistory[taskName] || []).length;
      if (currentCount >= cfg.maxRetries) {
        state.loopDetected = true;
        state.lastLoopKind = 'max-retries-exceeded';
        state.lastLoopTime = new Date().toISOString();
        saveState(state);

        if (cfg.failFast) {
          throw error;
        }
      }

      throw error;
    }
  }) as T;
}

/**
 * Reset loop state for a specific task
 */
export function resetLoopState(taskName?: string): void {
  const state = loadState();

  if (taskName) {
    delete state.taskHistory[taskName];
    console.log(`[LOOP-GUARD] Reset state for task: ${taskName}`);
  } else {
    state.taskHistory = {};
    console.log(`[LOOP-GUARD] Reset all loop state`);
  }

  state.loopDetected = false;
  state.lastLoopKind = undefined;
  saveState(state);
}

/**
 * Get current loop status
 */
export function getLoopStatus(taskName?: string): object {
  const state = loadState();

  if (taskName) {
    const history = state.taskHistory[taskName] || [];
    const { inLoop, kind, count } = checkTaskLoop(taskName, state);
    return {
      task: taskName,
      inLoop,
      loopKind: kind,
      attemptCount: count,
      history: history.slice(-5),
    };
  }

  // Return all tasks
  const allStatus = Object.keys(state.taskHistory || {}).map((task) => {
    const { inLoop, kind, count } = checkTaskLoop(task, state);
    return { task, inLoop, loopKind: kind, attemptCount: count };
  });

  return {
    overallLoopDetected: state.loopDetected,
    lastLoopKind: state.lastLoopKind,
    lastLoopTime: state.lastLoopTime,
    tasks: allStatus,
  };
}

// CLI
function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--reset')) {
    const taskIndex = args.indexOf('--task');
    const task = taskIndex >= 0 ? args[taskIndex + 1] : undefined;
    resetLoopState(task);
    return;
  }

  if (args.includes('--status')) {
    const taskIndex = args.indexOf('--task');
    const task = taskIndex >= 0 ? args[taskIndex + 1] : undefined;
    console.log(JSON.stringify(getLoopStatus(task), null, 2));
    return;
  }

  // Example: run a command with loop guard
  if (args.includes('--task') && args.includes('--command')) {
    const taskIndex = args.indexOf('--task');
    const cmdIndex = args.indexOf('--command');
    const task = args[taskIndex + 1];
    const command = args.slice(cmdIndex + 1).join(' ');

    const safeCommand = withLoopGuard(
      async () => {
        console.log(`[LOOP-GUARD] Executing: ${command}`);
        return runSync('pwsh', ['-Command', command], { timeout: 120000 });
      },
      { taskName: task, verbose: true },
    );

    safeCommand()
      .then((result) => {
        console.log(`[LOOP-GUARD] Result: ${result.status}`);
        process.exit(result.status);
      })
      .catch((err) => {
        console.error(`[LOOP-GUARD] Error: ${err.message}`);
        process.exit(1);
      });
    return;
  }

  console.log('Loop Guard Middleware');
  console.log('');
  console.log('Usage:');
  console.log('  --reset [--task <name>]   Reset loop state');
  console.log('  --status [--task <name>]  Get loop status');
  console.log('  --task <name> --command <cmd>  Run command with loop protection');
  console.log('');
  console.log('Integration in code:');
  console.log('  import { withLoopGuard } from "./loop-guard-middleware.js"');
  console.log('  const safeTask = withLoopGuard(myAsyncFunction, { taskName: "my-task" });');
  console.log('  await safeTask();');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
