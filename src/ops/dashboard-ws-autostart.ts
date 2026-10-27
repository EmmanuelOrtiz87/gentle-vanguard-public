#!/usr/bin/env node
/**
 * Dashboard WS Autostart — watchdog launcher for the WebSocket metrics server.
 * TS migration of scripts/utilities/dashboard/dashboard-ws-autostart.ps1
 *
 * Starts websocket-server.ts as a detached background process with
 * auto-recovery watchdog monitoring. Uses windowsHide to avoid popup consoles.
 *
 * Modes:
 *   (default)  One-shot: ensure the WS server is running, then exit.
 *   --watch    Persistent watchdog: keep monitoring every 5s and restart the
 *              server on health-check failure (up to 10 restarts). Restores
 *              the auto-recovery contract documented in AGENTS.md that was
 *              lost in the PS1→TS migration.
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
  logToFile,
  openDashboardServerStderr,
  removeFile,
  isProcessAlive,
} from './dashboard-common';

const ROOT = path.resolve(process.cwd());
const RUNTIME_DIR = path.join(ROOT, '.runtime');
const WS_SERVER_DIR = path.join(ROOT, 'apps', 'web-dashboard');
const WS_SCRIPT = path.join(WS_SERVER_DIR, 'server', 'websocket-server.ts');
const PID_FILE = path.join(RUNTIME_DIR, 'dashboard-ws.pid');
const WATCHDOG_PID_FILE = path.join(RUNTIME_DIR, 'dashboard-ws-watchdog.pid');

/** HTTP liveness check against localhost:port/api/health/live — with 1 soft retry.
 *  A cached repository-health refresh can briefly block the server event loop,
 *  so allow headroom before treating it as unavailable. */
function healthCheck(port: number): Promise<boolean> {
  const once = (): Promise<boolean> =>
    new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/api/health/live`, { timeout: 5000 }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  // soft retry: a flake must fail TWICE in the same check to count as failure
  return once().then((ok) => (ok ? ok : once()));
}

/** Clean stale PID files but keep configured ports so the server can restart on them. */
function cleanStaleFiles(): void {
  for (const f of [PID_FILE, WATCHDOG_PID_FILE]) {
    try {
      if (!fs.existsSync(f)) continue;
      const content = fs.readFileSync(f, 'utf-8').trim();
      const pid = /^\d+$/.test(content) ? Number(content) : 0;
      if (!pid || !isProcessAlive(pid)) removeFile(f);
    } catch {
      removeFile(f);
    }
  }
}

/** CLI flag helper */
function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

/**
 * Launch the WS server detached on a free port and wait (up to 20s) for it to
 * become healthy. Returns the port the server was launched on.
 */
async function launchServer(preferredPort = 0): Promise<number> {
  const defaultPort = (() => {
    const ports = readDashboardPorts();
    return ports?.wsPort || 8080;
  })();
  const selectedPort = await getFreePort(preferredPort > 0 ? preferredPort : defaultPort);

  logToFile(`[PORT] selected=${selectedPort}`);
  // Preserve existing vitePort instead of overwriting with 0
  const existingPorts = readDashboardPorts();
  saveDashboardPorts(selectedPort, existingPorts?.vitePort ?? 0);

  // Start WS server detached with windowsHide
  logToFile(`[START] Starting WS server on port ${selectedPort}`);

  // Load tsx in-process (`node --import tsx`). The spawned PID IS the server
  // process — no CLI wrapper, no grandchild, no visible console on Windows.
  const stderrFd = openDashboardServerStderr();
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(process.execPath, ['--import', 'tsx', WS_SCRIPT], {
      cwd: WS_SERVER_DIR,
      stdio: ['ignore', 'ignore', stderrFd],
      detached: true,
      windowsHide: true,
      env: {
        ...process.env,
        WS_PORT: String(selectedPort),
      },
    });
  } finally {
    fs.closeSync(stderrFd);
  }
  child.on('error', (err) => logToFile(`[START] WS server spawn failed: ${err.message}`));

  child.unref();
  const procId = child.pid;
  fs.writeFileSync(PID_FILE, String(procId), 'utf-8');

  logToFile(`[START] PID=${procId} port=${selectedPort}`);

  // Wait up to 20s for server to become healthy. Health check is truth —
  // the PID file below already points at the real server process.
  let healthy = false;
  for (let i = 0; i < 4; i++) {
    await sleep(5000);
    const ok = await healthCheck(selectedPort);
    if (ok) {
      healthy = true;
      break;
    }
  }

  // Cross-check the server PID against the port owner (defensive: catches
  // stale PID files from older launches). This is what the watchtower and
  // stop scripts use.
  const realPid = await getProcessIdByPort(selectedPort);
  if (realPid && realPid !== procId) {
    fs.writeFileSync(PID_FILE, String(realPid), 'utf-8');
    logToFile(`[PID] Port owner PID=${realPid} differs from spawned PID=${procId} — corrected`);
  }

  if (healthy) {
    logToFile(`[OK] WS healthy on port ${selectedPort} (PID=${realPid ?? procId})`);
  } else {
    logToFile(
      `[WARN] WS process started but health check inconclusive (PID=${procId} port=${selectedPort})`,
    );
  }
  return selectedPort;
}

// ── Watchdog tuning (documented contract: 5s interval, up to 10 restarts) ──
const WATCH_INTERVAL_MS = 5000;
const WATCH_FAILURE_THRESHOLD = 2; // consecutive failed checks before restart
const WATCH_MAX_RESTARTS = 10;
const WATCH_HEALTHY_RESET_MS = 300000; // 5 min stable → restart budget resets

/** Check standard candidate ports (excluding one) for an already-running WS. */
async function findHealthyCandidatePort(excludePort: number): Promise<number | null> {
  for (const p of getCandidatePorts()) {
    if (p === excludePort) continue;
    if (await healthCheck(p)) return p;
  }
  return null;
}

function getCandidatePorts(): number[] {
  const configuredPort = readDashboardPorts()?.wsPort;
  return [configuredPort, 8080, 8081, 8082, 8083].filter(
    (port, index, ports): port is number =>
      typeof port === 'number' &&
      Number.isInteger(port) &&
      port > 0 &&
      port <= 65535 &&
      ports.indexOf(port) === index,
  );
}

/**
 * Persistent watchdog loop: monitors the WS server every WATCH_INTERVAL_MS and
 * restarts it when consecutive health checks fail (max WATCH_MAX_RESTARTS).
 */
async function watchLoop(initialPort: number): Promise<void> {
  let port = initialPort;
  let failures = 0;
  let restarts = 0;
  let lastHealthyAt = Date.now();

  logToFile(
    `[WATCH] Monitoring WS server on port ${port} every ${WATCH_INTERVAL_MS / 1000}s ` +
      `(max ${WATCH_MAX_RESTARTS} restarts)`,
  );

  for (;;) {
    await sleep(WATCH_INTERVAL_MS);
    const ok = await healthCheck(port);
    if (ok) {
      if (failures > 0) logToFile(`[WATCH] WS recovered on port ${port}`);
      if (restarts > 0 && Date.now() - lastHealthyAt > WATCH_HEALTHY_RESET_MS) {
        restarts = 0;
        logToFile('[WATCH] Restart budget reset after stable period');
      }
      failures = 0;
      lastHealthyAt = Date.now();
      continue;
    }

    failures++;
    logToFile(
      `[WATCH] Health check FAILED (${failures}/${WATCH_FAILURE_THRESHOLD}) on port ${port}`,
    );

    // Adopt a server that came up on another candidate port meanwhile.
    const alt = await findHealthyCandidatePort(port);
    if (alt) {
      logToFile(`[WATCH] WS found on alternative port ${alt} — adopting`);
      port = alt;
      failures = 0;
      lastHealthyAt = Date.now();
      continue;
    }

    if (failures < WATCH_FAILURE_THRESHOLD) continue;

    if (restarts >= WATCH_MAX_RESTARTS) {
      logToFile(`[WATCH] Max restart attempts (${WATCH_MAX_RESTARTS}) reached — watchdog exiting`);
      return;
    }

    restarts++;
    logToFile(`[WATCH] Restarting WS server (attempt ${restarts}/${WATCH_MAX_RESTARTS})`);
    // Kill the unhealthy previous server BEFORE spawning a replacement.
    // Without this, every restart leaks one more websocket-server process
    // (duplicate source confirmed 2026-08-27: 4 leaked servers under one
    // watchdog; process-hygiene reaped them but the source must not leak).
    try {
      const prevRaw = fs.readFileSync(PID_FILE, 'utf-8').trim();
      const prev = parseInt(prevRaw, 10);
      if (Number.isFinite(prev) && prev > 0 && prev !== process.pid && isProcessAlive(prev)) {
        // Tree kill: the server spawns skill-server children that must die
        // with it (taskkill /T on Windows, SIGKILL elsewhere).
        if (process.platform === 'win32') {
          spawn('taskkill', ['/T', '/F', '/PID', String(prev)], {
            stdio: 'ignore',
            windowsHide: true,
          });
        } else {
          try {
            process.kill(prev, 'SIGKILL');
          } catch {
            /* already gone */
          }
        }
        logToFile(`[WATCH] Killed unhealthy previous server PID=${prev} before relaunch`);
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch {
      /* no readable pidfile → nothing to kill */
    }
    port = await launchServer(port);
    failures = 0;
  }
}

/** Main autostart logic */
async function main(overridePort?: number): Promise<number> {
  const portArgIdx = process.argv.indexOf('--port');
  const preferredPort =
    overridePort ?? (portArgIdx > 0 ? parseInt(process.argv[portArgIdx + 1] || '0', 10) : 0);
  const watch = hasFlag('--watch');

  // Ensure runtime dir
  if (!fs.existsSync(RUNTIME_DIR)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  }

  // Single-instance guard: never run two watchdogs concurrently (a duplicate
  // would double-spawn servers on failure and race over the PID files).
  try {
    const existing = fs.readFileSync(WATCHDOG_PID_FILE, 'utf-8').trim();
    const existingPid = parseInt(existing, 10);
    if (
      Number.isFinite(existingPid) &&
      existingPid > 0 &&
      existingPid !== process.pid &&
      isProcessAlive(existingPid)
    ) {
      logToFile(`[SKIP] Watchdog already running (PID ${existingPid}) — not starting a duplicate`);
      return 0;
    }
  } catch {
    /* no PID file yet */
  }

  logToFile(`[BOOT] Started dashboard-ws-autostart.ts${watch ? ' (--watch)' : ''}`);

  // Write watchdog PID
  fs.writeFileSync(WATCHDOG_PID_FILE, String(process.pid), 'utf-8');

  // Clean stale files
  cleanStaleFiles();

  // Verify websocket-server.ts exists
  if (!fs.existsSync(WS_SCRIPT)) {
    const err = `websocket-server.ts not found at ${WS_SCRIPT}`;
    logToFile(`[ERR] ${err}`);
    console.error(`[DASHBOARD-WS] ${err}`);
    return 1;
  }

  // Check if WS server already running
  let adoptedPort: number | null = null;
  for (const testPort of getCandidatePorts()) {
    const ok = await healthCheck(testPort);
    if (ok) {
      adoptedPort = testPort;
      break;
    }
  }

  if (adoptedPort !== null) {
    logToFile(`[SKIP] WS already running on port ${adoptedPort}`);
    saveDashboardPorts(adoptedPort, readDashboardPorts()?.vitePort ?? 0);
    if (watch) await watchLoop(adoptedPort);
    return 0;
  }

  const port = await launchServer(preferredPort);
  if (watch) await watchLoop(port);
  return 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Entry (ESM) ──
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Graceful shutdown: only remove the PID file if we still own it, so
  // dashboard-stop.ts (which kills us and unlinks the file itself) never races.
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      logToFile(`[WATCH] Received ${sig} — watchdog exiting`);
      try {
        if (fs.readFileSync(WATCHDOG_PID_FILE, 'utf-8').trim() === String(process.pid)) {
          fs.unlinkSync(WATCHDOG_PID_FILE);
        }
      } catch {
        /* file already gone */
      }
      process.exit(0);
    });
  }

  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('[DASHBOARD-WS] Fatal:', err);
      process.exit(1);
    });
}

export { main as startWsServer };
