#!/usr/bin/env node

/**
 * reset-demo.ts — Reset Demo 07 to clean state (TS replacement for reset-demo.ps1)
 * Cleans all demo artifacts and re-runs preflight.
 *
 * Usage:
 *   npx tsx demos/07-mixed-cookbook-real-request/reset-demo.ts
 *   npx tsx demos/07-mixed-cookbook-real-request/reset-demo.ts --skip-preflight
 */

import { execSync } from 'child_process';
import { existsSync, rmSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(process.cwd());
const DEMO_DIR = join(ROOT, 'demos', '07-mixed-cookbook-real-request');

const args = process.argv.slice(2);
const skipPreflight = args.includes('--skip-preflight') || args.includes('-SkipPreflight');

function step(msg: string): void { console.log(`\n=== ${msg} ===`); }
function ok(msg: string): void { console.log(`[OK] ${msg}`); }
function warn(msg: string): void { console.log(`[WARN] ${msg}`); }
function info(msg: string): void { console.log(`[INFO] ${msg}`); }

async function main(): Promise<void> {
  step('Demo 07 - Reset to Clean State');
  info(`Workspace: ${ROOT}`);

  // 1. Clean demo artifacts
  step('Cleaning demo artifacts');
  const artifacts = [
    join(DEMO_DIR, 'results'),
    join(DEMO_DIR, 'output'),
    join(DEMO_DIR, 'logs'),
    join(ROOT, 'demos', 'shared', 'task-tracker', 'tasks.json'),
    join(ROOT, '.orchestrator-active'),
    join(ROOT, '.session'),
    join(ROOT, '.runtime'),
    join(ROOT, '.codegraph'),
    join(ROOT, '.telemetry'),
  ];

  for (const artifact of artifacts) {
    if (existsSync(artifact)) {
      rmSync(artifact, { recursive: true, force: true });
      ok(`Removed: ${artifact}`);
    }
  }

  // 2. Clean session-related runtime files
  step('Cleaning session data');
  const sessionDirs = [
    join(ROOT, '.session'),
    join(ROOT, '.telemetry'),
  ];
  for (const dir of sessionDirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      ok(`Removed: ${dir}`);
    }
  }

  // 3. Optionally re-run preflight
  if (!skipPreflight) {
    step('Re-running preflight');
    try {
      execSync('npx tsx demos/07-mixed-cookbook-real-request/preflight.ts', {
        cwd: ROOT,
        stdio: 'inherit',
        timeout: 60000,
      });
    } catch {
      warn('Preflight had some issues, but demo can still run');
    }
  }

  step('Reset Complete');
  info('Demo environment is clean and ready.');
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
