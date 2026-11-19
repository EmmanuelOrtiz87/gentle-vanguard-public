#!/usr/bin/env node
/**
 * lazy-step-runner — one detached wrapper per lazy autostart step.
 *
 * The autostart parent exits right after launching lazy steps, so it can never
 * observe their exit codes. This wrapper owns the real child, waits for it, and
 * records the outcome in .runtime/autostart-lazy-results/<step>.json so failures
 * stop being invisible.
 */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { run, runNpxTsx } from './run-command.js';

const ROOT = resolve(process.cwd());
const RESULTS_DIR = join(ROOT, '.runtime', 'autostart-lazy-results');

interface RunnerArgs {
  id: string;
  script: string;
  timeoutMs: number;
  scriptArgs: string[];
  /** El step es un daemon: se larga y NO se espera su salida. */
  daemon: boolean;
  /** Codigos de salida validos (ademas de 0) que no cuentan como fallo. */
  allowExitCodes: number[];
}

function parseArgs(argv: string[]): RunnerArgs {
  let id = '';
  let script = '';
  let timeoutMs = 10 * 60_000;
  let daemon = false;
  let allowExitCodes: number[] = [];
  const scriptArgs: string[] = [];
  let passthrough = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (passthrough) {
      scriptArgs.push(arg);
      continue;
    }
    if (arg === '--') {
      passthrough = true;
      continue;
    }
    if (arg === '--id') id = argv[++i] ?? '';
    else if (arg === '--script') script = argv[++i] ?? '';
    else if (arg === '--timeout') timeoutMs = Number(argv[++i]) || timeoutMs;
    else if (arg === '--daemon') daemon = true;
    else if (arg === '--allow-exit-codes') {
      allowExitCodes = (argv[++i] ?? '')
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value));
    } else if (arg.startsWith('--allow-exit-codes=')) {
      allowExitCodes = arg
        .slice('--allow-exit-codes='.length)
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value));
    }
  }
  return { id, script, timeoutMs, scriptArgs, daemon, allowExitCodes };
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function writeResult(id: string, payload: Record<string, unknown>): void {
  try {
    mkdirSync(RESULTS_DIR, { recursive: true });
    const target = join(RESULTS_DIR, `${safeId(id)}.json`);
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2));
    renameSync(tmp, target);
  } catch {
    /* a lost result must never crash the lazy runner */
  }
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
}

function isAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function main(): void {
  const { id, script, timeoutMs, scriptArgs, daemon, allowExitCodes } = parseArgs(
    process.argv.slice(2),
  );
  if (!id || !script) {
    writeResult(id || 'invalid', { status: 'failed', error: 'missing --id/--script' });
    process.exit(2);
  }

  const scriptPath = resolve(ROOT, script);
  const startedAt = new Date().toISOString();
  writeResult(id, {
    id,
    status: 'running',
    pid: process.pid,
    startedAt,
    timeoutMs,
    script,
    daemon,
  });

  const child = scriptPath.endsWith('.ts')
    ? runNpxTsx(scriptPath, scriptArgs, {
        cwd: ROOT,
        stdio: 'inherit',
        windowsHide: true,
        detached: daemon,
      })
    : scriptPath.endsWith('.ps1')
      ? run('pwsh', ['-NoProfile', '-File', scriptPath, ...scriptArgs], {
          cwd: ROOT,
          stdio: 'inherit',
          windowsHide: true,
          detached: daemon,
        })
      : run(scriptPath, scriptArgs, {
          cwd: ROOT,
          stdio: 'inherit',
          windowsHide: true,
          detached: daemon,
        });

  // ─── Modo daemon ─────────────────────────────────────────────────────────
  // Un daemon NO termina (es un watcher). Antes el runner lo esperaba, lo
  // mataba al timeout y dejaba el pidfile stale: el proceso que el step
  // acababa de arrancar moria antes de hacer su trabajo (medido 2026-11-18:
  // `token-ingest-init` --watch 30 moria por timeout y su pidfile quedaba
  // apuntando a un PID muerto).
  if (daemon) {
    child.unref();
    const childPid = child.pid ?? null;
    let settledDaemon = false;
    // Un daemon puede salir LIMPIO en los primeros segundos porque otra
    // instancia ya es dueña del pidfile (dedupe). Eso NO es un fallo: el
    // objetivo —que el daemon este corriendo— se cumple igual. Antes se
    // reportaba como "el daemon murio en los primeros 2s" → FAIL falso
    // (medido 2026-11-18 con token-spike-guard).
    child.on('close', (code, signal) => {
      if (settledDaemon) return;
      settledDaemon = true;
      const allowed = code !== null && allowExitCodes.includes(code);
      const ok = code === 0 || allowed;
      writeResult(id, {
        id,
        status: ok ? 'daemon' : 'failed',
        pid: process.pid,
        childPid,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - Date.parse(startedAt),
        timeoutMs,
        daemon: true,
        script,
        exitCode: code,
        signal,
        allowedExitCode: allowed,
        ...(ok
          ? { note: 'otra instancia del daemon es dueña (dedupe por pidfile)' }
          : { error: `el daemon salio con codigo ${code}` }),
      });
      process.exit(0);
    });
    setTimeout(() => {
      if (settledDaemon) return;
      settledDaemon = true;
      const alive = isAlive(child.pid);
      writeResult(id, {
        id,
        status: alive ? 'daemon' : 'failed',
        pid: process.pid,
        childPid,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - Date.parse(startedAt),
        timeoutMs,
        daemon: true,
        script,
        ...(alive ? {} : { error: 'el daemon murio en los primeros 2s' }),
      });
      process.exit(0);
    }, 2000);
    return;
  }

  let settled = false;
  const finish = (exitCode: number | null, signal: NodeJS.Signals | null, timedOut: boolean) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    const finishedAt = new Date().toISOString();
    const allowed = exitCode !== null && allowExitCodes.includes(exitCode);
    writeResult(id, {
      id,
      status: timedOut ? 'timeout' : exitCode === 0 || allowed ? 'ok' : 'failed',
      pid: process.pid,
      childPid: child.pid ?? null,
      startedAt,
      finishedAt,
      durationMs: Date.now() - Date.parse(startedAt),
      timeoutMs,
      exitCode,
      signal,
      timedOut,
      allowedExitCode: allowed,
      script,
    });
    process.exit(0);
  };

  const timer = setTimeout(() => {
    killTree(child.pid);
    finish(null, null, true);
  }, timeoutMs);

  child.on('close', (code, signal) => finish(code, signal, false));
  child.on('error', (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    writeResult(id, {
      id,
      status: 'failed',
      pid: process.pid,
      childPid: child.pid ?? null,
      startedAt,
      finishedAt: new Date().toISOString(),
      timeoutMs,
      error: error.message,
      script,
    });
    process.exit(0);
  });
}

main();
