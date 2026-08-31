#!/usr/bin/env node
/**
 * NPM CI Check
 *
 * Validates that CI uses npm ci / pnpm install --frozen-lockfile
 * instead of npm install to prevent version drift.
 */

import { existsSync, readFileSync } from 'fs';
import { readdirSync } from 'fs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const CI_DIR = '.github/workflows';

interface CheckResult {
  file: string;
  usesFrozenLockfile: boolean;
  usesNpmInstall: boolean;
  issues: string[];
}

function checkCIWorkflows(): number {
  console.log('\n[npm-ci-check] Checking CI workflows for npm ci compliance...\n');

  if (!existsSync(CI_DIR)) {
    console.log('[npm-ci-check] No .github/workflows directory found, skipping');
    return 0;
  }

  const workflowFiles = readdirSync(CI_DIR).filter(
    (f) => f.endsWith('.yml') || f.endsWith('.yaml'),
  );

  if (workflowFiles.length === 0) {
    console.log('[npm-ci-check] No workflow files found, skipping');
    return 0;
  }

  const results: CheckResult[] = [];
  let totalIssues = 0;

  for (const file of workflowFiles) {
    const filePath = join(CI_DIR, file);
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    const result: CheckResult = {
      file,
      usesFrozenLockfile: false,
      usesNpmInstall: false,
      issues: [],
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Check for pnpm with --frozen-lockfile
      if (/pnpm\s+install\s+.*--frozen-lockfile/.test(line)) {
        result.usesFrozenLockfile = true;
      }

      // Check for npm ci
      if (/npm\s+ci/.test(line)) {
        result.usesFrozenLockfile = true;
      }

      // Check for bare npm install (bad)
      if (/npm\s+install\s*$/.test(line) || /npm\s+install\s+[^-]/.test(line)) {
        result.usesNpmInstall = true;
        result.issues.push(`Line ${lineNum}: Uses 'npm install' instead of 'npm ci'`);
      }

      // Check for bare pnpm install without --frozen-lockfile
      if (/pnpm\s+install\s*$/.test(line)) {
        result.usesNpmInstall = true;
        result.issues.push(`Line ${lineNum}: Uses 'pnpm install' without --frozen-lockfile`);
      }
    }

    results.push(result);
    totalIssues += result.issues.length;
  }

  // Print results
  for (const result of results) {
    if (result.issues.length > 0) {
      console.log(`⚠️  ${result.file}:`);
      result.issues.forEach((issue) => console.log(`   ${issue}`));
      console.log();
    } else if (result.usesFrozenLockfile) {
      console.log(`✅ ${result.file}: Uses frozen lockfile`);
    } else {
      console.log(`⚠️  ${result.file}: No install step detected`);
    }
  }

  if (totalIssues > 0) {
    console.error(`\n[BLOCKED] Found ${totalIssues} issue(s) in CI workflows`);
    console.error('\nTo fix:');
    console.error('  - Replace "npm install" with "npm ci"');
    console.error('  - Replace "pnpm install" with "pnpm install --frozen-lockfile"');
    console.error('\nWhy:');
    console.error('  npm ci respects package-lock.json exactly');
    console.error('  npm install can drift versions and cause "works on my machine"');
    return 1;
  }

  console.log('\n[OK] All CI workflows use frozen lockfile');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(checkCIWorkflows());
}

export { checkCIWorkflows };
