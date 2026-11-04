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
import { killRecordedWsProcess, ensureWatchdog } from './dashboard-common';

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
    /**
     * Con timeout explicito: contra un daemon WEDGED el socket acepta pero no
     * responde, y `fetch` sin limite se queda esperando para siempre. Un
     * probe sin timeout en un daemon colgado es un probe que no probe.
     */
    const resp = await fetch(`http://localhost:${WS_PORT}/api/health`, {
      signal: AbortSignal.timeout(4000),
    });
    return resp.status === 200;
  } catch {
    return false;
  }
}

/**
 * Mata al dueno del puerto SOLO si es el dashboard registrado por el stack.
 *
 * Se lee el pid file que escribe el propio launcher/autostart: si el PID no
 * esta vivo o no coincide con el dueno del puerto, no se toca nada (un
 * proceso ajeno en el 8080 no es del dashboard).
 *
 * El tree kill (`taskkill /F /T` en Windows) es OBLIGATORIO: un daemon
 * wedged no atiende `process.kill(pid, 'SIGKILL')` —su event loop esta
 * bloqueado— y hay que terminarlo por fuera del proceso.
 */
function killRegisteredWsProcess(): boolean {
  const pidFile = path.join(ROOT, '.runtime', 'dashboard-ws.pid');
  const killed = killRecordedWsProcess(pidFile);
  if (killed) {
    log('Killed the wedged dashboard WS process registered by the stack');
  }
  return killed;
}

async function launch(): Promise<void> {
  // Check if already running via health API
  if (await isWSAlreadyRunning()) {
    log(`Dashboard WS already running on port ${WS_PORT}`);
    ensureWatchdog(WS_PORT);
    process.exit(0);
  }

  /**
   * Puerto ocupado + API HTTP muerta = daemon WEDGED (event loop bloqueado).
   *
   * Antes este launcher se negaba ("port in use by another process", exit 1)
   * y como el autoheal tampoco lo mataba (para el solo abrir el puerto era
   * prueba de vida), el dashboard quedaba wedged PARA SIEMPRE: nadie lo
   * reiniciaba. Ahora se mata al dueno del puerto, pero SOLO si es el propio
   * dashboard (PID registrado por el stack): un proceso ajeno no se toca.
   */
  if (await isPortInUse(WS_PORT)) {
    const killed = killRegisteredWsProcess();
    if (!killed) {
      log(`Port ${WS_PORT} is in use by another process`);
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (await isPortInUse(WS_PORT)) {
      log(`Port ${WS_PORT} still in use after killing the wedged dashboard`);
      process.exit(1);
    }
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

  /**
   * El watchdog se asegura SIEMPRE, incluso si el server todavia no responde:
   * un server que tarda en levantar es exactamente el caso que el watchdog
   * existe para cubrir.
   */
  const watchdog = ensureWatchdog(WS_PORT);
  log(watchdog.reason);

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
