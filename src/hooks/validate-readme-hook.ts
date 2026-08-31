#!/usr/bin/env node

import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { runSync, runNpxTsxSync } from '../core/run-command.js';
import { join, dirname, basename } from 'path';

function findRepoRoot(startDir: string): string | null {
  let candidate = startDir;
  while (candidate) {
    if (existsSync(join(candidate, 'config', 'orchestrator.json'))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return null;
}

function main(): number {
  const repoRoot = process.env.GENTLE_VANGUARD_BASE_DIR || findRepoRoot(process.cwd());

  if (!repoRoot) {
    console.log('[SKIP] Cannot determine repo root for README validation');
    return 0;
  }

  const stagedResult = runSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM']);

  const stagedRaw = stagedResult.stdout?.trim();
  if (!stagedRaw) return 0;

  const stagedFiles = stagedRaw.split('\n').filter(Boolean);
  let readmeChanged = false;

  for (const file of stagedFiles) {
    if (basename(file) === 'README.md') {
      readmeChanged = true;
      break;
    }
  }

  if (!readmeChanged) return 0;

  console.log('');
  console.log('=== README Governance Check ===');
  console.log('README.md changes detected - running governance validation...');
  console.log('');

  // Try TS equivalent first
  const validateScriptTs = join(repoRoot, 'src', 'tools', 'validate-readme.ts');
  if (existsSync(validateScriptTs)) {
    const result = runNpxTsxSync('src/tools/validate-readme.ts', ['--repo', 'both'], {
      stdio: 'inherit',
      cwd: repoRoot,
    });
    return result.status ?? 0;
  }

  // PS1 fallback
  const validateScript = join(repoRoot, 'scripts', 'utilities', 'validate', 'validate-readme.ps1');
  if (!existsSync(validateScript)) {
    console.log(
      '[WARN] validate-readme not found (neither TS nor PS1) - skipping governance check',
    );
    return 0;
  }

  const result = runSync(
    'pwsh',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', validateScript, '-Repo', 'both'],
    {
      stdio: 'inherit',
      cwd: repoRoot,
    },
  );

  const exitCode = result.status ?? 0;

  if (exitCode !== 0) {
    console.log('');
    console.log('==========================================');
    console.log(' COMMIT BLOCKED - README governance validation failed!');
    console.log(' See rules/README-GOVERNANCE.md for policy details');
    console.log('==========================================');
    console.log('');
    console.log('To bypass (emergency only):');
    console.log('  git commit --no-verify');
    console.log('');
  }

  return exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { main as validateReadmeHook };
