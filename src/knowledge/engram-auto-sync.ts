#!/usr/bin/env node
/**
 * Engram Auto-Sync — Automatic integrity maintenance with file-lock
 * concurrency control and periodic monitoring.
 *
 * Modes: check, sync, monitor
 * - check: Verify checksums match the DB
 * - sync: Regenerate checksums with lock protection
 * - monitor: Infinite-loop periodic check-and-auto-fix
 *
 * Migrated from: scripts/utilities/memory/ENGRAM/engram-auto-sync.ps1
 */

import { existsSync, writeFileSync, mkdirSync, unlinkSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { runNpxTsxSync } from '../core/run-command.js';
import { resolveEngramDbPath } from './engram-paths.js';

interface Args {
  Mode?: 'check' | 'sync' | 'monitor';
  CheckIntervalMinutes?: number;
  Quiet?: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-Mode' && argv[i + 1]) args.Mode = argv[++i] as Args['Mode'];
    else if (arg === '-CheckIntervalMinutes' && argv[i + 1])
      args.CheckIntervalMinutes = Number(argv[++i]);
    else if (arg === '-Quiet') args.Quiet = true;
  }
  return args;
}

const ROOT = resolve(process.env.GENTLE_VANGUARD_BASE_DIR || process.cwd());
const integrityScriptTs = join(ROOT, 'src', 'knowledge', 'engram-integrity-check.ts');
// The live store is ENGRAM_DATA_DIR/engram.db (~/.engram by default). The old
// `<repo>/.engram-data` path never existed here, so every check logged
// "Database not found, skipping" and reported OK without reading anything.
const dbPath = resolveEngramDbPath();
const exportManifestPath = join(ROOT, '.engram', 'manifest.json');
const checksumPath = join(ROOT, '.engram', 'checksums.sha256');
const lockFile = join(ROOT, '.runtime', 'engram-sync.lock');
const lastCheckFile = join(ROOT, '.runtime', 'engram-last-sync.json');

let quiet = false;

function log(msg: string, level: 'INFO' | 'OK' | 'WARN' | 'ERR' = 'INFO') {
  if (quiet && level !== 'ERR') return;
  const colors: Record<string, string> = {
    INFO: '\x1b[36m',
    OK: '\x1b[32m',
    WARN: '\x1b[33m',
    ERR: '\x1b[31m',
  };
  console.log(`${colors[level] ?? ''}[ENGRAM-SYNC] [${level}] ${msg}\x1b[0m`);
}

// Checksums cover the exported chunks (.engram/), not the live DB, so the
// freshness comparison uses the export manifest instead of the DB mtime.
function getExportLastModified(): Date | null {
  if (!existsSync(exportManifestPath)) return null;
  return statSync(exportManifestPath).mtime;
}

function getChecksumLastModified(): Date | null {
  if (!existsSync(checksumPath)) return null;
  return statSync(checksumPath).mtime;
}

function runIntegrityScript(mode: string): number {
  // Array-form spawn via runNpxTsxSync (procesos-ocultos compliant): the old
  // runSyncShell + `npx tsx` string routed through cmd.exe and made the exit
  // code path fragile.
  const r = runNpxTsxSync(integrityScriptTs, ['-Mode', mode, '-Quiet'], {
    cwd: ROOT,
    stdio: 'pipe',
  });
  return r.status ?? 1;
}

function checkSynchronization(): boolean {
  log('Checking Engram synchronization...');

  if (!existsSync(dbPath)) {
    log('Database not found, skipping', 'WARN');
    return true;
  }

  const exportTime = getExportLastModified();
  const checksumTime = getChecksumLastModified();

  if (!checksumTime) {
    log('Checksums not found, regenerating...', 'WARN');
    return syncChecksums();
  }

  if (exportTime && exportTime > checksumTime) {
    const diffSec = Math.round((exportTime.getTime() - checksumTime.getTime()) / 1000);
    log(`Export modified ${diffSec}s after checksums — regenerating`, 'WARN');
    if (!syncChecksums()) return false;
  }

  const exitCode = runIntegrityScript('check');
  if (exitCode !== 0) {
    log('Integrity verification failed', 'WARN');
    return false;
  }

  writeMarker();
  log('Synchronization OK', 'OK');
  return true;
}

function writeMarker(): void {
  try {
    writeFileSync(
      lastCheckFile,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          status: 'SUCCESS',
          dbPath,
          dbModified: existsSync(dbPath) ? statSync(dbPath).mtime.toISOString() : null,
          exportModified: getExportLastModified()?.toISOString() ?? null,
          checksumModified: getChecksumLastModified()?.toISOString() ?? null,
        },
        null,
        2,
      ),
      'utf-8',
    );
  } catch {
    /* telemetry only */
  }
}

function syncChecksums(): boolean {
  log('Regenerating checksums...');

  if (!existsSync(dbPath)) {
    log('Database not found, skipping sync', 'WARN');
    return true;
  }

  const lockDir = join(ROOT, '.runtime');
  if (!existsSync(lockDir)) mkdirSync(lockDir, { recursive: true });

  if (existsSync(lockFile)) {
    const lockAge = (Date.now() - statSync(lockFile).mtimeMs) / 1000;
    if (lockAge < 30) {
      log('Another sync in progress, skipping', 'WARN');
      return false;
    }
  }

  writeFileSync(lockFile, new Date().toISOString(), 'utf-8');

  try {
    const syncExit = runIntegrityScript('checksums');
    if (syncExit !== 0) {
      log('Checksum regeneration failed', 'ERR');
      return false;
    }

    const verifyExit = runIntegrityScript('check');
    if (verifyExit === 0) {
      log('Checksums synchronized', 'OK');
      writeMarker();
      return true;
    } else {
      log('Verification after sync failed', 'ERR');
      return false;
    }
  } finally {
    try {
      unlinkSync(lockFile);
    } catch {
      /* ignore */
    }
  }
}

function invokePeriodicMonitor(intervalMinutes: number): void {
  log(`Starting periodic monitor (interval: ${intervalMinutes}min)`);

  const check = () => {
    log('Checking sync status...');
    if (!checkSynchronization()) {
      log('Out of sync detected, auto-fixing...', 'WARN');
      if (syncChecksums()) {
        log('Auto-fix successful', 'OK');
      } else {
        log('Auto-fix failed, manual intervention may be needed', 'ERR');
      }
    }
    log(`Next check in ${intervalMinutes} minutes`);
  };

  check();
  setInterval(check, intervalMinutes * 60 * 1000);
}

function main() {
  const args = parseArgs(process.argv);
  const mode = args.Mode ?? 'check';
  quiet = args.Quiet ?? false;
  const interval = args.CheckIntervalMinutes ?? 60;

  switch (mode) {
    case 'check':
      process.exit(checkSynchronization() ? 0 : 1);
      break;
    case 'sync':
      process.exit(syncChecksums() ? 0 : 1);
      break;
    case 'monitor':
      invokePeriodicMonitor(interval);
      break;
    default:
      console.error(`[ENGRAM-SYNC] Unknown mode: ${mode}`);
      process.exit(1);
  }
}

main();
