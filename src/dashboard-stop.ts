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
import { runSync } from '../adapters/command-runner.js';
import {
  readDashboardPorts,
  clearDashboardPorts,
  getProcessIdByPort,
  stopByPidFile,
  killProcess,
} from './dashboard-common';
import { getEffectiveProcessTimeout } from './core/timeout-config';

const ROOT = path.resolve(process.cwd());
const RUNTIME_DIR = path.join(ROOT, '.runtime');
const PID_WATCHDOG = path.join(RUNTIME_DIR, 'dashboard-ws-watchdog.pid');
const PID_WS = path.join(RUNTIME_DIR, 'dashboard-ws.pid');
const PID_VITE = path.join(RUNTIME_DIR, 'dashboard-vite.pid');

/** Kill watchdog process by reading its PID file — must happen FIRST to avoid restart loops */
function stopWatchdog(): void {
  try {
    if (fs.existsSync(PID_WATCHDOG)) {
      const content = fs.readFileSync(PID_WATCHDOG, 'utf-8').trim();
      if (/^\d+$/.test(content)) {
        killProcess(parseInt(content, 10));
      }
      fs.unlinkSync(PID_WATCHDOG);
    }
  } catch {
    // ignore
  }
}

/** Kill any remaining node processes matching dashboard patterns */
function killNodeProcesses(): void {
  if (process.platform !== 'win32') return;
  try {
    const result = runSync(
      'wmic',
      ['process', 'where', "name='node.exe'", 'get', 'ProcessId,CommandLine', '/format:csv'],
      {
        timeout: getEffectiveProcessTimeout('default'),
      },
    );
    if (result.status !== 0) return;
    const output = (result.stdout ?? '').toString();
    for (const line of output.split('\n')) {
      if (line.includes('websocket-server') || line.includes('vite')) {
        const parts = line.trim().split(',');
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid)) {
          killProcess(parseInt(pid, 10));
        }
      }
    }
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

  // Clear state files FIRST
  clearDashboardPorts();
  removeFileIfExists(PID_WS);
  removeFileIfExists(PID_VITE);

  // Kill watchdog FIRST (prevents restart loops)
  stopWatchdog();

  // Kill by PID files
  stopByPidFile(PID_WS);
  stopByPidFile(PID_VITE);

  // Kill by port ownership
  const wsPid = await getProcessIdByPort(wsPort);
  if (wsPid) {
    killProcess(wsPid);
    if (!quiet) console.log(`[DASHBOARD] Stopped WS server on port ${wsPort} (PID ${wsPid})`);
  }

  const vitePid = await getProcessIdByPort(vitePort);
  if (vitePid) {
    killProcess(vitePid);
    if (!quiet)
      console.log(`[DASHBOARD] Stopped Vite dev server on port ${vitePort} (PID ${vitePid})`);
  }

  // Clean up any remaining node processes
  killNodeProcesses();

  if (!quiet) {
    console.log(`[DASHBOARD] All dashboard processes stopped (WS:${wsPort}, Vite:${vitePort}).`);
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
