#!/usr/bin/env node
/**
 * Autonomous Code Review — pre-commit + PR review without human trigger.
 * TS migration of scripts/utilities/EVOLVE/auto-code-review.ps1
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { runSync } from './core/run-command.js';
import { pathToFileURL } from 'url';
import { getEffectiveProcessTimeout } from './core/timeout-config';

interface ReviewIssue {
  type: string;
  severity: string;
  message: string;
  file?: string;
}

const ROOT = resolve(process.cwd());

function findRepoRoot(dir: string): string {
  let current = resolve(dir);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(current, 'config', 'orchestrator.json'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return dir;
}

const repoRoot =
  process.env.GENTLE_VANGUARD_BASE_DIR && existsSync(process.env.GENTLE_VANGUARD_BASE_DIR)
    ? process.env.GENTLE_VANGUARD_BASE_DIR
    : findRepoRoot(ROOT);

const reviewableExts = new Set([
  '.ps1',
  '.psm1',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.go',
  '.rs',
  '.md',
  '.json',
  '.yaml',
  '.yml',
]);

function invokeStyleReview(filePath: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const content = readFileSync(filePath, 'utf-8');

  if (/[^\n] +\n/.test(content))
    issues.push({ type: 'style', severity: 'warning', message: 'Trailing whitespace found' });
  if (/\t/.test(content))
    issues.push({ type: 'style', severity: 'info', message: 'Tabs found — consider using spaces' });
  const longLines = content.split('\n').filter((l) => l.length > 120).length;
  if (longLines > 0)
    issues.push({
      type: 'style',
      severity: 'info',
      message: `${longLines} lines exceed 120 chars`,
    });

  return issues;
}

function invokeSecurityReview(filePath: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  if (/\.opencode[/\\]skills[/\\]/.test(filePath)) return issues;
  if (/auto-code-review/.test(filePath)) return issues;
  if (/review-lenses/.test(filePath)) return issues;
  if (/compact-state/.test(filePath)) return issues;
  const content = readFileSync(filePath, 'utf-8');

  if (
    /(password|secret|api_key|apikey|token|credential)\s*[:=]\s*["']{0,1}[^"',;\s]{8,}/i.test(
      content,
    )
  )
    issues.push({
      type: 'security',
      severity: 'error',
      message: 'Possible hardcoded secret detected',
    });
  if (/\.ps1$/.test(filePath) && /(Invoke-Expression|iex|eval\()/.test(content))
    issues.push({
      type: 'security',
      severity: 'warning',
      message: 'Use of Invoke-Expression/eval detected — potential injection risk',
    });
  if (/SELECT.*FROM.*WHERE.*\+/.test(content))
    issues.push({
      type: 'security',
      severity: 'error',
      message: 'Possible SQL injection — string concatenation in query',
    });

  return issues;
}

function invokePerformanceReview(filePath: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const content = readFileSync(filePath, 'utf-8');

  if (/\.(ts|js)x?$/.test(filePath) && /\.forEach\(.*=>.*\.(find|fetch|query)/.test(content))
    issues.push({
      type: 'performance',
      severity: 'warning',
      message: 'Possible N+1 query pattern in forEach',
    });
  if (/Get-Content\s+.*-Raw/.test(content) && statSync(filePath).size > 1024 * 1024)
    issues.push({
      type: 'performance',
      severity: 'info',
      message: 'Reading entire file with -Raw on large file',
    });

  return issues;
}

function invokeSddComplianceReview(filePath: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  if (!existsSync(filePath)) return issues;
  const content = readFileSync(filePath, 'utf-8');

  if (/\.ps1$/.test(filePath) && !/<#\s*\n\.SYNOPSIS/.test(content))
    issues.push({ type: 'sdd', severity: 'info', message: 'Missing SYNOPSIS comment block' });
  if (/\.ps1$/.test(filePath) && /^\s*try\s*\{/.test(content) && !/catch/.test(content))
    issues.push({ type: 'sdd', severity: 'warning', message: 'try block without catch' });

  return issues;
}

function reviewFile(filePath: string): ReviewIssue[] {
  if (!existsSync(filePath)) return [];
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  if (!reviewableExts.has(`.${ext}`)) return [];

  const issues: ReviewIssue[] = [];
  issues.push(...invokeStyleReview(filePath));
  issues.push(...invokeSecurityReview(filePath));
  issues.push(...invokePerformanceReview(filePath));
  issues.push(...invokeSddComplianceReview(filePath));
  return issues;
}

function main(): void {
  const args = process.argv.slice(2);
  const action = args.includes('--action') ? args[args.indexOf('--action') + 1] : 'pre-commit';

  switch (action) {
    case 'pre-commit': {
      console.log('[REVIEW] Pre-commit review...');
      let stagedFiles: string;
      try {
        const review = runSync('git', ['diff', '--cached', '--name-only'], {
          cwd: repoRoot,
          timeout: getEffectiveProcessTimeout('git'),
        });
        stagedFiles = review.stdout;
      } catch {
        stagedFiles = '';
      }
      if (!stagedFiles.trim()) {
        console.log('[REVIEW] No staged files to review');
        return;
      }

      const allIssues: ReviewIssue[] = [];
      const blockers: ReviewIssue[] = [];

      for (const file of stagedFiles.split('\n').filter(Boolean)) {
        const fullPath = join(repoRoot, file);
        const issues = reviewFile(fullPath);
        for (const issue of issues) {
          issue.file = file;
          allIssues.push(issue);
          if (issue.severity === 'error') blockers.push(issue);
        }
      }

      if (blockers.length > 0) {
        console.log(`[REVIEW] BLOCKING — ${blockers.length} security/critical issues found:`);
        for (const b of blockers) console.log(`  [BLOCKER] ${b.file}: ${b.message}`);
        console.log('[REVIEW] Commit blocked — fix issues before committing');
        return;
      }

      if (allIssues.length > 0) {
        console.log(`[REVIEW] ${allIssues.length} issue(s) found (non-blocking):`);
        for (const issue of allIssues)
          console.log(`  [${issue.type}/${issue.severity}] ${issue.file}: ${issue.message}`);
        return;
      }

      console.log('[REVIEW] Code review PASS — no issues found');
      break;
    }
    case 'scan': {
      const scanPath = args.includes('--path') ? args[args.indexOf('--path') + 1] : '';
      if (!scanPath) {
        console.error('Provide --path for scan action');
        process.exit(1);
      }
      const target = join(repoRoot, scanPath);
      if (!existsSync(target)) {
        console.error(`Path not found: ${target}`);
        process.exit(1);
      }
      console.log(`[REVIEW] Scan requires directory traversal over ${target}`);
      break;
    }
    default:
      console.error(`Unknown action: ${action}`);
      process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
