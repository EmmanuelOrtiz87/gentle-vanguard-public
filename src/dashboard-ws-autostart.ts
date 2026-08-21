#!/usr/bin/env node
/**
 * Dashboard WS Autostart — watchdog launcher for the WebSocket metrics server.
 * TS migration of scripts/utilities/dashboard/dashboard-ws-autostart.ps1
 *
 * Starts websocket-server.ts as a detached background process with
 * auto-recovery watchdog monitoring. Uses windowsHide to avoid popup consoles.
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
  removeFile,
  isProcessAlive,
} from './dashboard-common';

const ROOT = path.resolve(process.cwd());
const RUNTIME_DIR = path.join(ROOT, '.runtime');
const WS_SERVER_DIR = path.join(ROOT, 'apps', 'web-dashboard');
const WS_SCRIPT = path.join(WS_SERVER_DIR, 'server', 'websocket-server.ts');
const PID_FILE = path.join(RUNTIME_DIR, 'dashboard-ws.pid');
const WATCHDOG_PID_FILE = path.join(RUNTIME_DIR, 'dashboard-ws-watchdog.pid');

/** HTTP health check against localhost:port/api/health */
function healthCheck(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/health`, { timeout: 3000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Clean stale PID/port files */
function cleanStaleFiles(): void {
  const filesToCheck = [
    PID_FILE,
    WATCHDOG_PID_FILE,
    path.join(RUNTIME_DIR, 'dashboard-ports.json'),
  ];

  for (const f of filesToCheck) {
    try {
      if (!fs.existsSync(f)) continue;
      const content = fs.readFileSync(f, 'utf-8').trim();

      if (/^\d+$/.test(content)) {
        const pid = parseInt(content, 10);
        if (!isProcessAlive(pid)) removeFile(f);
      } else if (content.includes('"wsPort"')) {
        try {
          const ports = JSON.parse(content);
          if (ports.wsPort) {
            const exists = awaitExists(ports.wsPort);
            if (!exists) removeFile(f);
          }
        } catch {
          removeFile(f);
        }
      } else {
        removeFile(f);
      }
    } catch {
      removeFile(f);
    }
  }
}

/** Quick check if a TCP port is in use */
function awaitExists(port: number): Promise<boolean> {
  return healthCheck(port);
}

/** Main autostart logic */
async function main(overridePort?: number): Promise<number> {
  const portArgIdx = process.argv.indexOf('--port');
  const preferredPort =
    overridePort ?? (portArgIdx > 0 ? parseInt(process.argv[portArgIdx + 1] || '0', 10) : 0);

  // Ensure runtime dir
  if (!fs.existsSync(RUNTIME_DIR)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  }

  logToFile('[BOOT] Started dashboard-ws-autostart.ts');

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
  for (const testPort of [8080, 8082, 8083]) {
    const ok = await healthCheck(testPort);
    if (ok) {
      logToFile(`[SKIP] WS already running on port ${testPort}`);
      saveDashboardPorts(testPort, 0);
      return 0;
    }
  }

  // Detect available port
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

  // On Windows, .cmd files require cmd.exe or shell:true (spawn EINVAL otherwise)
  const tsxBin = path.join(WS_SERVER_DIR, 'node_modules', '.bin', 'tsx.cmd');
  const child = spawn('cmd.exe', ['/c', tsxBin, WS_SCRIPT], {
    cwd: WS_SERVER_DIR,
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
    env: {
      ...process.env,
      WS_PORT: String(selectedPort),
    },
  });

  child.unref();
  const procId = child.pid;
  fs.writeFileSync(PID_FILE, String(procId), 'utf-8');

  logToFile(`[START] PID=${procId} port=${selectedPort}`);

  // Wait up to 20s for server to become healthy. NOTE: we must NOT bail out
  // when the cmd.exe wrapper PID dies — on Windows the real node process is a
  // descendant and keeps running after cmd.exe exits. Health check is truth.
  let healthy = false;
  for (let i = 0; i < 4; i++) {
    await sleep(5000);
    const ok = await healthCheck(selectedPort);
    if (ok) {
      healthy = true;
      break;
    }
  }

  // Resolve the REAL server PID (the node process listening on the port), not
  // the cmd.exe wrapper PID. This is what the watchtower and stop scripts use.
  const realPid = await getProcessIdByPort(selectedPort);
  if (realPid && realPid !== procId) {
    fs.writeFileSync(PID_FILE, String(realPid), 'utf-8');
    logToFile(`[PID] Resolved real server PID=${realPid} (was wrapper PID=${procId})`);
  }

  if (healthy) {
    logToFile(`[OK] WS healthy on port ${selectedPort} (PID=${realPid ?? procId})`);
    return 0;
  }

  logToFile(
    `[WARN] WS process started but health check inconclusive (PID=${procId} port=${selectedPort})`,
  );
  return 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Entry (ESM) ──
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('[DASHBOARD-WS] Fatal:', err);
      process.exit(1);
    });
}

export { main as startWsServer };
