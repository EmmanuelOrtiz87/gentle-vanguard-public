#!/usr/bin/env node
/**
 * session-autostart-detached.ts — Fire-and-forget launcher for the autostart pipeline.
 *
 * WHY THIS EXISTS
 * --------------
 * The autostart pipeline spawns lazy background daemons (e.g. ci-rollback-engine
 * with its setInterval health-check timer). On Windows, spawning those via a
 * `shell:true` chain (cmd.exe -> npx.cmd -> node) lets the daemons inherit the
 * calling shell's stdout pipe handles. Even though the autostart process itself
 * now calls `process.exit(0)` (see src/core/session-autostart.ts), the daemons
 * keep the pipe open, so a synchronous caller (CI step, hook, or an agent shell)
 * waits for EOF forever and hits an artificial timeout.
 *
 * HOW THIS LAUNCHER WORKS
 * -----------------------
 * It spawns the real autostart detached (`detached: true`, `windowsHide: true`,
 * no shell) and passes the env var `AUTOSTART_LOG_FILE` pointing to a per-run
 * timestamped log file. The autostart core then redirects its own console
 * output to that file natively — no reliance on cmd.exe `>` inline redirection,
 * which does not survive detached process groups on Windows.
 * Key points:
 *   - The lazy daemons inherit the FILE descriptor (not the caller's pipe),
 *     so the caller's shell gets EOF as soon as the autostart main process
 *     exits (process.exit(0)) and returns instantly.
 *   - Per-run timestamped log name -> immune to EBUSY (a previous run can never
 *     hold the same file), and keeps history for observability.
 *   - Old logs (older than 7 days) are pruned automatically.
 *
 * USAGE
 * -----
 *   npm run session:autostart:detached
 *   npx tsx src/session-autostart-detached.ts [-- args...]
 *
 * To run the autostart synchronously and wait for it, use the normal entry:
 *   npx tsx src/session-autostart.ts
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const LOG_DIR = path.join(ROOT, '.runtime');

// Per-run timestamped log: immune to EBUSY and keeps history.
fs.mkdirSync(LOG_DIR, { recursive: true });
const ts = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\.\d{3}Z$/, '');
const LOG_PATH = path.join(LOG_DIR, `autostart-detached-${ts}.log`);

// Prune logs older than 7 days (best-effort, non-blocking).
try {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const f of fs.readdirSync(LOG_DIR)) {
    if (f.startsWith('autostart-detached-') && f.endsWith('.log')) {
      const full = path.join(LOG_DIR, f);
      if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
    }
  }
} catch {
  /* ignore prune errors */
}

const args = process.argv.slice(2);

// The autostart core redirects its own output to AUTOSTART_LOG_FILE natively
// (see src/core/session-autostart.ts) — no shell needed at all, which avoids
// both cmd.exe console nesting and the DEP0190 deprecation warning. The lazy
// daemons never inherit the caller's pipe either.
const child = spawn(
  process.execPath,
  ['--import', 'tsx', path.join(ROOT, 'src', 'session-autostart.ts'), ...args],
  {
    cwd: ROOT,
    stdio: 'ignore',
    windowsHide: true,
    detached: true,
    env: { ...process.env, AUTOSTART_LOG_FILE: LOG_PATH },
  },
);

child.unref();

// Nothing is printed on purpose — the caller should return immediately and not
// depend on any output from the detached background process. The pipeline log
// for this run is at .runtime/autostart-detached-<timestamp>.log (the lazy step
// log lives at logs/session-autostart-lazy.log).
