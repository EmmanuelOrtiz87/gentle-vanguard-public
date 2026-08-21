#!/usr/bin/env node
/**
 * bootstrap-symlink.ts — Auto-create runtime module resolution symlink
 *
 * Creates a junction (Windows) or symlink (Linux/Mac) at
 *   apps/web-dashboard/node_modules/@gentle-vanguard/core
 * pointing to src/core, so both tsc (via tsconfig paths) and tsx (via node_modules)
 * can resolve @gentle-vanguard/core/* imports.
 *
 * This is idempotent — safe to run at every session start.
 */

import * as fs from 'fs';
import { resolve } from 'path';
import { runSyncShell } from './core/run-command.js';

const ROOT = resolve(process.cwd());
const LINK_PARENT = resolve(ROOT, 'apps', 'web-dashboard', 'node_modules', '@gentle-vanguard');
const LINK_PATH = resolve(LINK_PARENT, 'core');
const TARGET_PATH = resolve(ROOT, 'src', 'core');

function checkExists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function main(): void {
  // Check if symlink already exists and is valid
  if (checkExists(LINK_PATH)) {
    try {
      const real = fs.realpathSync(LINK_PATH);
      if (real === TARGET_PATH) {
        console.log('[BOOTSTRAP] Symlink already valid:', LINK_PATH, '→', TARGET_PATH);
        return;
      }
      // Wrong target — remove and recreate
      console.log('[BOOTSTRAP] Symlink points to wrong target, recreating...');
      fs.rmSync(LINK_PATH, { recursive: true, force: true });
    } catch {
      // Broken symlink — recreate
      console.log('[BOOTSTRAP] Symlink broken, recreating...');
      fs.rmSync(LINK_PATH, { recursive: true, force: true });
    }
  }

  // Ensure parent directory exists
  if (!checkExists(LINK_PARENT)) {
    fs.mkdirSync(LINK_PARENT, { recursive: true });
  }

  // Create the symlink/junction
  const platform = process.platform;
  if (platform === 'win32') {
    // Use junction on Windows (works without admin)
    const cmd = `mklink /J "${LINK_PATH}" "${TARGET_PATH}"`;
    runSyncShell(cmd, { stdio: 'pipe' });
    console.log('[BOOTSTRAP] Junction created:', LINK_PATH, '→', TARGET_PATH);
  } else {
    // Use symlink on Unix
    fs.symlinkSync(TARGET_PATH, LINK_PATH, 'junction');
    console.log('[BOOTSTRAP] Symlink created:', LINK_PATH, '→', TARGET_PATH);
  }

  // Verify
  if (!checkExists(LINK_PATH)) {
    console.error('[BOOTSTRAP] ERROR: Symlink creation failed');
    process.exit(1);
  }
  if (!checkExists(resolve(LINK_PATH, 'timeout-config.ts'))) {
    console.error('[BOOTSTRAP] ERROR: Symlink created but target not accessible');
    process.exit(1);
  }

  console.log('[BOOTSTRAP] ✅ Runtime module resolution ready');
}

main();
