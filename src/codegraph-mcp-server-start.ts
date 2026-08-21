#!/usr/bin/env node

/**
 * Start CodeGraph MCP Server
 * Inicia el servidor MCP de CodeGraph en background para disponibilidad inmediata
 */

import { spawn } from 'child_process';
import { existsSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { runSync } from './core/run-command.js';

const require = createRequire(import.meta.url);
const PID_FILE = join(process.cwd(), '.runtime', 'codegraph-mcp-server.pid');
const LOG_FILE = join(process.cwd(), '.runtime', 'codegraph-mcp-server.log');

function log(message: string) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  // Also persist to a file so the daemon's lifecycle is observable even when
  // spawned with stdio:'ignore' (lazy step in the session-autostart pipeline).
  try {
    const { appendFileSync } = require('fs') as typeof import('fs');
    appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`, 'utf-8');
  } catch {
    /* non-fatal */
  }
}

function findCodeGraph(): string {
  // Try to find codegraph in common locations
  const isWindows = process.platform === 'win32';

  // Try which/where first. On Windows, skip non-executable shims (the
  // extensionless bash script and .ps1) — cmd.exe can only run .exe/.cmd/.bat.
  try {
    const cmd = isWindows ? 'where' : 'which';
    const output = runSync(cmd, ['codegraph'], { stdio: ['pipe', 'pipe', 'ignore'] }).stdout;
    for (const line of output.split(/\r?\n/)) {
      const path = line.trim();
      if (!path) continue;
      if (isWindows) {
        if (/\.(exe|cmd|bat|com)$/i.test(path) && existsSync(path)) {
          log(`[INFO] Found codegraph at: ${path}`);
          return path;
        }
      } else if (existsSync(path)) {
        log(`[INFO] Found codegraph at: ${path}`);
        return path;
      }
    }
  } catch {
    // Fallback to common paths
  }

  // Common installation paths
  const searchPaths = isWindows
    ? [
        join(process.env.USERPROFILE || '', 'go', 'bin', 'codegraph.exe'),
        join(process.env.USERPROFILE || '', 'bin', 'codegraph.exe'),
        join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'codegraph.exe'),
        'C:\\Program Files\\codegraph\\codegraph.exe',
        'C:\\ProgramData\\chocolatey\\bin\\codegraph.exe',
        'codegraph', // fallback to PATH
      ]
    : [
        join(process.env.HOME || '', 'go', 'bin', 'codegraph'),
        join(process.env.HOME || '', '.local', 'bin', 'codegraph'),
        '/usr/local/bin/codegraph',
        '/usr/bin/codegraph',
        'codegraph', // fallback to PATH
      ];

  for (const path of searchPaths) {
    if (path === 'codegraph' || existsSync(path)) {
      return path;
    }
  }

  // Last resort: try PATH
  return 'codegraph';
}

function isServerRunning(): boolean {
  if (!existsSync(PID_FILE)) return false;

  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    if (isNaN(pid)) return false;

    // Check if process exists (Windows compatible)
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/** True if a `codegraph serve --mcp` node process is visible in the process table */
function isCodeGraphProcessAlive(): boolean {
  try {
    if (process.platform === 'win32') {
      const r = runSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "@(@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne `$PID -and $_.CommandLine -match 'codegraph\\.js' -and $_.CommandLine -match 'serve' -and $_.CommandLine -match '--mcp' })).Count",
        ],
        { timeout: 15000 },
      );
      const count = parseInt((r.stdout ?? '').trim(), 10);
      return !isNaN(count) && count > 0;
    }
    const r = runSync('ps', ['-ef'], { timeout: 15000 });
    return /codegraph\.js.*(serve|--mcp)/i.test(r.stdout ?? '');
  } catch {
    return false;
  }
}

/**
 * Resolve the real JS entry point for codegraph (dist/bin/codegraph.js).
 * Spawning `node <entry> serve --mcp` directly avoids the `.cmd` shim layer,
 * which on Windows creates an intermediate cmd.exe process whose PID is
 * written to the PID file but dies shortly after, leaving a stale PID.
 */
function resolveCodeGraphJs(): string {
  try {
    const pkgJson = require.resolve('@colbymchenry/codegraph/package.json');
    const pkg = JSON.parse(readFileSync(pkgJson, 'utf-8')) as {
      bin?: string | Record<string, string>;
    };
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.codegraph;
    if (bin) return join(dirname(pkgJson), bin);
  } catch {
    // fall through to PATH-based resolution
  }
  // Fallback: locate the global npm install of the codegraph package
  // (npm root -g on Windows = %APPDATA%\npm\node_modules — computed directly
  // to avoid spawning npm.cmd which spawnSync cannot run without a shell).
  const globalRoot =
    process.platform === 'win32'
      ? join(process.env.APPDATA || '', 'npm', 'node_modules')
      : '/usr/local/lib/node_modules';
  const candidate = join(globalRoot, '@colbymchenry', 'codegraph', 'dist', 'bin', 'codegraph.js');
  if (existsSync(candidate)) return candidate;
  return '';
}

function startCodeGraphServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isServerRunning()) {
      log('[OK] CodeGraph MCP server is already running');
      resolve();
      return;
    }

    log('[INFO] Starting CodeGraph MCP server...');

    const jsEntry = resolveCodeGraphJs();
    if (!jsEntry) {
      log('[WARN] Could not resolve codegraph JS entry; falling back to PATH binary');
    }

    // Spawn `node <codegraph.js> serve --mcp` directly — no shell, no .cmd shim.
    // This keeps the PID file pointing at the real node process so the
    // watchtower can reliably detect it.
    //
    // CRITICAL: `serve --mcp` uses the stdio transport — it reads JSON-RPC
    // messages from stdin and exits as soon as stdin hits EOF. Spawning with
    // `stdio: ['ignore', ...]` (the old behaviour) closes stdin immediately,
    // so the server exits right after boot. We must keep stdin as an OPEN PIPE
    // and hold it from this parent process, which stays alive as the daemon.
    const child = spawn(
      process.execPath,
      jsEntry ? [jsEntry, 'serve', '--mcp', '--no-watch'] : ['codegraph', 'serve', '--mcp'],
      {
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: !jsEntry, // only use shell as a last resort (PATH resolution)
      },
    );

    // Write PID file (the real codegraph node process, for watchtower checks)
    writeFileSync(PID_FILE, child.pid?.toString() || '');

    // Keep the child's stdin open so the MCP server never sees EOF. As long as
    // this parent process is alive, the pipe stays open and the server runs.
    // We deliberately do NOT close child.stdin and do NOT unref+exit.
    if (child.stdin) {
      // Hold a reference so the pipe is never garbage-collected/closed.
      child.stdin.on('error', () => {
        /* ignore EPIPE when the child exits */
      });
    }

    // When the codegraph child exits (e.g. killed by session close), this
    // parent daemon should also exit so no orphan process is left behind.
    child.on('exit', (code, signal) => {
      log(`[CodeGraph] server exited (code=${code}, signal=${signal})`);
      process.exit(0);
    });

    // Graceful shutdown: forward SIGTERM/SIGINT to the child, then exit.
    const shutdown = () => {
      try {
        child.kill();
      } catch {
        /* already dead */
      }
      setTimeout(() => process.exit(0), 500);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // Give it time to start
    setTimeout(() => {
      if (child.pid) {
        log(`[OK] CodeGraph MCP server started (PID: ${child.pid})`);
        if (isCodeGraphProcessAlive()) {
          log('[OK] CodeGraph MCP server process verified running');
        } else {
          log('[WARN] CodeGraph MCP server process not detected in process table');
        }
        resolve();
      } else {
        reject(new Error('CodeGraph process did not start'));
      }
    }, 3000);

    // Handle errors after start
    child.on('error', (err) => {
      log(`[ERROR] Failed to start CodeGraph: ${err.message}`);
      // Don't reject here; we already resolved
    });

    child.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) log(`[CodeGraph:err] ${msg}`);
    });

    child.stdout?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) log(`[CodeGraph] ${msg}`);
    });
  });
}

async function main() {
  try {
    await startCodeGraphServer();
    // Do NOT exit — this process is the daemon. It holds the child's stdin
    // pipe open (keeping the MCP server alive) and exits when the child exits
    // or when it receives SIGTERM/SIGINT from the session close orchestrator.
    log('[OK] CodeGraph MCP daemon running (holding stdin open)');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[FAIL] ${msg}`);
    process.exit(1);
  }
}

// Check if this is the main module
const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] && __filename === process.argv[1];

if (isMainModule) {
  void main();
}

export { startCodeGraphServer, isServerRunning, findCodeGraph };
