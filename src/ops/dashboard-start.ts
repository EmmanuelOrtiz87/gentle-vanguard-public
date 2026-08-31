#!/usr/bin/env node
/**
 * Dashboard Start — full launcher for the LLM Observability Dashboard.
 * TS migration of scripts/utilities/dashboard/dashboard-start.ps1
 *
 * Launches: WebSocket metrics server (via dashboard-ws-autostart),
 * Vite dev server, and optionally opens Chrome.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { spawn } from 'child_process';
import { pathToFileURL } from 'url';
import { getFreePort, saveDashboardPorts } from './dashboard-common';

const ROOT = path.resolve(process.cwd());
const WEB_APP_DIR = path.join(ROOT, 'apps', 'web-dashboard');
const RUNTIME_DIR = path.join(ROOT, '.runtime');
const VITE_PID_FILE = path.join(RUNTIME_DIR, 'dashboard-vite.pid');

interface CliOptions {
  viteOnly: boolean;
  wsOnly: boolean;
  quiet: boolean;
  noBrowser: boolean;
  wsPort: number;
  viteDevPort: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  return {
    viteOnly: args.includes('--vite-only') || args.includes('-ViteOnly'),
    wsOnly: args.includes('--ws-only') || args.includes('-WSOnly'),
    quiet: args.includes('--quiet') || args.includes('-Quiet'),
    noBrowser: args.includes('--no-browser') || args.includes('-NoBrowser'),
    wsPort: (() => {
      const idx = args.indexOf('--ws-port');
      return idx >= 0 ? parseInt(args[idx + 1] || '0', 10) : 0;
    })(),
    viteDevPort: (() => {
      const idx = args.indexOf('--vite-port');
      return idx >= 0 ? parseInt(args[idx + 1] || '0', 10) : 0;
    })(),
  };
}

import { getEffectiveProcessTimeout } from '../core/timeout-config';
import { run } from '../core/run-command';

/** HTTP GET check until a server responds or timeout */
async function waitForServer(url: string, maxAttempts = 20, delayMs = 1000): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const ok = await new Promise<boolean>((resolve) => {
        const req = http.get(
          url,
          { timeout: getEffectiveProcessTimeout('health_check') },
          (res) => {
            resolve(res.statusCode === 200);
          },
        );
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });
      });
      if (ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

/** Start the WS server watchdog (detached, persistent --watch mode) */
async function startWsWatchdog(port: number): Promise<void> {
  if (!opts.quiet) console.log(`[DASHBOARD] Starting WS watchdog on port ${port}...`);

  // Spawn dashboard-ws-autostart.ts DETACHED in --watch mode so the
  // auto-recovery watchdog survives after this launcher exits. Calling
  // startWsServer() in-process would either block forever (--watch) or
  // leave no recovery loop (one-shot). `--import tsx` runs the script in the
  // spawned node process itself — hidden, no CLI-wrapper grandchild.
  const autostartScript = path.join(ROOT, 'src', 'dashboard-ws-autostart.ts');
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', autostartScript, '--watch', '--port', String(port)],
    {
      cwd: ROOT,
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    },
  );
  child.unref();

  // Wait until the WS server answers (the detached watchdog owns startup)
  const ready = await waitForServer(`http://localhost:${port}/api/health`, 20, 1000);
  if (!ready && !opts.quiet) {
    console.warn(`[DASHBOARD] WS server not healthy yet on port ${port} (watchdog will retry)`);
  }
}

/** Start Vite dev server */
async function startViteDev(wsPort: number, vitePort: number): Promise<void> {
  // Kill stale Vite on target port
  // (already handled by getFreePort)

  if (!opts.quiet) {
    console.log(
      `[DASHBOARD] Starting Vite on port ${vitePort} (WS backend → localhost:${wsPort})...`,
    );
  }

  // Invoke Vite's JS entry directly. This avoids a persistent cmd.exe wrapper
  // and keeps the launcher invisible on Windows.
  const viteCli = path.join(WEB_APP_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [viteCli, '--host', '--port', String(vitePort)], {
    cwd: WEB_APP_DIR,
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
    env: {
      ...process.env,
      WS_PORT: String(wsPort),
      VITE_DEV_PORT: String(vitePort),
    },
  });

  child.unref();
  if (child.pid) {
    fs.writeFileSync(VITE_PID_FILE, String(child.pid), 'utf-8');
  }

  // Wait for Vite to become ready
  const ready = await waitForServer(`http://localhost:${vitePort}/`, 20, 1000);
  if (!ready && !opts.quiet) {
    console.warn(`[DASHBOARD] Vite may not be ready on port ${vitePort}`);
  }
}

/** Open Chrome or default browser */
function openBrowser(vitePort: number): void {
  const url = `http://localhost:${vitePort}/`;
  if (!opts.quiet) console.log(`[DASHBOARD] Opening ${url}`);

  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/d', '/c', 'start', '""', 'chrome.exe', '--new-window', url], {
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
      }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    if (!opts.quiet) console.warn(`[DASHBOARD] Could not open browser`);
  }
}

/** Detect an already-running WS server on the standard candidate ports */
async function detectRunningWs(): Promise<number | null> {
  for (const p of [8080, 8082, 8083]) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.get(`http://127.0.0.1:${p}/api/health`, { timeout: 2000 }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return p;
  }
  return null;
}

/** Probe whether an HTTP server is already serving at the given URL */
async function isHttpOk(url: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const req = http.get(url, { timeout: 2000 }, (res) => {
      resolve((res.statusCode ?? 500) < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

const opts = parseArgs();

/** Main entry */
async function main(): Promise<void> {
  // Show header
  if (!opts.quiet) {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║     GENTLE-VANGUARD LLM OBSERVABILITY DASHBOARD              ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
  }

  // Resolve ports — adopt an already-running WS server so Vite proxies to the
  // right backend (getFreePort alone would skip to 8081 and break the wiring).
  const detectedWs = opts.wsPort > 0 ? null : await detectRunningWs();
  const selectedWs = detectedWs ?? (await getFreePort(opts.wsPort > 0 ? opts.wsPort : 8080));
  const desiredVite = opts.viteDevPort > 0 ? opts.viteDevPort : 5173;
  // Idempotency: adopt an already-serving Vite instead of spawning a duplicate
  // on a shifted port (getFreePort would jump to 5174 and orphan the known URL).
  const viteAlreadyUp = await isHttpOk(`http://localhost:${desiredVite}/`);
  const selectedVite = viteAlreadyUp ? desiredVite : await getFreePort(desiredVite);

  saveDashboardPorts(selectedWs, selectedVite);

  if (detectedWs !== null && !opts.quiet) {
    console.log(`[DASHBOARD] WS server already running on port ${selectedWs} — adopting it`);
  }

  if (selectedWs !== (opts.wsPort || 8080) && !opts.quiet) {
    console.log(`[DASHBOARD] WS port ${opts.wsPort || 8080} busy → using ${selectedWs}`);
  }
  if (selectedVite !== (opts.viteDevPort || 5173) && !opts.quiet) {
    console.log(`[DASHBOARD] Vite port ${opts.viteDevPort || 5173} busy → using ${selectedVite}`);
  }

  // Launch Vite
  if (!opts.wsOnly) {
    if (viteAlreadyUp) {
      if (!opts.quiet) {
        console.log(
          `[DASHBOARD] Vite already running on port ${selectedVite} — adopting it (no new process)`,
        );
      }
    } else {
      // Ensure node_modules exist
      const nodeModulesPath = path.join(WEB_APP_DIR, 'node_modules');
      if (!fs.existsSync(nodeModulesPath)) {
        console.log('[DASHBOARD] Installing dependencies...');
        // run() routes `npm` through its .cmd shim safely on Windows (raw
        // spawn('npm') fails with EINVAL without a shell).
        const install = run('npm', ['install', '--silent'], {
          cwd: WEB_APP_DIR,
          stdio: 'inherit',
        });
        await new Promise<void>((resolve, reject) => {
          install.on('close', (code) =>
            code === 0 ? resolve() : reject(new Error('npm install failed')),
          );
          install.on('error', reject);
        });
      }

      await startViteDev(selectedWs, selectedVite);

      if (!opts.noBrowser) {
        openBrowser(selectedVite);
      }
    }
  }

  // Launch WS server
  if (!opts.viteOnly) {
    await startWsWatchdog(selectedWs);
  }

  if (!opts.quiet) {
    console.log('');
    console.log('✅ Dashboard ready!');
    console.log(`   Web:       http://localhost:${selectedVite}/`);
    console.log(`   WS API:    http://localhost:${selectedWs}/api/metrics`);
    console.log(`   Persisted: .runtime/dashboard-ports.json`);
    console.log('');
    console.log('   Stop with: npx tsx src/dashboard-stop.ts');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[DASHBOARD] Fatal:', err);
    process.exit(1);
  });
}
