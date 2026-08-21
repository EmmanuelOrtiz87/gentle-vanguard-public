#!/usr/bin/env node

/**
 * create-installer.ts — Build NSIS installer for Gentle-Vanguard (TS replacement for build/create-installer.ps1)
 *
 * Prerequisites: NSIS 3+ installed (makensis.exe in PATH)
 *
 * Usage:
 *   npx tsx src/cli/create-installer.ts              # Full build
 *   npx tsx src/cli/create-installer.ts --skip-encrypt  # Skip encryption
 *   npx tsx src/cli/create-installer.ts --dry-run       # Dry run
 */

import { runSyncShell } from '../core/run-command.js';
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(process.cwd());
const BUILD_DIR = join(ROOT, 'build');
const DIST_DIR = join(ROOT, 'dist');

const args = process.argv.slice(2);
const skipEncrypt = args.includes('--skip-encrypt') || args.includes('-SkipEncrypt');
const dryRun = args.includes('--dry-run') || args.includes('-DryRun');

function step(msg: string): void {
  console.log(`[BUILD] ${msg}`);
}
function ok(msg: string): void {
  console.log(`  [OK] ${msg}`);
}
function warn(msg: string): void {
  console.log(`  [WARN] ${msg}`);
}
function err(msg: string): void {
  console.error(`  [ERROR] ${msg}`);
}

function run(cmd: string, label: string): boolean {
  try {
    step(`Running: ${label}`);
    if (!dryRun) runSyncShell(cmd, { stdio: 'inherit', timeout: 300000 });
    else warn(`Dry run: would execute ${label}`);
    return true;
  } catch (e) {
    err(`${label} failed: ${(e as Error).message}`);
    return false;
  }
}

function main(): void {
  console.log('');
  console.log('========================================');
  console.log('  Gentle-Vanguard Installer Builder (TS)');
  console.log('========================================');
  console.log('');

  if (dryRun) step('DRY RUN MODE');

  // Ensure dist directory
  if (!existsSync(DIST_DIR) && !dryRun) mkdirSync(DIST_DIR, { recursive: true });

  // Phase 1: Encrypt scripts
  if (!skipEncrypt) {
    step('Phase 1: Encrypting scripts');
    const ok_ = run('npx tsx src/cli/protect.ts', 'encrypt scripts');
    if (!ok_) {
      err('Encryption failed, aborting');
      process.exit(1);
    }
  } else {
    warn('Skipping encryption phase');
  }

  // Phase 2: Verify NSIS
  step('Phase 2: Verifying NSIS');
  try {
    const nsis = runSyncShell('makensis /VERSION', { stdio: 'pipe', timeout: 10000 });
    if (nsis.status === 0) ok('NSIS found');
    else throw new Error('makensis not in PATH');
  } catch {
    warn('makensis not found in PATH. Install NSIS 3+ from https://nsis.sourceforge.io/');
    warn('Continuing with artifact preparation only...');

    // Still prepare the artifacts
    if (!dryRun) {
      const nsiScript = join(BUILD_DIR, 'gentle-vanguard-installer-auto.nsi');
      if (existsSync(nsiScript)) {
        copyFileSync(nsiScript, join(DIST_DIR, 'installer.nsi'));
        ok(`NSIS script copied to ${DIST_DIR}`);
      }
    }
    process.exit(0);
  }

  // Phase 3: Build installer
  step('Phase 3: Building installer');
  const nsiScript = join(BUILD_DIR, 'gentle-vanguard-installer-auto.nsi');
  const installerName = 'Gentle-Vanguard-Setup.exe';

  if (existsSync(nsiScript)) {
    const ok_ = run(`makensis "${nsiScript}"`, 'makensis');
    if (!ok_) {
      err('NSIS build failed');
      process.exit(1);
    }

    // Find output
    const expected = join(DIST_DIR, installerName);
    if (!dryRun && existsSync(expected)) {
      ok(`Installer created: ${expected}`);
    }
  } else {
    warn(`NSIS script not found at ${nsiScript}`);
    warn('Run protect.ts first to generate the installer script');
  }

  // Phase 4: Post-build summary
  step('Phase 4: Build summary');
  const distFiles = dryRun ? [] : readdirSync(DIST_DIR);
  console.log('');
  if (!dryRun) {
    ok(`Distribution directory: ${DIST_DIR}`);
    ok(`Files: ${distFiles.join(', ')}`);
  }
  step('Build complete');
}

main();
