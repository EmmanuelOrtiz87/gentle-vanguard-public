#!/usr/bin/env node
/**
 * start-monitor-daemon.ts — Starts timeout/performance monitor as detached daemon
 *
 * Spawns the monitor daemon in a detached background process so it doesn't
 * block the session autostart pipeline.
 *
 * Usage: npx tsx src/start-monitor-daemon.ts
 */

import { spawn } from 'child_process';
import { resolve } from 'path';
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

// On Windows: npx.cmd needs shell:true + full command string (no args array => no deprecation warning)
const child = spawn('npx tsx src/core/timeout-monitor.ts --daemon --interval 60000', [], {
  cwd: ROOT,
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
  shell: true,
});

// Error handler
child.on('error', (err: any) => {
  console.error('[MONITOR-DAEMON] Spawn error:', err.message);
  process.exit(1);
});

// Wait briefly for spawn to succeed or fail
setTimeout(() => {
  if (!child.pid || child.killed) {
    console.error('[MONITOR-DAEMON] Process failed to start');
    process.exit(1);
  }

  // Write PID file
  fs.writeFileSync(PID_FILE, String(child.pid), 'utf-8');

  // Log output
  const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  if (child.stdout) child.stdout.pipe(logStream);
  if (child.stderr) child.stderr.pipe(logStream);

  // Unref so main process can exit independently
  child.unref();

  console.log('[MONITOR-DAEMON] Started (PID:', child.pid + ')');
  process.exit(0);
}, 500);
