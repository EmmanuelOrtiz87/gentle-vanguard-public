#!/usr/bin/env node
/**
 * Gentle-Vanguard Analytics Launcher
 *
 * Single-shot launcher for the gv-analytics app (API + optional Vite UI):
 *   - Kills any leftover process bound to the configured port (default 4754).
 *   - Spawns the API server detached, writes `.runtime/gv-analytics-api.pid`.
 *   - Spawns the Vite dev server detached, writes `.runtime/gv-analytics-vite.pid`.
 *   - Cleans up pidfiles on SIGINT/SIGTERM.
 *
 * Pattern follows src/dashboard-cmd-launcher.ts (CMD native, no PowerShell,
 * `windowsHide:true`, daemon survives parent by design).
 *
 * CLI:
 *   node --import tsx src/gv-analytics-launcher.ts                # full start
 *   node --import tsx src/gv-analytics-launcher.ts --no-ui        # API only
 *   node --import tsx src/gv-analytics-launcher.ts --port 5000   # custom port
 */

import { spawn, execFile } from 'child_process';
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import * as http from 'http';

const ROOT = resolve(process.cwd());
const RUNTIME_DIR = join(ROOT, '.runtime');
const APP_DIR = join(ROOT, 'apps', 'gv-analytics');
const API_SCRIPT = join(APP_DIR, 'server', 'index.ts');
const API_PID = join(RUNTIME_DIR, 'gv-analytics-api.pid');
const VITE_PID = join(RUNTIME_DIR, 'gv-analytics-vite.pid');
const LOG_DIR = join(RUNTIME_DIR, 'gv-analytics');

const args = new Set(process.argv.slice(2));
const NO_UI = args.has('--no-ui');
const PORT = (() => {
  const idx = process.argv.indexOf('--port');
  return idx > 0 && process.argv[idx + 1] ? Number(process.argv[idx + 1]) : 4754;
})();

if (!existsSync(RUNTIME_DIR)) mkdirSync(RUNTIME_DIR, { recursive: true });
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

function log(scope: string, message: string): void {
  const line = `[${new Date().toISOString()}] [${scope}] ${message}`;
  console.log(line);
  try {
    writeFileSync(join(LOG_DIR, `${scope}.log`), line + '\n', { flag: 'a' });
  } catch {
    // log best-effort
  }
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const req = http.get(
      `http://127.0.0.1:${port}/api/connection/status`,
      { timeout: 2000 },
      (res) => {
        resolvePort(Boolean(res.statusCode) && res.statusCode! < 500);
      },
    );
    req.on('error', () => resolvePort(false));
    req.on('timeout', () => {
      req.destroy();
      resolvePort(false);
    });
  });
}

async function killPidFile(pidFile: string, label: string): Promise<void> {
  if (!existsSync(pidFile)) return;
  try {
    const pid = Number(readFileSync(pidFile, 'utf-8').trim());
    if (!Number.isFinite(pid)) {
      unlinkSync(pidFile);
      return;
    }
    await new Promise<void>((done) => {
      execFile('taskkill', ['/PID', String(pid), '/F', '/T'], { windowsHide: true }, () => {
        log('cleanup', `taskkill PID ${pid} (${label})`);
        done();
      });
    });
  } catch (error) {
    log('cleanup', `could not kill ${label}: ${(error as Error).message}`);
  } finally {
    try {
      unlinkSync(pidFile);
    } catch {
      // pidfile may have been removed by the killed process
    }
  }
}

async function freePort(port: number): Promise<void> {
  const inUse = await isPortInUse(port);
  if (!inUse) return;
  log('cleanup', `port ${port} in use, attempting to free it`);
  // Try existing pidfile first.
  await killPidFile(API_PID, 'previous API');
  await new Promise((r) => setTimeout(r, 400));
  // Fallback: ask Windows which PID owns the port and taskkill it.
  try {
    const { stdout } = await new Promise<{ stdout: string }>((done, fail) => {
      execFile(
        'netstat',
        ['-ano', '-p', 'tcp'],
        { windowsHide: true, encoding: 'utf-8' },
        (error, out) => (error ? fail(error) : done({ stdout: out })),
      );
    });
    const lines = stdout.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(new RegExp(`[:.]${port}\\s`));
      if (!match) continue;
      const parts = line.trim().split(/\s+/);
      const pid = Number(parts[parts.length - 1]);
      if (Number.isFinite(pid) && pid > 0) {
        await new Promise<void>((doneKill) => {
          execFile('taskkill', ['/PID', String(pid), '/F', '/T'], { windowsHide: true }, () =>
            doneKill(),
          );
        });
        log('cleanup', `freed port ${port} from PID ${pid}`);
      }
    }
  } catch (error) {
    log('cleanup', `netstat fallback failed: ${(error as Error).message}`);
  }
}

function spawnDetached(
  scope: string,
  script: string,
  env: Record<string, string>,
  pidFile: string,
  cwd: string = ROOT,
): number {
  const child = spawn(process.execPath, ['--import', 'tsx', script], {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
  });
  if (!child.pid) {
    throw new Error(`${scope} failed to spawn`);
  }
  writeFileSync(pidFile, String(child.pid), 'utf-8');
  child.unref();
  log(scope, `spawned PID ${child.pid} (${script})`);
  return child.pid;
}

function registerCleanup(): void {
  const cleanup = (signal: NodeJS.Signals) => {
    log('shutdown', `received ${signal}, cleaning up`);
    for (const pidFile of [API_PID, VITE_PID]) {
      try {
        if (existsSync(pidFile)) {
          const pid = Number(readFileSync(pidFile, 'utf-8').trim());
          if (Number.isFinite(pid)) {
            execFile(
              'taskkill',
              ['/PID', String(pid), '/F', '/T'],
              { windowsHide: true },
              () => undefined,
            );
          }
          unlinkSync(pidFile);
        }
      } catch {
        // best-effort
      }
    }
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

async function main(): Promise<void> {
  registerCleanup();
  await killPidFile(API_PID, 'stale API pidfile');
  await killPidFile(VITE_PID, 'stale Vite pidfile');
  await freePort(PORT);

  spawnDetached('api', API_SCRIPT, { GV_ANALYTICS_PORT: String(PORT) }, API_PID);

  if (!NO_UI) {
    const viteScript = join(APP_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
    // cwd must be APP_DIR: vite resolves vite.config.ts (port 5174, root=dist
    // proxy targets) relative to the process cwd. With the repo root as cwd it
    // fell back to defaults (port 5173, wrong root) and the UI never came up.
    spawnDetached('vite', viteScript, { GV_ANALYTICS_PORT: String(PORT) }, VITE_PID, APP_DIR);
  }

  // Verify API is up before exiting the launcher.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((r) => setTimeout(r, 600));
    if (await isPortInUse(PORT)) {
      log('ready', `API on http://127.0.0.1:${PORT} (pidfile ${API_PID})`);
      return;
    }
  }
  log('warn', `API did not respond on :${PORT} within 6s — check ${LOG_DIR}/api.log`);
}

main().catch((error) => {
  log('fatal', error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
