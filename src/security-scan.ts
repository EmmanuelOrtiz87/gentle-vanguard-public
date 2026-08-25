#!/usr/bin/env node
/**
 * Security Scan — Security analysis wrapper for Gentle-Vanguard.
 * Performs dependency scanning, code analysis, and compliance checks.
 *
 * Migrated from: skills/security-expert-skill/security-scan.ps1
 * Consolidates: src/check-security.ts, src/security-orchestrator.ts
 *
 * Usage:
 *   npx tsx src/security-scan.ts [--scan <type>] [--output <file>]
 *     --scan <type>   Scan type: deps | code | compliance | all (default)
 *     --output <file> JSON output path
 *     --quiet         Minimal output
 */

import { runSync } from './core/run-command.js';
import { existsSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(process.cwd());
const args = process.argv.slice(2);

interface ScanResult {
  type: string;
  passed: boolean;
  issues: string[];
  timestamp: string;
}

function runScan(type: string): ScanResult {
  const result: ScanResult = {
    type,
    passed: true,
    issues: [],
    timestamp: new Date().toISOString(),
  };

  try {
    switch (type) {
      case 'deps': {
        // Dependency vulnerability scan
        runSync('pnpm', ['audit', '--audit-level=high'], { cwd: ROOT, stdio: 'pipe' });
        break;
      }
      case 'code': {
        // Code quality scan
        runSync('npx', ['tsc', '--noEmit'], { cwd: ROOT, stdio: 'pipe' });
        break;
      }
      case 'compliance': {
        // Check security configs exist
        const checks = [
          'config/security-policy.json',
          'config/owner-auth.json.enc',
          'src/privacy-gateway.ts',
          'src/security-orchestrator.ts',
          '.github/CODEOWNERS',
          '.github/dependabot.yml',
        ];
        for (const check of checks) {
          if (!existsSync(join(ROOT, check))) {
            result.issues.push(`Missing: ${check}`);
          }
        }
        result.passed = result.issues.length === 0;
        break;
      }
    }
  } catch (err: unknown) {
    result.passed = false;
    const execErr = err as { stderr?: { toString(): string }; message?: string };
    result.issues.push(execErr.stderr?.toString() || execErr.message || 'Unknown error');
  }

  return result;
}

// ─── CLI Entry Point ───────────────────────────────────────────────

const quiet = args.includes('--quiet');
const outputIdx = args.indexOf('--output');
const outputPath = outputIdx >= 0 && outputIdx + 1 < args.length ? args[outputIdx + 1] : undefined;
const scanType = args.find((a) => ['deps', 'code', 'compliance', 'all'].includes(a)) || 'all';

const types = scanType === 'all' ? ['deps', 'code', 'compliance'] : [scanType];
const results = types.map(runScan);

const summary = {
  results,
  passed: results.every((r) => r.passed),
  total: results.length,
  passedCount: results.filter((r) => r.passed).length,
  failedCount: results.filter((r) => !r.passed).length,
  timestamp: new Date().toISOString(),
};

if (outputPath) {
  writeFileSync(outputPath, JSON.stringify(summary, null, 2));
}

if (!quiet) {
  console.log(JSON.stringify(summary, null, 2));
}

process.exit(summary.passed ? 0 : 1);
