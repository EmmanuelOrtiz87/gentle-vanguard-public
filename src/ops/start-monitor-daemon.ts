#!/usr/bin/env node
/**
 * start-monitor-daemon.ts — Starts timeout/performance monitor as detached daemon
 *
 * Spawns the monitor daemon in a detached background process so it doesn't
 * block the session autostart pipeline.
 *
 * Usage: npx tsx src/start-monitor-daemon.ts
 */

import { runNpxTsx } from '../core/run-command.js';
import { resolve, dirname } from 'path';
import * as fs from 'fs';

const ROOT = resolve(process.cwd());
const PID_FILE = resolve(ROOT, '.runtime', 'monitor-daemon.pid');
const LOG_FILE = resolve(ROOT, '.runtime', 'monitor-daemon.log');

// Check if already running
if (fs.existsSync(PID_FILE)) {
  try {
    const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
    try {
      process.kill(oldPid, 0); // Check if alive
      console.log('[MONITOR-DAEMON] Already running (PID:', oldPid + ')');
      process.exit(0);
    } catch {
      // Dead — remove stale PID file
      fs.rmSync(PID_FILE);
    }
  } catch {
    fs.rmSync(PID_FILE, { force: true });
  }
}

// Run the monitor through Node + tsx directly. This avoids the cmd.exe ->
// npx.cmd wrapper that caused visible startup flashes and orphan consoles.
//
// CRITICAL (process-hygiene canon, AGENTS.md): a detached daemon must NOT hold
// stdout/stderr PIPE descriptors whose reader dies with the launcher — the
// child then gets EPIPE on its first write and silently crashes (observed:
// timeout-monitor-init logged [OK] but the daemon died before writing its PID
// file under the autostart pipeline). Instead, pass the log file descriptor
// directly as stdout+stderr so the daemon's output is durable regardless of
// the launcher's lifetime. stdin stays 'ignore'.
fs.mkdirSync(dirname(LOG_FILE), { recursive: true });
const logFd = fs.openSync(LOG_FILE, 'a');
const child = runNpxTsx('src/core/timeout-monitor.ts', ['--daemon', '--interval', '60000'], {
  cwd: ROOT,
  detached: true,
  stdio: ['ignore', logFd, logFd],
  windowsHide: true,
});

// Error handler
child.on('error', (err: Error) => {
  console.error('[MONITOR-DAEMON] Spawn error:', err.message);
  process.exit(1);
});

// Wait briefly for spawn to succeed or fail
setTimeout(() => {
  if (!child.pid || child.killed) {
    console.error('[MONITOR-DAEMON] Process failed to start');
    process.exit(1);
  }

  // Unref so main process can exit independently
  child.unref();

  console.log('[MONITOR-DAEMON] Started (PID:', child.pid + ')');
  process.exit(0);
}, 500);
