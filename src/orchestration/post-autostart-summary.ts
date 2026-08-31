#!/usr/bin/env node
/**
 * Post-Autostart Summary — Generates a startup summary JSON with session,
 * git, and timezone info. Writes to reports/startup-summary.json.
 *
 * Migrated from: scripts/utilities/post-autostart-summary.ps1
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { runSync } from '../core/run-command.js';

interface Args {
  TimeZone?: string;
  PeakStart?: number;
  PeakEnd?: number;
  Region?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-TimeZone' && argv[i + 1]) args.TimeZone = argv[++i];
    else if (arg === '-PeakStart' && argv[i + 1]) args.PeakStart = Number(argv[++i]);
    else if (arg === '-PeakEnd' && argv[i + 1]) args.PeakEnd = Number(argv[++i]);
    else if (arg === '-Region' && argv[i + 1]) args.Region = argv[++i];
  }
  return args;
}

function resolveRoot(): string {
  if (process.env.GENTLE_VANGUARD_BASE_DIR) {
    const base = process.env.GENTLE_VANGUARD_BASE_DIR;
    if (existsSync(join(base, 'config', 'orchestrator.json'))) return base;
  }
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'config', 'orchestrator.json'))) return dir;
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  console.error('[SUMMARY] ERROR: Could not locate repository root.');
  process.exit(1);
}

function gitCmd(root: string, cmd: string): string | null {
  try {
    const r = runSync('git', ['-C', root, ...cmd.split(/\s+/)], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return r.stdout.trim();
  } catch {
    return null;
  }
}

function getSessionInfo(root: string): {
  sessionId: string | null;
  timezone: string | null;
  peakStart: number | null;
  peakEnd: number | null;
  region: string | null;
} {
  // Try to get session info from the most recent session file
  const sessionDirs = [join(root, '.session'), join(root, 'session')];

  for (const sessionDir of sessionDirs) {
    if (!existsSync(sessionDir)) continue;
    try {
      const files = readdirSync(sessionDir)
        .filter((f: string) => f.startsWith('session-') && f.endsWith('.json'))
        .sort()
        .reverse();
      if (files.length === 0) continue;
      const data = JSON.parse(readFileSync(join(sessionDir, files[0]), 'utf-8'));
      return {
        sessionId: data.sessionId ?? data.id ?? null,
        timezone: data.timezone ?? data.timeZone ?? null,
        peakStart: data.peakStart ?? data.peak_start ?? null,
        peakEnd: data.peakEnd ?? data.peak_end ?? null,
        region: data.region ?? null,
      };
    } catch {
      continue;
    }
  }
  return { sessionId: null, timezone: null, peakStart: null, peakEnd: null, region: null };
}

function main(): Record<string, any> {
  const args = parseArgs(process.argv);
  const root = resolveRoot();
  const timestamp = new Date().toISOString();

  // Get session info from session file (more reliable than args)
  const sessionInfo = getSessionInfo(root);
  const sessionId = sessionInfo.sessionId;
  const branch = gitCmd(root, 'rev-parse --abbrev-ref HEAD');
  const lastCommit = gitCmd(root, 'log -1 --format="%H"');

  // Use session file values first, then args, then use defaults from notifications config
  const notifications = {
    timezone: 'America/Argentina/Buenos_Aires',
    peakStart: 9,
    peakEnd: 15,
    region: 'Argentina',
  };
  try {
    const configPath = join(root, 'config', 'session-autostart.config.json');
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (config.notifications) {
        Object.assign(notifications, config.notifications);
      }
    }
  } catch {}

  // Build summary with fallbacks: session file > args > config > null
  const summary = {
    timestamp,
    sessionId,
    timezone: sessionInfo.timezone ?? args.TimeZone ?? notifications.timezone ?? null,
    peakStart: sessionInfo.peakStart ?? args.PeakStart ?? notifications.peakStart ?? null,
    peakEnd: sessionInfo.peakEnd ?? args.PeakEnd ?? notifications.peakEnd ?? null,
    region: sessionInfo.region ?? args.Region ?? notifications.region ?? null,
    workspace: {
      branch,
      lastCommit,
    },
  };

  const outDir = join(root, 'reports');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'startup-summary.json');
  writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n', 'utf-8');

  console.log(`[SUMMARY] Startup summary written to ${outPath}`);
  console.log(`  timestamp : ${timestamp}`);
  console.log(`  sessionId : ${sessionId}`);
  console.log(`  branch    : ${branch}`);
  console.log(`  lastCommit: ${lastCommit}`);
  console.log(`  timezone  : ${summary.timezone}`);
  console.log(`  peakStart : ${summary.peakStart}`);
  console.log(`  peakEnd   : ${summary.peakEnd}`);
  console.log(`  region    : ${summary.region}`);

  // Return success without process.exit to avoid breaking pipeline
  return summary;
}

main();
