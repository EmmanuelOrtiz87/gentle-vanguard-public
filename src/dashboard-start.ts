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
import { startWsServer } from './dashboard-ws-autostart';

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

import { getEffectiveProcessTimeout } from './core/timeout-config';

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

/** Start the WS server watchdog */
async function startWsWatchdog(port: number): Promise<void> {
  if (!opts.quiet) console.log(`[DASHBOARD] Starting WS server on port ${port}...`);

  // Call the module version of dashboard-ws-autostart
  const exitCode = await startWsServer(port);
  if (exitCode !== 0 && !opts.quiet) {
    console.warn(`[DASHBOARD] WS server exited with code ${exitCode}`);
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

  // Use .cmd on Windows (vite without .cmd is a Unix shell script, not executable by node.exe)
  const viteBin = path.join(WEB_APP_DIR, 'node_modules', '.bin', 'vite.cmd');
  const child = spawn('cmd.exe', ['/c', viteBin, '--host', '--port', String(vitePort)], {
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
      spawn('cmd.exe', ['/c', 'start', 'chrome.exe', '--new-window', url], {
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

  // Resolve ports
  const selectedWs = await getFreePort(opts.wsPort > 0 ? opts.wsPort : 8080);
  const selectedVite = await getFreePort(opts.viteDevPort > 0 ? opts.viteDevPort : 5173);

  saveDashboardPorts(selectedWs, selectedVite);

  if (selectedWs !== (opts.wsPort || 8080) && !opts.quiet) {
    console.log(`[DASHBOARD] WS port ${opts.wsPort || 8080} busy → using ${selectedWs}`);
  }
  if (selectedVite !== (opts.viteDevPort || 5173) && !opts.quiet) {
    console.log(`[DASHBOARD] Vite port ${opts.viteDevPort || 5173} busy → using ${selectedVite}`);
  }

  // Launch Vite
  if (!opts.wsOnly) {
    // Ensure node_modules exist
    const nodeModulesPath = path.join(WEB_APP_DIR, 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
      console.log('[DASHBOARD] Installing dependencies...');
      const install = spawn('npm', ['install', '--silent'], {
        cwd: WEB_APP_DIR,
        stdio: 'inherit',
        windowsHide: true,
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
