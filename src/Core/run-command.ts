#!/usr/bin/env node
/**
 * run-command.ts — Centralized command execution wrapper.
 *
 * Ensures ALL child processes in the stack:
 * 1. Use `windowsHide: true` (no flashing cmd windows on Windows)
 * 2. Use direct argv arrays instead of shell strings (no cmd.exe wrapping)
 * 3. Have consistent timeout handling
 * 4. Have consistent stdio configuration
 *
 * Usage:
 *   import { run, runSync } from './core/run-command.js';
 *
 *   // Async spawn (non-blocking)
 *   const child = run('npx', ['tsx', 'script.ts', '--arg'], { cwd: '/path' });
 *
 *   // Sync spawn (blocking)
 *   const result = runSync('npx', ['tsx', 'script.ts', '--arg']);
 *   console.log(result.stdout, result.stderr, result.status);
 *
 *   // Shell fallback (when you MUST use shell)
 *   const result = runSyncShell('npx tsx script.ts --arg');
 */

import {
  spawn,
  spawnSync,
  type SpawnOptions,
  type SpawnSyncOptions,
  type ChildProcess,
} from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

const TSX_LOADER = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

// ─── Types ────────────────────────────────────────────────────────────

export interface RunSyncResult {
  stdout: string;
  stderr: string;
  status: number | null;
  error: Error | null;
  signal: string | null;
}

export type RunOptions = Partial<SpawnOptions> &
  Partial<SpawnSyncOptions> & {
    cwd?: string;
    timeout?: number;
    env?: Record<string, string | undefined>;
    maxBuffer?: number;
    encoding?: BufferEncoding | 'utf-8';
  };

// ─── Defaults ─────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: SpawnOptions = {
  windowsHide: true, // CRITICAL: no flashing cmd windows on Windows
  stdio: 'pipe', // capture output by default
};

const DEFAULT_SYNC_OPTIONS: SpawnSyncOptions = {
  windowsHide: true, // CRITICAL: no flashing cmd windows on Windows
  stdio: 'pipe', // capture output by default
  encoding: 'utf-8' as const,
  maxBuffer: 1024 * 1024, // 1MB default
};

// ─── Async spawn ──────────────────────────────────────────────────────

/**
 * Spawn a child process with windowsHide:true enforced.
 * Use direct argv array — no shell wrapping.
 *
 * @param command - The command to run (e.g. 'npx', 'node', 'git')
 * @param args - Array of arguments (e.g. ['tsx', 'script.ts'])
 * @param options - Optional spawn options
 * @returns ChildProcess instance
 */
export function run(command: string, args: string[] = [], options: RunOptions = {}): ChildProcess {
  const spawnOpts: SpawnOptions = {
    ...(DEFAULT_OPTIONS as SpawnOptions),
    ...(options as SpawnOptions),
    cwd: options.cwd ?? process.cwd(),
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdio: options.stdio ?? 'pipe',
  };

  let cmd = command;
  let cmdArgs = args;
  if (isWindowsScript(command)) {
    const w = windowsScriptSpawn(command, args);
    cmd = w.command;
    cmdArgs = w.args;
    spawnOpts.shell = w.shell;
  } else if (process.platform === 'win32') {
    // Bare command may resolve to a .cmd/.bat shim via PATHEXT — route through shell
    const resolved = resolveWindowsCommand(command);
    if (resolved !== command && isWindowsScript(resolved)) {
      const w = windowsScriptSpawn(resolved, args);
      cmd = w.command;
      cmdArgs = w.args;
      spawnOpts.shell = w.shell;
    }
  }

  return spawn(cmd, cmdArgs, spawnOpts);
}

// ─── Windows .cmd/.bat support ────────────────────────────────────────
// On Windows, `.cmd`/`.bat` shims cannot be spawned directly (EINVAL) and
// passing args with `shell:true` triggers DEP0190. We build the command line
// ourselves and run it via the shell with NO args array — portable and warning-free.

const WINDOWS_SCRIPT_RE = /\.(cmd|bat)$/i;

function isWindowsScript(command: string): boolean {
  return process.platform === 'win32' && WINDOWS_SCRIPT_RE.test(command);
}

/**
 * On Windows, a bare command like `codegraph` may resolve via PATHEXT to a
 * `.cmd`/`.bat` shim (e.g. npm global shims). Node's spawnSync cannot execute
 * `.cmd`/`.bat` directly without a shell, so we resolve the real shim path and
 * route it through the shell wrapper. Returns the resolved command (unchanged
 * if it's a real executable or not found).
 */
function resolveWindowsCommand(command: string): string {
  if (process.platform !== 'win32' || WINDOWS_SCRIPT_RE.test(command)) return command;
  if (command.includes('\\') || command.includes('/')) return command; // explicit path

  const pathext = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const pathDirs = (process.env.PATH ?? '').split(';').filter(Boolean);

  for (const dir of pathDirs) {
    const base = join(dir, command);
    for (const ext of pathext) {
      const candidate = base + ext;
      if (existsSync(candidate)) return candidate;
    }
  }
  return command;
}

function quoteArg(a: string): string {
  return /[\s"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a;
}

function windowsScriptSpawn(
  command: string,
  args: string[],
): { command: string; args: string[]; shell: boolean } {
  return { command: [command, ...args].map(quoteArg).join(' '), args: [], shell: true };
}

// ─── Sync spawn ───────────────────────────────────────────────────────

/**
 * Spawn a child process synchronously with windowsHide:true enforced.
 * Use direct argv array — no shell wrapping.
 *
 * @param command - The command to run (e.g. 'npx', 'node', 'git')
 * @param args - Array of arguments (e.g. ['tsx', 'script.ts'])
 * @param options - Optional spawn options
 * @returns RunSyncResult with stdout, stderr, status, error
 */
export function runSync(
  command: string,
  args: string[] = [],
  options: RunOptions = {},
): RunSyncResult {
  const spawnOpts: SpawnSyncOptions = {
    ...(DEFAULT_SYNC_OPTIONS as SpawnSyncOptions),
    ...(options as SpawnSyncOptions),
    cwd: options.cwd ?? process.cwd(),
    timeout: options.timeout,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdio: options.stdio ?? 'pipe',
    maxBuffer: options.maxBuffer ?? 1024 * 1024,
  };

  let cmd = command;
  let cmdArgs = args;
  if (isWindowsScript(command)) {
    const w = windowsScriptSpawn(command, args);
    cmd = w.command;
    cmdArgs = w.args;
    spawnOpts.shell = w.shell;
  } else if (process.platform === 'win32') {
    // Bare command may resolve to a .cmd/.bat shim via PATHEXT — route through shell
    const resolved = resolveWindowsCommand(command);
    if (resolved !== command && isWindowsScript(resolved)) {
      const w = windowsScriptSpawn(resolved, args);
      cmd = w.command;
      cmdArgs = w.args;
      spawnOpts.shell = w.shell;
    }
  }

  try {
    const result = spawnSync(cmd, cmdArgs, spawnOpts);
    return {
      stdout: (result.stdout ?? '') as string,
      stderr: (result.stderr ?? '') as string,
      status: result.status,
      error: result.error ?? null,
      signal: result.signal,
    };
  } catch (err) {
    return {
      stdout: '',
      stderr: '',
      status: null,
      error: err instanceof Error ? err : new Error(String(err)),
      signal: null,
    };
  }
}

// ─── Shell fallback (only when necessary) ─────────────────────────────

/**
 * Run a command via shell with windowsHide:true.
 * USE ONLY when you need shell features (pipes, globs, redirects).
 * Prefer run()/runSync() with direct argv arrays.
 */
export function runSyncShell(command: string, options: RunOptions = {}): RunSyncResult {
  const isWindows = process.platform === 'win32';
  const shellCmd = isWindows ? process.env.ComSpec || 'cmd.exe' : '/bin/sh';
  const shellArgs = isWindows ? ['/d', '/s', '/c', command] : ['-c', command];

  const spawnOpts: SpawnSyncOptions = {
    ...DEFAULT_SYNC_OPTIONS,
    cwd: options.cwd ?? process.cwd(),
    timeout: options.timeout,
    env: options.env ? { ...process.env, ...options.env } : undefined,
    stdio: options.stdio ?? 'pipe',
    maxBuffer: options.maxBuffer ?? 1024 * 1024,
    windowsHide: true,
  };

  try {
    const result = spawnSync(shellCmd, shellArgs, spawnOpts);
    return {
      stdout: (result.stdout ?? '') as string,
      stderr: (result.stderr ?? '') as string,
      status: result.status,
      error: result.error ?? null,
      signal: result.signal,
    };
  } catch (err) {
    return {
      stdout: '',
      stderr: '',
      status: null,
      error: err instanceof Error ? err : new Error(String(err)),
      signal: null,
    };
  }
}

// ─── Windows-specific: npx wrapper ────────────────────────────────────

/**
 * Run a script with tsx (the most common pattern in the stack).
 *
 * Uses Node's in-process loader: `node --import tsx <script>`. The script runs
 * in the spawned node process itself — no shell, no `.cmd` shim, and critically
 * NO grandchild process. The previous form (delegating to the tsx CLI wrapper)
 * made it re-spawn the script as a grandchild WITHOUT `windowsHide`, so on
 * Windows every hidden/detached launcher leaked a visible console window
 * (flashing one-shots, lingering daemons). With `--import tsx` the child PID is
 * the real script process and inherits CREATE_NO_WINDOW.
 *
 * `tsx` must be resolvable from `options.cwd` (repo root and
 * apps/web-dashboard both install it locally).
 */
export function runNpxTsx(
  script: string,
  scriptArgs: string[] = [],
  options: RunOptions = {},
): ChildProcess {
  return run(process.execPath, ['--import', TSX_LOADER, script, ...scriptArgs], options);
}

/**
 * Run a script with tsx synchronously (same in-process loader form as runNpxTsx).
 */
export function runNpxTsxSync(
  script: string,
  scriptArgs: string[] = [],
  options: RunOptions = {},
): RunSyncResult {
  return runSync(process.execPath, ['--import', TSX_LOADER, script, ...scriptArgs], options);
}
