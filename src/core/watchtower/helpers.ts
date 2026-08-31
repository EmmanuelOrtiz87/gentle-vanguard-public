// Shared helpers for the maintenance watchtower checks (F2.5 split).
// Extracted verbatim from src/core/maintenance-watchtower.ts — no logic changes.

import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { createConnection } from 'net';
import { runSync } from '../run-command';
import { getEffectiveProcessTimeout, getHttpServerTimeouts } from '../timeout-config';
import { addResult, RUNTIME_DIR, SESSION_DIR } from './context';

export function getFileAgeHours(filePath: string): number {
  try {
    const stats = statSync(filePath);
    return (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
  } catch {
    return -1;
  }
}

export function testPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection(port, '127.0.0.1', () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => resolve(false));
    sock.setTimeout(getEffectiveProcessTimeout('health_check'));
    sock.on('timeout', () => {
      sock.destroy();
      resolve(false);
    });
  });
}

/** Resolve the real PID listening on a TCP port (Windows via netstat, Unix via lsof/ss) */
export async function getPidByPort(port: number): Promise<number | null> {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
      });
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes(`:${port}`) || !line.includes('LISTENING')) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(pid)) return pid;
      }
    } else {
      const out = execFileSync('lsof', ['-ti', `:${port}`], {
        encoding: 'utf-8',
        timeout: 5000,
      });
      const pid = parseInt(out.trim().split('\n')[0], 10);
      if (!isNaN(pid)) return pid;
    }
  } catch {
    // not found or error
  }
  return null;
}

/**
 * Detect a running `codegraph serve --mcp` MCP server via the process table.
 * The server runs as a node process (`...codegraph.js serve --mcp`), so a plain
 * process-name scan misses it. On Windows we use CIM (wmic is deprecated), on
 * Unix `ps -ef`. The querying process itself is excluded via `$PID`.
 */
export function isCodeGraphProcessRunning(): boolean {
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

export function testHttp(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const client = createConnection(parseInt(new URL(url).port, 10) || 8080, '127.0.0.1', () => {
      client.write(
        `GET ${new URL(url).pathname} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`,
      );
    });
    let data = '';
    client.on('data', (chunk: Buffer) => {
      data += chunk.toString();
    });
    client.on('end', () =>
      resolve(
        data.includes('200 OK') || data.includes('HTTP/1.1 200') || data.includes('HTTP/1.0 200'),
      ),
    );
    client.on('error', () => resolve(false));
    client.setTimeout(getHttpServerTimeouts().socket_timeout_ms);
    client.on('timeout', () => {
      client.destroy();
      resolve(false);
    });
  });
}

export function fileExists(p: string): boolean {
  return existsSync(p);
}

export function readJson(p: string): Record<string, unknown> {
  return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>;
}

export function payloadFileOk(
  component: string,
  label: string,
  filePath: string,
  onFailAction = 'manual',
  critical = false,
): boolean {
  if (!fileExists(filePath)) {
    addResult(component, label, 'WARN', 'Not found', onFailAction);
    return false;
  }
  if (filePath.endsWith('.json')) {
    try {
      readJson(filePath);
      addResult(component, label, 'PASS', '', 'ok');
      return true;
    } catch {
      addResult(component, label, 'FAIL', 'Invalid JSON', onFailAction, critical);
      return false;
    }
  } else {
    addResult(component, label, 'PASS', '', 'ok');
    return true;
  }
}

/**
 * True when the codegraph daemon may still be booting: the PID file was written
 * recently, or the current session is younger than the boot window. This does
 * NOT depend on session-current.json existing (it can be absent while the
 * pipeline is still initializing, which previously made the boot tolerance
 * silently fail and let the autoheal spawn a competing codegraph instance).
 */
export function isCodeGraphRecentlyBooted(): boolean {
  const pidFile = join(RUNTIME_DIR, 'codegraph-mcp-server.pid');
  if (fileExists(pidFile)) {
    try {
      const ageMs = Date.now() - statSync(pidFile).mtimeMs;
      if (ageMs < 90000) return true; // PID file touched in last 90s
    } catch {
      /* fall through */
    }
  }
  return getSessionAgeSeconds() < 60;
}

/** Age of the current session in seconds (0 if unknown / no session file). */
export function getSessionAgeSeconds(): number {
  try {
    const sf = join(SESSION_DIR, 'session-current.json');
    if (!fileExists(sf)) return Number.MAX_SAFE_INTEGER;
    const data = readJson(sf) as { startTime?: string; timestamp?: string };
    const t = new Date(data.startTime ?? data.timestamp ?? 0).getTime();
    if (isNaN(t) || t === 0) return Number.MAX_SAFE_INTEGER;
    return Math.floor((Date.now() - t) / 1000);
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}
