#!/usr/bin/env node

/**
 * preflight.ts — Demo 07 preflight setup (TS replacement for preflight.ps1)
 * Ensures the workspace is ready to run the demo on a fresh machine.
 *
 * Usage:
 *   npx tsx demos/07-mixed-cookbook-real-request/preflight.ts
 *   npx tsx demos/07-mixed-cookbook-real-request/preflight.ts --force
 */

import { execSync } from 'child_process';
import { existsSync, rmSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(process.cwd());
const DEMO_DIR = join(ROOT, 'demos', '07-mixed-cookbook-real-request');

const args = process.argv.slice(2);
const force = args.includes('--force') || args.includes('-Force');
const skipPreflight = args.includes('--skip-preflight') || args.includes('-SkipPreflight');

function step(msg: string): void {
  console.log(`\n=== ${msg} ===`);
}
function ok(msg: string): void {
  console.log(`[OK] ${msg}`);
}
function warn(msg: string): void {
  console.log(`[WARN] ${msg}`);
}
function info(msg: string): void {
  console.log(`[INFO] ${msg}`);
}
function fail(msg: string): void {
  console.error(`[FAIL] ${msg}`);
}

function checkCommand(cmd: string): boolean {
  try {
    execSync(`where ${cmd}`, { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  step('Demo 07 - Mixed Cookbook Preflight');
  info(`Workspace: ${ROOT}`);

  // 1. Verify Go and Git
  step('Checking prerequisites');
  if (checkCommand('go')) {
    ok('Go available');
  } else {
    fail('Go not found. Install from https://go.dev/');
    process.exit(1);
  }
  if (checkCommand('git')) {
    ok('Git available');
  } else {
    fail('Git not found. Install from https://git-scm.com/');
    process.exit(1);
  }

  // 2. Activate orchestrator
  step('Checking orchestrator status');
  const markerFile = join(ROOT, '.orchestrator-active');
  if (existsSync(markerFile)) {
    ok('Orchestrator already active');
  } else {
    info('Orchestrator not active (can be activated during demo)');
  }

  // 3. Check Engram
  step('Checking tools');
  if (checkCommand('engram')) {
    ok('Engram available');
  } else {
    warn('Engram not found. Demo is runnable without it - just skip Segment 4');
  }

  // 4. Clean task-tracker runtime data
  step('Preparing task-tracker demo');
  const trackerDb = join(ROOT, 'demos', 'shared', 'task-tracker', 'tasks.json');
  if (existsSync(trackerDb)) {
    rmSync(trackerDb, { force: true });
    ok('Cleaned previous task-tracker run');
  } else {
    info('No prior task-tracker data found (fresh start)');
  }

  // 5. Verify Go task-tracker
  step('Verifying task-tracker CLI');
  const trackerRoot = join(ROOT, 'demos', 'shared', 'task-tracker');
  try {
    const result = execSync('go run . stats', {
      cwd: trackerRoot,
      encoding: 'utf8',
      timeout: 30000,
    }).trim();
    ok(`task-tracker CLI works: ${result}`);
  } catch {
    warn('task-tracker CLI had issues (may self-correct on first real run)');
  }

  step('Preflight Complete');
  info('Ready to run the demo. Next steps:');
  info('  1. npx tsx src/cli/gv.ts info');
  info('  2. Follow recipe in ./demos/07-mixed-cookbook-real-request/DEMO.md');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
