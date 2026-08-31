#!/usr/bin/env node
/**
 * Dashboard Common — port allocation and state persistence utilities.
 * TS migration of scripts/utilities/dashboard/dashboard-common.ps1
 */

import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { runSync } from '../../adapters/command-runner.js';
import { pathToFileURL } from 'url';

const RUNTIME_DIR = path.resolve(process.cwd(), '.runtime');
const PORTS_FILE = path.join(RUNTIME_DIR, 'dashboard-ports.json');

interface DashboardPorts {
  wsPort?: number;
  vitePort?: number;
  updated?: string;
}

/**
 * Find a free TCP port starting from preferred.
 * Tries to bind a TCP listener — cleanest cross-platform port check.
 */
export async function getFreePort(preferred = 8080, maxAttempts = 100): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = preferred + i;
    const free = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port, '127.0.0.1');
    });
    if (free) return port;
  }
  return preferred;
}

/** Persist dashboard port assignments to .runtime/dashboard-ports.json */
export function saveDashboardPorts(wsPort: number, vitePort: number): void {
  ensureRuntimeDir();
  const data: DashboardPorts = {
    wsPort,
    vitePort,
    updated: new Date().toISOString(),
  };
  fs.writeFileSync(PORTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/** Read persisted dashboard port assignments */
export function readDashboardPorts(): DashboardPorts | null {
  try {
    if (fs.existsSync(PORTS_FILE)) {
      return JSON.parse(fs.readFileSync(PORTS_FILE, 'utf-8')) as DashboardPorts;
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

/** Remove the dashboard ports file */
export function clearDashboardPorts(): void {
  try {
    if (fs.existsSync(PORTS_FILE)) fs.unlinkSync(PORTS_FILE);
  } catch {
    // ignore
  }
}

/** Get process ID listening on a given TCP port (Windows via netstat, cross-platform via ss/lsof) */
export async function getProcessIdByPort(port: number): Promise<number | null> {
  try {
    if (process.platform === 'win32') {
      const r = runSync('netstat', ['-ano', '-p', 'TCP'], { timeout: 5000 });
      const output = (r.stdout ?? '').toString();
      for (const line of output.trim().split('\n')) {
        if (line.includes('LISTENING') && line.includes(`:${port} `)) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (/^\d+$/.test(pid)) return parseInt(pid, 10);
        }
      }
    } else {
      const r = runSync('lsof', ['-ti', `:${port}`], { timeout: 5000 });
      if (r.status === 0) {
        const line = (r.stdout ?? '').toString().trim().split('\n')[0];
        if (/^\d+$/.test(line)) return parseInt(line, 10);
      } else {
        const r2 = runSync('ss', ['-tlnp', `sport = :${port}`], { timeout: 5000 });
        const output = (r2.stdout ?? '').toString();
        for (const line of output.trim().split('\n')) {
          const pidMatch = line.match(/pid=(\d+)/i);
          if (pidMatch) return parseInt(pidMatch[1], 10);
        }
      }
    }
  } catch {
    // not found or error
  }
  return null;
}

/** Check if a process with given PID is alive */
export function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    if (process.platform === 'win32') {
      // NOTE: tasklist /FI returns exit code 0 even when the PID does NOT exist
      // (it prints "INFO: No tasks are running..."). We must parse the output
      // instead of relying on the exit code — otherwise stale PID files are
      // never cleaned and the watchdog falsely believes processes are alive.
      const r = runSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], {
        timeout: 3000,
      });
      const output = (r.stdout ?? '').toString();
      // CSV row looks like: "node.exe","26316","Console","1","12,345 K"
      return output.includes(`"${pid}"`);
    }
    // Unix: kill -0 checks if process exists
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Kill a process by PID */
export function killProcess(pid: number): void {
  try {
    if (process.platform === 'win32') {
      runSync('taskkill', ['/F', '/PID', String(pid)], { timeout: 3000 });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    // ignore
  }
}

/** Read a PID from a file and kill the process, then remove the file */
export function stopByPidFile(pidFile: string): void {
  try {
    if (fs.existsSync(pidFile)) {
      const content = fs.readFileSync(pidFile, 'utf-8').trim();
      if (/^\d+$/.test(content)) {
        killProcess(parseInt(content, 10));
      }
      fs.unlinkSync(pidFile);
    }
  } catch {
    // ignore
  }
}

/** Kill any process listening on a port */
export async function stopByPort(port: number): Promise<void> {
  const pid = await getProcessIdByPort(port);
  if (pid) killProcess(pid);
}

/** Append a line to the dashboard log file */
export function logToFile(message: string): void {
  ensureRuntimeDir();
  const logFile = path.join(RUNTIME_DIR, 'dashboard-ws.log');
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logFile, `${timestamp} | ${message}\n`, 'utf-8');
}

/** Remove a file if it exists (silent) */
export function removeFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

function ensureRuntimeDir(): void {
  if (!fs.existsSync(RUNTIME_DIR)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  }
}

// CLI entry point (ESM pattern)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'get-free-port': {
      const preferred = parseInt(process.argv[3] || '8080', 10);
      void getFreePort(preferred).then((port) => console.log(port));
      break;
    }
    case 'get-pid-by-port': {
      const port = parseInt(process.argv[3] || '0', 10);
      void getProcessIdByPort(port).then((pid) => console.log(pid ?? ''));
      break;
    }
    case 'read-ports':
      console.log(JSON.stringify(readDashboardPorts()));
      break;
    case 'clear-ports':
      clearDashboardPorts();
      break;
    default:
      console.log('Usage: npx tsx src/dashboard-common.ts <cmd>');
      console.log(
        'Commands: get-free-port [preferred], get-pid-by-port <port>, read-ports, clear-ports',
      );
  }
}
