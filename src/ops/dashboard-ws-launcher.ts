#!/usr/bin/env tsx
/**
 * dashboard-ws-launcher.ts — Detached WS server launcher for autoheal
 *
 * Replaces dashboard-ws-launcher.ps1 (migrated to TS).
 * Launches the dashboard WS server as a detached process that survives
 * the calling process's lifetime.
 *
 * Called by maintenance-watchtower.ts during autoheal.
 *
 * Usage:
 *   npx tsx src/dashboard-ws-launcher.ts [--quiet]
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as net from 'node:net';

const QUIET = process.argv.includes('--quiet');
const ROOT = path.resolve(process.cwd());
const WS_PORT = 8080;

function log(msg: string): void {
  if (!QUIET) console.log(`[WS-LAUNCHER] ${msg}`);
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port, '0.0.0.0');
  });
}

async function isWSAlreadyRunning(): Promise<boolean> {
  try {
    const resp = await fetch(`http://localhost:${WS_PORT}/api/health`);
    return resp.status === 200;
  } catch {
    return false;
  }
}

async function launch(): Promise<void> {
  // Check if already running via health API
  if (await isWSAlreadyRunning()) {
    log(`Dashboard WS already running on port ${WS_PORT}`);
    process.exit(0);
  }

  // Check if port is in use but not WS
  if (await isPortInUse(WS_PORT)) {
    log(`Port ${WS_PORT} is in use by another process`);
    process.exit(1);
  }

  const wsScript = path.resolve(ROOT, 'apps', 'web-dashboard', 'server', 'websocket-server.ts');

  // Verify script exists
  if (!fs.existsSync(wsScript)) {
    log(`WS script not found: ${wsScript}`);
    process.exit(1);
  }

  // Run the TypeScript entry through Node's in-process tsx loader on every
  // platform. The old cmd.exe -> npx.cmd chain (and the tsx CLI wrapper) could
  // leave visible console wrappers behind; `--import tsx` spawns exactly one
  // hidden node process.
  const child = spawn(process.execPath, ['--import', 'tsx', wsScript], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    windowsHide: true,
    shell: false,
    env: { ...process.env, WS_PORT: String(WS_PORT) },
  });

  child.unref();

  // Wait briefly and verify
  await new Promise((resolve) => setTimeout(resolve, 2000));

  if (await isWSAlreadyRunning()) {
    log(`Dashboard WS launched successfully (PID: ${child.pid})`);
    process.exit(0);
  } else {
    log('Dashboard WS launched but not responding yet');
    process.exit(0); // Non-fatal — watchdog will retry
  }
}

launch().catch((err) => {
  console.error('[WS-LAUNCHER] Fatal error:', err);
  process.exit(1);
});
