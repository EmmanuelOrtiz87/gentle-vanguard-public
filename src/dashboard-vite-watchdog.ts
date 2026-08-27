#!/usr/bin/env node
/**
 * Dashboard Vite Watchdog — auto-recovery launcher for the Vite dev server (UI).
 *
 * Mirrors the documented WS watchdog contract (dashboard-ws-autostart.ts):
 *   - 5s health-check interval
 *   - Restart after 2 consecutive failed checks
 *   - Up to 10 restarts; budget resets after 5 min of stable health
 *   - Single-instance guard via PID file (never two watchdogs concurrently)
 *   - Adopts an already-serving Vite instead of spawning a duplicate
 *   - Detached + windowsHide spawns (procesos-ocultos contract)
 *
 * Modes:
 *   (default)  One-shot: ensure Vite is running, then exit.
 *   --watch    Persistent watchdog loop with auto-restart.
 *
 * Usage:
 *   npx tsx src/dashboard-vite-watchdog.ts [--watch] [--port 5173]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { spawn } from 'child_process';
import { pathToFileURL } from 'url';
import {
  getFreePort,
  getProcessIdByPort,
  saveDashboardPorts,
  readDashboardPorts,
  isProcessAlive,
} from './dashboard-common';

const ROOT = path.resolve(process.cwd());
const RUNTIME_DIR = path.join(ROOT, '.runtime');
const WEB_APP_DIR = path.join(ROOT, 'apps', 'web-dashboard');
const VITE_CLI = path.join(WEB_APP_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
const PID_FILE = path.join(RUNTIME_DIR, 'dashboard-vite.pid');
const WATCHDOG_PID_FILE = path.join(RUNTIME_DIR, 'dashboard-vite-watchdog.pid');
const LOG_FILE = path.join(RUNTIME_DIR, 'dashboard-vite.log');

function log(message: string): void {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} | ${message}\n`, 'utf-8');
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** HTTP probe: any status < 500 counts as serving (Vite root returns 200). */
function healthCheck(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/`, { timeout: 3000 }, (res) => {
      resolve((res.statusCode ?? 500) < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

/** Preferred port: --port N > ports file > 5173 */
function preferredPort(): number {
  const idx = process.argv.indexOf('--port');
  if (idx > 0) {
    const n = parseInt(process.argv[idx + 1] || '0', 10);
    if (n > 0) return n;
  }
  return readDashboardPorts()?.vitePort || 5173;
}

/** WS backend port for the Vite proxy wiring. */
function wsPortForProxy(): number {
  return readDashboardPorts()?.wsPort || 8080;
}

// ── Watchdog tuning (same documented contract as the WS watchdog) ──
const WATCH_INTERVAL_MS = 5000;
const WATCH_FAILURE_THRESHOLD = 2;
const WATCH_MAX_RESTARTS = 10;
const WATCH_HEALTHY_RESET_MS = 300000;

/**
 * Launch Vite detached on the given port and wait (up to 20s) for it to serve.
 * The spawned PID IS the Vite process — no CLI wrapper, no grandchild,
 * no visible console on Windows (procesos-ocultos contract).
 */
async function launchVite(port: number): Promise<number> {
  const selectedPort = await getFreePort(port);
  log(`[START] Starting Vite on port ${selectedPort} (WS proxy → ${wsPortForProxy()})`);

  const child = spawn(process.execPath, [VITE_CLI, '--host', '--port', String(selectedPort)], {
    cwd: WEB_APP_DIR,
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
    env: {
      ...process.env,
      WS_PORT: String(wsPortForProxy()),
      VITE_DEV_PORT: String(selectedPort),
    },
  });
  child.unref();
  if (child.pid) fs.writeFileSync(PID_FILE, String(child.pid), 'utf-8');
  log(`[START] PID=${child.pid} port=${selectedPort}`);

  let healthy = false;
  for (let i = 0; i < 4; i++) {
    await sleep(5000);
    if (await healthCheck(selectedPort)) {
      healthy = true;
      break;
    }
  }

  // Defensive PID cross-check against the real port owner.
  const realPid = await getProcessIdByPort(selectedPort);
  if (realPid && realPid !== child.pid) {
    fs.writeFileSync(PID_FILE, String(realPid), 'utf-8');
    log(`[PID] Port owner PID=${realPid} differs from spawned PID=${child.pid} — corrected`);
  }

  if (healthy) log(`[OK] Vite healthy on port ${selectedPort} (PID=${realPid ?? child.pid})`);
  else log(`[WARN] Vite started but health check inconclusive (port=${selectedPort})`);
  return selectedPort;
}

/** Persistent watchdog loop — same structure as the WS watchLoop. */
async function watchLoop(initialPort: number): Promise<void> {
  let port = initialPort;
  let failures = 0;
  let restarts = 0;
  let lastHealthyAt = Date.now();

  log(
    `[WATCH] Monitoring Vite on port ${port} every ${WATCH_INTERVAL_MS / 1000}s ` +
      `(max ${WATCH_MAX_RESTARTS} restarts)`,
  );

  for (;;) {
    await sleep(WATCH_INTERVAL_MS);
    if (await healthCheck(port)) {
      if (failures > 0) log(`[WATCH] Vite recovered on port ${port}`);
      if (restarts > 0 && Date.now() - lastHealthyAt > WATCH_HEALTHY_RESET_MS) {
        restarts = 0;
        log('[WATCH] Restart budget reset after stable period');
      }
      failures = 0;
      lastHealthyAt = Date.now();
      continue;
    }

    failures++;
    log(`[WATCH] Health check FAILED (${failures}/${WATCH_FAILURE_THRESHOLD}) on port ${port}`);

    // Adopt a Vite that came up on another candidate port meanwhile.
    const alt =
      preferredPort() !== port && (await healthCheck(preferredPort())) ? preferredPort() : null;
    if (alt) {
      log(`[WATCH] Vite found on alternative port ${alt} — adopting`);
      port = alt;
      failures = 0;
      lastHealthyAt = Date.now();
      continue;
    }

    if (failures < WATCH_FAILURE_THRESHOLD) continue;

    if (restarts >= WATCH_MAX_RESTARTS) {
      log(`[WATCH] Max restart attempts (${WATCH_MAX_RESTARTS}) reached — watchdog exiting`);
      return;
    }

    restarts++;
    log(`[WATCH] Restarting Vite (attempt ${restarts}/${WATCH_MAX_RESTARTS})`);
    port = await launchVite(port);
    failures = 0;
  }
}

/** Main entry */
async function main(): Promise<number> {
  const watch = hasFlag('--watch');

  fs.mkdirSync(RUNTIME_DIR, { recursive: true });

  // Single-instance guard: never run two Vite watchdogs concurrently.
  try {
    const existingPid = parseInt(fs.readFileSync(WATCHDOG_PID_FILE, 'utf-8').trim(), 10);
    if (
      Number.isFinite(existingPid) &&
      existingPid > 0 &&
      existingPid !== process.pid &&
      isProcessAlive(existingPid)
    ) {
      log(`[SKIP] Vite watchdog already running (PID ${existingPid}) — not starting a duplicate`);
      return 0;
    }
  } catch {
    /* no PID file yet */
  }

  log(`[BOOT] Started dashboard-vite-watchdog.ts${watch ? ' (--watch)' : ''}`);
  fs.writeFileSync(WATCHDOG_PID_FILE, String(process.pid), 'utf-8');

  if (!fs.existsSync(VITE_CLI)) {
    log(`[ERR] vite.js not found at ${VITE_CLI} — run npm install in apps/web-dashboard`);
    console.error(`[DASHBOARD-VITE] vite.js not found at ${VITE_CLI}`);
    return 1;
  }

  // Adopt an already-serving Vite (idempotent boot).
  const desired = preferredPort();
  let port: number;
  if (await healthCheck(desired)) {
    log(`[SKIP] Vite already running on port ${desired} — adopting`);
    port = desired;
  } else {
    port = await launchVite(desired);
  }
  // Persist resolved ports so the dashboard wiring stays discoverable.
  saveDashboardPorts(wsPortForProxy(), port);

  if (watch) await watchLoop(port);
  else log('[DONE] One-shot complete — Vite ensured');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      log(`[FATAL] ${err instanceof Error ? err.stack || err.message : String(err)}`);
      console.error('[DASHBOARD-VITE] Fatal:', err);
      process.exit(1);
    });
}
