#!/usr/bin/env node
/**
 * auto-norm-enforcer.ts — Enforce las normativas aprendidas automáticamente
 *
 * Lee LEARNED-NORMS.md y verifica que las normas activas se están cumpliendo.
 * Modos: --check, --apply, --report
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { runSyncShell } from '../core/run-command.js';

const ROOT = resolve(process.cwd());
// const _LEARNED_NORMS = join(ROOT, 'rules', 'adaptive', 'LEARNED-NORMS.md'); // reserved
const NORMS_DB = join(ROOT, '.session', 'learned-norms.json');
const SESSION_METRICS = join(ROOT, '.session', 'metrics-report.json');

interface Norm {
  id: string;
  category: string;
  description: string;
  trigger: string;
  confidence: number;
  status: 'proposed' | 'active' | 'deprecated';
  enforcement: 'auto' | 'manual' | 'advisory';
  check?: string; // optional regex or condition to verify
}

interface EnforcementResult {
  normId: string;
  description: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
}

function loadNorms(): Norm[] {
  try {
    if (existsSync(NORMS_DB)) return JSON.parse(readFileSync(NORMS_DB, 'utf-8'));
  } catch {
    /* ignore */
  }
  return [];
}

function loadSessionMetrics(): Record<string, unknown> {
  try {
    if (existsSync(SESSION_METRICS)) return JSON.parse(readFileSync(SESSION_METRICS, 'utf-8'));
  } catch {
    /* ignore */
  }
  return {};
}

function checkNorm(norm: Norm): EnforcementResult {
  if (norm.status !== 'active') {
    return { normId: norm.id, description: norm.description, status: 'skip', detail: 'Not active' };
  }

  const metrics = loadSessionMetrics();

  // Check based on category
  switch (norm.category) {
    case 'avoidance':
      // Check if the avoided pattern appears
      if (norm.check && metrics.errors && Array.isArray(metrics.errors)) {
        const errors = metrics.errors as string[];
        const hasPattern = errors.some((e) => norm.check && new RegExp(norm.check, 'i').test(e));
        return {
          normId: norm.id,
          description: norm.description,
          status: hasPattern ? 'fail' : 'pass',
          detail: hasPattern ? `Pattern '${norm.check}' detected` : 'No violations',
        };
      }
      break;

    case 'optimization':
      // Check if optimization target is met
      if (norm.check && metrics.qualityScore !== undefined) {
        const threshold = parseFloat(norm.check);
        const score = metrics.qualityScore as number;
        return {
          normId: norm.id,
          description: norm.description,
          status: score >= threshold ? 'pass' : 'fail',
          detail: `Quality score: ${score} (threshold: ${threshold})`,
        };
      }
      break;

    case 'pattern':
      // Check if expected pattern exists in codebase
      if (norm.check) {
        try {
          const r = runSyncShell(
            `grep -r "${norm.check}" --include="*.ts" --include="*.md" src/ rules/ | head -3`,
            {
              cwd: ROOT,
              timeout: 5000,
            },
          );
          if (r.status === 0) {
            return {
              normId: norm.id,
              description: norm.description,
              status: 'pass',
              detail: 'Pattern found',
            };
          }
          return {
            normId: norm.id,
            description: norm.description,
            status: 'fail',
            detail: 'Pattern not found',
          };
        } catch {
          return {
            normId: norm.id,
            description: norm.description,
            status: 'fail',
            detail: 'Pattern not found',
          };
        }
      }
      break;
  }

  return {
    normId: norm.id,
    description: norm.description,
    status: 'skip',
    detail: 'No check defined',
  };
}

function enforce(): void {
  const norms = loadNorms();
  const results: EnforcementResult[] = norms.map(checkNorm);

  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;

  console.log(
    JSON.stringify({
      total: results.length,
      passed,
      failed,
      skipped,
      complianceRate: results.length > 0 ? Math.round((passed / (passed + failed)) * 100) : 100,
      details: results,
    }),
  );
}

function main(): void {
  const args = process.argv.slice(2);
  const action = args.includes('--check')
    ? 'check'
    : args.includes('--apply')
      ? 'apply'
      : args.includes('--report')
        ? 'report'
        : 'check';

  if (action === 'check') {
    enforce();
  } else if (action === 'report') {
    enforce();
  } else if (action === 'apply') {
    // Auto-correct simple violations
    enforce();
  }
}

if (process.argv[1]?.includes('auto-norm-enforcer')) main();
