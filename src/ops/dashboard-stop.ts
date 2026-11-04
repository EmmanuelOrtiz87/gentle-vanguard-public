#!/usr/bin/env node
/**
 * Dashboard Stop — stop all dashboard processes using persisted port state.
 * TS migration of scripts/utilities/dashboard/dashboard-stop.ps1
 *
 * Reads .runtime/dashboard-ports.json to find WS and Vite ports,
 * kills processes by PID file, port ownership, and process name.
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { runSync } from '../../adapters/command-runner.js';
import {
  readDashboardPorts,
  clearDashboardPorts,
  getProcessIdByPort,
  stopByPidFile,
  killProcess,
} from './dashboard-common';
import { getEffectiveProcessTimeout } from '../core/timeout-config';

const ROOT = path.resolve(process.cwd());
const RUNTIME_DIR = path.join(ROOT, '.runtime');
const PID_WATCHDOG = path.join(RUNTIME_DIR, 'dashboard-ws-watchdog.pid');
const PID_WS = path.join(RUNTIME_DIR, 'dashboard-ws.pid');
const PID_VITE = path.join(RUNTIME_DIR, 'dashboard-vite.pid');

/**
 * Kill watchdog process by reading its PID file — must happen FIRST to avoid restart loops.
 *
 * The PID file is removed AFTER the kill (and only if the kill was aimed at
 * the PID we read): removing it first loses the only handle we have on the
 * supervisor.
 */
function stopWatchdog(): number | null {
  let pid: number | null = null;
  try {
    if (fs.existsSync(PID_WATCHDOG)) {
      const content = fs.readFileSync(PID_WATCHDOG, 'utf-8').trim();
      if (/^\d+$/.test(content)) {
        pid = parseInt(content, 10);
        killProcess(pid, true);
      }
    }
  } catch {
    // ignore
  }
  return pid;
}

/**
 * Kill any remaining node processes matching dashboard patterns.
 *
 * Antes usaba `wmic`, que esta DESCONTINUADO (y desaparece) en Windows 11
 * 24H2: la llamada fallaba y no mataba a nadie. Ahora usa Get-CimInstance,
 * que es el mecanismo que ya usa el resto del stack (checks-infra.ts).
 */
function killNodeProcesses(): void {
  if (process.platform !== 'win32') return;
  try {
    const psCmd = `@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'web-dashboard' -and ($_.CommandLine -match 'websocket-server' -or $_.CommandLine -match 'vite') }).Count`;
    const count = runSync('powershell', ['-NoProfile', '-Command', psCmd], {
      timeout: getEffectiveProcessTimeout('default'),
      stdio: 'pipe',
    });
    const n = parseInt((count.stdout ?? '').toString().trim(), 10);
    if (!isNaN(n) && n === 0) return;

    const killCmd = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'web-dashboard' -and ($_.CommandLine -match 'websocket-server' -or $_.CommandLine -match 'vite') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
    runSync('powershell', ['-NoProfile', '-Command', killCmd], {
      timeout: getEffectiveProcessTimeout('default'),
      stdio: 'pipe',
    });
  } catch {
    // ignore
  }
}

async function main(): Promise<void> {
  const quiet = process.argv.includes('--quiet') || process.argv.includes('-Quiet');

  // Read ports BEFORE clearing state
  const ports = readDashboardPorts();
  const wsPort = ports?.wsPort ?? 8080;
  const vitePort = ports?.vitePort ?? 5173;

  /**
   * ORDEN (2026-11-03). Antes este script BORRABA los PID files y DESPUES
   * intentaba matar por PID file: el PID ya no existia, el server sobrevivia
   * y `npm run dashboard:stop` no paraba nada. Ahora:
   *
   *   1. Se mata el watchdog (si no, reinicia el server que vamos a matar).
   *   2. Se matan WS y Vite por su PID file (con tree kill: sin /T quedan
   *      hijos huerfanos, como los skill-server del WS).
   *   3. Se mata por dueno del puerto.
   *   4. Se limpia lo que quedo por nombre de proceso.
   *   5. AHORA si se borran los PID files y el de puertos.
   */
  const watchdogPid = stopWatchdog();

  // Kill by PID files (tree kill: the WS server leaves child processes).
  stopByPidFile(PID_WS, true);
  stopByPidFile(PID_VITE, true);

  // Kill by port ownership
  const wsPid = await getProcessIdByPort(wsPort);
  if (wsPid) {
    killProcess(wsPid, true);
    if (!quiet) console.log(`[DASHBOARD] Stopped WS server on port ${wsPort} (PID ${wsPid})`);
  }

  const vitePid = await getProcessIdByPort(vitePort);
  if (vitePid) {
    killProcess(vitePid, true);
    if (!quiet)
      console.log(`[DASHBOARD] Stopped Vite dev server on port ${vitePort} (PID ${vitePid})`);
  }

  // Clean up any remaining node processes
  killNodeProcesses();

  // Clear state files LAST: until here they were the only handle on the daemons.
  removeFileIfExists(PID_WATCHDOG);
  removeFileIfExists(PID_WS);
  removeFileIfExists(PID_VITE);
  clearDashboardPorts();

  if (!quiet) {
    const parts = [`WS:${wsPort}`, `Vite:${vitePort}`];
    if (watchdogPid) parts.push(`watchdog:${watchdogPid}`);
    console.log(`[DASHBOARD] All dashboard processes stopped (${parts.join(', ')}).`);
  }
}

function removeFileIfExists(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[DASHBOARD] Fatal:', err);
    process.exit(1);
  });
}
