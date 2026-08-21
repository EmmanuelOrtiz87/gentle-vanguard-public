#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { runSync, runNpxTsxSync } from './core/run-command.js';
import { pathToFileURL } from 'url';

interface SecretPattern {
  Name: string;
  Pattern: string;
  Severity: string;
}

const hookStart = new Date();

function main(): void {
  const args = process.argv.slice(2);
  let fast = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--fast':
        fast = true;
        break;
    }
  }

  const cwd = resolve(process.cwd());

  const gitResult = runSync('git', ['rev-parse', '--show-toplevel'], { cwd });
  const gitRoot = gitResult.stdout?.trim();

  if (!gitRoot || gitResult.status !== 0) {
    console.log('\x1b[33m[SKIP] Not in a git repository.\x1b[0m');
    process.exit(0);
  }

  const skillDir = dirname(dirname(process.argv[1] || '.'));
  const reviewScript = join(skillDir, 'code-review.ts');

  if (!existsSync(reviewScript)) {
    console.log('\x1b[33m[SKIP] Code Review Orchestrator not found.\x1b[0m');
    process.exit(0);
  }

  const stagedResult = runSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
    cwd: gitRoot,
  });
  const stagedFiles = stagedResult.stdout?.trim();

  if (!stagedFiles) {
    console.log('\x1b[32m[OK] No files staged for commit.\x1b[0m');
    process.exit(0);
  }

  console.log('');
  console.log('\x1b[36m========================================\x1b[0m');
  console.log('\x1b[36m Code Review - Pre-commit Scan\x1b[0m');
  console.log('\x1b[36m========================================\x1b[0m');
  console.log('');

  const markerPath = join(gitRoot, '.hooks', 'pre-commit.marker');

  if (existsSync(markerPath)) {
    console.log('\x1b[33m[SKIP] Reentrant hook detected. Skipping nested execution.\x1b[0m');
    process.exit(0);
  }

  try {
    const hooksDir = join(gitRoot, '.hooks');
    if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });
    writeFileSync(markerPath, '', 'utf-8');

    console.log('Scanning staged files for issues...\n');

    const criticalPatterns: SecretPattern[] = [
      { Name: 'AWS Access Key', Pattern: 'AKIA[0-9A-Z]{16}', Severity: 'CRITICAL' },
      { Name: 'GitHub Token', Pattern: 'ghp_[A-Za-z0-9]{36}', Severity: 'CRITICAL' },
      { Name: 'Private Key', Pattern: '-----BEGIN.*PRIVATE KEY-----', Severity: 'CRITICAL' },
      { Name: 'Stripe Key', Pattern: 'sk_live_[0-9a-zA-Z]{24,}', Severity: 'CRITICAL' },
      {
        Name: 'SendGrid Key',
        Pattern: 'SG\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}',
        Severity: 'CRITICAL',
      },
      {
        Name: 'Generic API Key',
        Pattern: '(?i)(api[_-]?key|apikey)[\\"\'\\s]*[=:][\\"\'\\s]*[A-Za-z0-9]{20,}',
        Severity: 'HIGH',
      },
      {
        Name: 'Database URL',
        Pattern: '(?i)(mysql|postgres|mongodb)://[^:\\s]+:[^@\\s]+@',
        Severity: 'HIGH',
      },
    ];

    let criticalFound = false;

    const files = stagedFiles.split(/\r?\n/);
    for (const file of files) {
      if (!file.trim()) continue;

      const showResult = runSync('git', ['show', `:0:${file}`], { cwd: gitRoot });
      const content = showResult.stdout;
      if (!content) continue;

      for (const pattern of criticalPatterns) {
        const regex = new RegExp(pattern.Pattern, 'g');
        if (regex.test(content)) {
          const color = pattern.Severity === 'CRITICAL' ? '\x1b[31m' : '\x1b[35m';
          console.log(`  ${color}[${pattern.Severity}] ${file} - ${pattern.Name}\x1b[0m`);

          if (pattern.Severity === 'CRITICAL') criticalFound = true;
        }
      }
    }

    console.log('');

    if (criticalFound) {
      console.log('\x1b[31m========================================\x1b[0m');
      console.log('\x1b[31m BLOCKED - Critical issues detected!\x1b[0m');
      console.log('\x1b[31m========================================\x1b[0m');
      console.log('');
      console.log('\x1b[37mCritical secrets detected in staged files.\x1b[0m');
      console.log('\x1b[90mRemove or secure credentials before committing.\x1b[0m');
      console.log('');
      console.log('\x1b[90mRun code review for details.\x1b[0m');
      console.log('');

      try {
        unlinkSync(markerPath);
      } catch {
        /* */
      }
      process.exit(1);
    }

    if (fast) {
      console.log('\x1b[32m[OK] Fast scan passed (no critical issues)\x1b[0m');
      try {
        unlinkSync(markerPath);
      } catch {
        /* */
      }
      process.exit(0);
    }

    console.log('Running full orchestrator scan...\n');

    const scanResult = runNpxTsxSync(reviewScript, ['--scope', 'quick', '--path', gitRoot], {
      cwd: gitRoot,
    });

    const exitCode = scanResult.status ?? 0;

    console.log('');
    const elapsed = Math.round((new Date().getTime() - hookStart.getTime()) / 1000);
    console.log('\x1b[36m========================================\x1b[0m');
    console.log(`\x1b[36m Scan completed in ${elapsed}s\x1b[0m`);
    console.log('\x1b[36m========================================\x1b[0m');
    console.log('');

    try {
      unlinkSync(markerPath);
    } catch {
      /* */
    }

    if (exitCode === 1) {
      console.log('\x1b[33mRun code review for detailed report.\x1b[0m');
    }

    process.exit(exitCode);
  } catch (e: unknown) {
    console.log(
      `\x1b[33m[WARN] Pre-commit scan encountered an error: ${e instanceof Error ? e.message : String(e)}\x1b[0m`,
    );
    try {
      unlinkSync(markerPath);
    } catch {
      /* */
    }
    process.exit(0);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
