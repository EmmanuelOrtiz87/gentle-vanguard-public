#!/usr/bin/env tsx
/**
 * stop-presentations — Stop the presentations HTTP server
 *
 * Replaces stop-presentations-server.ps1 (migrated to TS).
 *
 * Usage:
 *   npx tsx src/cli/stop-presentations.ts [--port 3000] [--quiet]
 */

import { runSyncShell } from '../core/run-command.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PORT = parseInt(
  process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] ?? '3000',
  10,
);
const QUIET = process.argv.includes('--quiet');
const LOG_PATH = path.resolve(process.cwd(), '.runtime/presentations-server.log');

function log(message: string): void {
  if (!QUIET) console.log(message);
}

function killProcessOnPort(port: number): boolean {
  let stopped = false;

  try {
    if (process.platform === 'win32') {
      // Windows: use netstat to find PID on port
      const result = runSyncShell(`netstat -ano | findstr :${port}`, {
        stdio: ['pipe', 'pipe', 'pipe'],
      }).stdout;
      const lines = result.split('\n').filter((l) => l.includes('LISTENING'));
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid)) {
          try {
            runSyncShell(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
            log(`  Killed process PID ${pid} on port ${port}`);
            stopped = true;
          } catch {
            log(`  Could not kill PID ${pid} (may be already stopped)`);
          }
        }
      }
    } else {
      // Unix: use lsof or fuser
      try {
        runSyncShell(`fuser -k ${port}/tcp 2>/dev/null`, { stdio: 'ignore' });
        stopped = true;
      } catch {
        try {
          const result = runSyncShell(`lsof -ti:${port} 2>/dev/null`, {
            stdio: ['pipe', 'pipe', 'pipe'],
          }).stdout;
          if (result.trim()) {
            runSyncShell(`kill -9 ${result.trim().split('\n').join(' ')}`, { stdio: 'ignore' });
            stopped = true;
          }
        } catch {
          // No process found
        }
      }
    }
  } catch {
    // No process found on port
  }

  return stopped;
}

log(`  Stopping presentations server on port ${PORT}...`);
const stopped = killProcessOnPort(PORT);

if (stopped) {
  log(`  ✅ Server stopped on port ${PORT}`);
} else {
  log(`  No process found listening on port ${PORT}.`);
}

// Trim log to last 5 lines
if (fs.existsSync(LOG_PATH)) {
  const lines = fs.readFileSync(LOG_PATH, 'utf-8').split('\n').filter(Boolean);
  const keep = lines.slice(-5);
  fs.writeFileSync(LOG_PATH, keep.join('\n') + '\n', 'utf-8');
  if (!QUIET) {
    log(`  Log trimmed to last 5 lines: ${LOG_PATH}`);
    log('');
    log('  Last log entries:');
    keep.forEach((l) => log(`    ${l}`));
  }
}

log('  Done.');
