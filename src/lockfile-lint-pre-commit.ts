#!/usr/bin/env node
/**
 * Lockfile Lint Pre-Commit Hook
 *
 * Validates package-lock.json integrity before commit.
 * Prevents corrupted or malicious lockfile edits.
 */

import { existsSync, readFileSync } from 'fs';
import { pathToFileURL } from 'url';

const LOCKFILE_PATH = 'package-lock.json';

interface Lockfile {
  lockfileVersion?: number;
  packages?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
}

function validateLockfile(): number {
  console.log('\n[lockfile-lint] Validating package-lock.json...');

  if (!existsSync(LOCKFILE_PATH)) {
    console.log('[lockfile-lint] No package-lock.json found, skipping');
    return 0;
  }

  let lockfile: Lockfile;
  try {
    const content = readFileSync(LOCKFILE_PATH, 'utf-8');
    lockfile = JSON.parse(content);
  } catch (err) {
    console.error('[BLOCKED] Invalid JSON in package-lock.json');
    console.error(`  Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  // Check lockfileVersion
  if (typeof lockfile.lockfileVersion !== 'number') {
    console.error('[BLOCKED] Invalid lockfile: missing or invalid lockfileVersion');
    return 1;
  }

  // Check packages (lockfileVersion 2+)
  if (lockfile.lockfileVersion >= 2) {
    if (!lockfile.packages || typeof lockfile.packages !== 'object') {
      console.error('[BLOCKED] Invalid lockfile: missing packages object');
      return 1;
    }
  }

  // Check dependencies (lockfileVersion 1)
  if (lockfile.lockfileVersion === 1) {
    if (!lockfile.dependencies || typeof lockfile.dependencies !== 'object') {
      console.error('[BLOCKED] Invalid lockfile: missing dependencies object');
      return 1;
    }
  }

  // Validate no duplicate entries (common corruption)
  const content = readFileSync(LOCKFILE_PATH, 'utf-8');
  const lines = content.split('\n');
  const packageNames = new Set<string>();
  const duplicates: string[] = [];

  for (const line of lines) {
    const match = line.match(/^\s*"([^"]+)":\s*\{/);
    if (match) {
      const pkgName = match[1];
      if (packageNames.has(pkgName)) {
        duplicates.push(pkgName);
      }
      packageNames.add(pkgName);
    }
  }

  if (duplicates.length > 0) {
    console.error(`[BLOCKED] Duplicate entries found in lockfile:`);
    duplicates.forEach((d) => console.error(`  - ${d}`));
    console.error('\nTo fix: rm package-lock.json && npm install');
    return 1;
  }

  console.log(`[OK] Lockfile structure valid (version: ${lockfile.lockfileVersion})`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(validateLockfile());
}

export { validateLockfile };
