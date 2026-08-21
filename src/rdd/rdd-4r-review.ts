#!/usr/bin/env node
/**
 * 4R Review Lenses — Four-lens review system for high-risk changes
 *
 * The 4R review covers:
 *   - RISK: Security, safety, and dangerous behavior
 *   - READABILITY: Clarity and maintainability
 *   - RELIABILITY: Correctness and edge cases
 *   - RESILIENCE: Failure modes and recovery
 *
 * This is the Tier 2 review (high risk) per RDD protocol.
 * Tier 0 (low): 0 lenses (structural readback)
 * Tier 1 (standard): 1 lens (focused on specific aspect)
 * Tier 2 (high): 4 lenses (full 4R review)
 *
 * Native Gentle-Vanguard implementation. No gentle-ai CLI dependency.
 */

import { pathToFileURL } from 'url';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ReviewLens = 'risk' | 'readability' | 'reliability' | 'resilience';

export interface ReviewFinding {
  lens: ReviewLens;
  severity: 'critical' | 'required' | 'nit' | 'optional' | 'info';
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

export interface Review4R {
  receiptId: string;
  riskFindings: ReviewFinding[];
  readabilityFindings: ReviewFinding[];
  reliabilityFindings: ReviewFinding[];
  resilienceFindings: ReviewFinding[];
  approved: boolean;
  reviewer: string;
  timestamp: string;
}

export interface LensChecklist {
  lens: ReviewLens;
  items: string[];
  weight: number;
}

// ─── 4R Checklists ─────────────────────────────────────────────────────────────

const RISK_CHECKLIST: string[] = [
  'Input validation on all external data',
  'No SQL/command injection vulnerabilities',
  'No hardcoded secrets or credentials',
  'Proper authentication/authorization checks',
  'Sensitive data properly encrypted/handled',
  'Rate limiting considered',
  'CORS policies appropriate',
  'No prototype pollution risks',
  'XSS prevention (output escaping)',
  'CSRF tokens where applicable',
];

const READABILITY_CHECKLIST: string[] = [
  'Function names clearly describe behavior',
  'Complex logic has comments explaining why',
  'No magic numbers (use named constants)',
  'Consistent naming conventions',
  'Formatting matches project style',
  'Dead code removed',
  'File/class structure is intuitive',
  'Documentation comments for public APIs',
  'Variable names meaningful',
  'Code is idiomatic for the language',
];

const RELIABILITY_CHECKLIST: string[] = [
  'Unit tests cover happy path',
  'Unit tests cover edge cases',
  'Error conditions are tested',
  'TypeScript types are correct/precise',
  'No race conditions',
  'Async/await used properly (no callback hell)',
  'Resources properly disposed',
  'Null/undefined handled safely',
  'Math/finance logic double-checked',
  'Build passes (typecheck, lint)',
];

const RESILIENCE_CHECKLIST: string[] = [
  'Errors are caught and handled',
  'Fail gracefully (no crashes)',
  'Timeouts on external calls',
  'Circuit breaker or retry logic considered',
  'Health checks if applicable',
  'Metrics/logging for monitoring',
  'Feature flags for risky changes',
  'Backwards compatibility maintained',
  'Rollback plan documented',
  'Database migrations are reversible',
];

export const LENS_CHECKLISTS: Record<ReviewLens, LensChecklist> = {
  risk: {
    lens: 'risk',
    items: RISK_CHECKLIST,
    weight: 25,
  },
  readability: {
    lens: 'readability',
    items: READABILITY_CHECKLIST,
    weight: 25,
  },
  reliability: {
    lens: 'reliability',
    items: RELIABILITY_CHECKLIST,
    weight: 25,
  },
  resilience: {
    lens: 'resilience',
    items: RESILIENCE_CHECKLIST,
    weight: 25,
  },
};

// ─── Pattern-Based Auto-Detection ────────────────────────────────────────────

interface RiskPattern {
  pattern: RegExp;
  lens: ReviewLens;
  severity: 'critical' | 'required' | 'nit';
  message: string;
}

const RISK_PATTERNS: RiskPattern[] = [
  {
    pattern: /eval\s*\(/,
    lens: 'risk',
    severity: 'critical',
    message: 'eval() detected — remote code execution risk',
  },
  {
    pattern: /innerHTML\s*=/,
    lens: 'risk',
    severity: 'required',
    message: 'innerHTML assignment — potential XSS',
  },
  {
    pattern: /dangerouslySetInnerHTML/,
    lens: 'risk',
    severity: 'required',
    message: 'dangerouslySetInnerHTML requires sanitization',
  },
  {
    pattern: /password\s*[:=]+\s*["\']/,
    lens: 'risk',
    severity: 'critical',
    message: 'Potential hardcoded password',
  },
  {
    pattern: /api[_-]?key\s*[:=]+\s*["\']/,
    lens: 'risk',
    severity: 'critical',
    message: 'Potential hardcoded API key',
  },
  {
    pattern: /secret\s*[:=]+\s*["\']/,
    lens: 'risk',
    severity: 'critical',
    message: 'Potential hardcoded secret',
  },
  {
    pattern: /SELECT\s+.*\s+FROM/i,
    lens: 'risk',
    severity: 'required',
    message: 'Raw SQL — verify parameterized queries',
  },
  {
    pattern: /exec\s*\(\s* req\.query/i,
    lens: 'risk',
    severity: 'critical',
    message: 'Command injection risk — never execute user input',
  },
  {
    pattern: /TODO\s*:\s*security/i,
    lens: 'risk',
    severity: 'required',
    message: 'Security TODO found — must be addressed',
  },
  {
    pattern: /FIXME\s*:\s*security/i,
    lens: 'risk',
    severity: 'required',
    message: 'Security FIXME found — must be addressed',
  },
  {
    pattern: /any\s*:\s*any/,
    lens: 'reliability',
    severity: 'nit',
    message: 'Using any:any — prefer proper types',
  },
  {
    pattern: /@ts-ignore/,
    lens: 'reliability',
    severity: 'required',
    message: '@ts-ignore suppresses errors — add explanation',
  },
  {
    pattern: /@ts-expect-error/,
    lens: 'reliability',
    severity: 'nit',
    message: 'TypeScript error expected — verify this is intentional',
  },
  {
    pattern: /catch\s*\(\s*\)\s*\{/,
    lens: 'resilience',
    severity: 'required',
    message: 'Empty catch block — swallowing errors',
  },
  {
    pattern: /catch\s*\(\s*e\s*\)\s*\{\s*\}/,
    lens: 'resilience',
    severity: 'required',
    message: 'Empty catch block — errors silently ignored',
  },
  {
    pattern: /console\.log/,
    lens: 'readability',
    severity: 'nit',
    message: 'console.log should be removed or converted to proper logging',
  },
  {
    pattern: /debugger;/,
    lens: 'readability',
    severity: 'required',
    message: 'debugger statement found — must be removed',
  },
  {
    pattern: /FIXME\s*:/i,
    lens: 'reliability',
    severity: 'nit',
    message: 'FIXME found — should be addressed before merge',
  },
  {
    pattern: /TODO\s*:/i,
    lens: 'reliability',
    severity: 'nit',
    message: 'TODO found — create ticket if not addressed',
  },
  {
    pattern: /setTimeout\s*\(\s*function/,
    lens: 'resilience',
    severity: 'nit',
    message: 'setTimeout with function — ensure cleanup on unmount',
  },
  {
    pattern: /setInterval\s*\(/,
    lens: 'resilience',
    severity: 'required',
    message: 'setInterval requires cleanup — check for memory leaks',
  },
  {
    pattern: /\.then\s*\([^)]*\)\s*\.then/,
    lens: 'readability',
    severity: 'nit',
    message: 'Promise chain — consider async/await for readability',
  },
  {
    pattern: /var\s+/,
    lens: 'readability',
    severity: 'nit',
    message: 'var used — prefer const/let',
  },
  {
    pattern: /==\s*null/,
    lens: 'reliability',
    severity: 'nit',
    message: '== null — prefer === for clarity',
  },
  {
    pattern: /!=\s*null/,
    lens: 'reliability',
    severity: 'nit',
    message: '!= null — prefer !== for clarity',
  },
];

// ─── Auto-Review Engine ────────────────────────────────────────────────────────

export function autoReviewFile(filePath: string, content: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const { pattern, lens, severity, message } of RISK_PATTERNS) {
    if (pattern.test(content)) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          findings.push({
            lens,
            severity,
            message,
            file: filePath,
            line: i + 1,
          });
        }
      }
    }
  }

  return findings;
}

export function autoReviewChanges(files: string[]): ReviewFinding[] {
  const allFindings: ReviewFinding[] = [];
  const ROOT = resolve(process.cwd());

  for (const file of files) {
    try {
      const fullPath = join(ROOT, file);
      if (!existsSync(fullPath)) continue;

      // Only review code files
      if (!/\.(ts|tsx|js|jsx|py|go|rs|java|cs)$/.test(file)) continue;

      const content = readFileSync(fullPath, 'utf-8');
      const findings = autoReviewFile(file, content);
      allFindings.push(...findings);
    } catch {
      // Skip files that can't be read
    }
  }

  return allFindings;
}

// ─── Review Generation ─────────────────────────────────────────────────────────

export function generateReview4R(receiptId: string, files: string[], reviewer: string): Review4R {
  const autoFindings = autoReviewChanges(files);

  const review: Review4R = {
    receiptId,
    riskFindings: autoFindings.filter((f) => f.lens === 'risk'),
    readabilityFindings: autoFindings.filter((f) => f.lens === 'readability'),
    reliabilityFindings: autoFindings.filter((f) => f.lens === 'reliability'),
    resilienceFindings: autoFindings.filter((f) => f.lens === 'resilience'),
    approved: false,
    reviewer,
    timestamp: new Date().toISOString(),
  };

  // Auto-approve if no critical findings
  const criticalCount = autoFindings.filter((f) => f.severity === 'critical').length;
  review.approved = criticalCount === 0;

  return review;
}

export function formatReview4R(review: Review4R): string {
  const lines: string[] = [];

  lines.push('╔════════════════════════════════════════════════════════════════════════╗');
  lines.push('║                     4R REVIEW RESULT                                   ║');
  lines.push('╚════════════════════════════════════════════════════════════════════════╝');
  lines.push('');
  lines.push(`Receipt: ${review.receiptId}`);
  lines.push(`Reviewer: ${review.reviewer}`);
  lines.push(`Status: ${review.approved ? '✓ APPROVED' : '✗ CHANGES REQUIRED'}`);
  lines.push(`Time: ${new Date(review.timestamp).toLocaleString()}`);
  lines.push('');

  const lenses: { name: string; findings: ReviewFinding[] }[] = [
    { name: 'RISK', findings: review.riskFindings },
    { name: 'READABILITY', findings: review.readabilityFindings },
    { name: 'RELIABILITY', findings: review.reliabilityFindings },
    { name: 'RESILIENCE', findings: review.resilienceFindings },
  ];

  for (const { name, findings } of lenses) {
    lines.push('─'.repeat(70));
    lines.push(`[${name}] ${findings.length} finding(s)`);
    lines.push('─'.repeat(70));

    if (findings.length === 0) {
      lines.push('  ✓ No issues detected');
    } else {
      for (const f of findings) {
        const icon = f.severity === 'critical' ? '🔴' : f.severity === 'required' ? '🟡' : '🟢';
        lines.push(`  ${icon} [${f.severity.toUpperCase()}] ${f.message}`);
        if (f.file) {
          lines.push(`     File: ${f.file}${f.line ? `:${f.line}` : ''}`);
        }
        lines.push('');
      }
    }
    lines.push('');
  }

  lines.push('═'.repeat(70));

  return lines.join('\n');
}

// ─── Manual Review Support ─────────────────────────────────────────────────────

export function startInteractiveReview(_receiptId: string): void {
  console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
  console.log('║              INTERACTIVE 4R REVIEW SESSION                             ║');
  console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

  console.log('Review this change through the 4R lenses:\n');

  for (const [lens, checklist] of Object.entries(LENS_CHECKLISTS)) {
    console.log(`${lens.toUpperCase()} (${checklist.weight}% weight):`);
    console.log('─'.repeat(60));
    for (const item of checklist.items) {
      console.log(`  □ ${item}`);
    }
    console.log('');
  }

  console.log('Instructions:');
  console.log('  1. Review the code manually');
  console.log('  2. Check off items in the checklist');
  console.log('  3. Record findings via: receipt-manager create --findings=<json>');
  console.log('');
}

// ─── CLI Entry ─────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void (async () => {
    const args = process.argv.slice(2);
    const action = args[0] ?? 'auto';

    try {
      switch (action) {
        case 'auto': {
          const receiptId = args.find((a) => a.startsWith('--receipt='))?.split('=')[1];
          const files = args.filter((a) => !a.startsWith('--'));

          if (!receiptId) {
            console.error('Usage: auto --receipt=<id> [file1] [file2] ...');
            process.exit(1);
          }

          const reviewer = process.env.USER || process.env.USERNAME || 'system';
          const review = generateReview4R(receiptId, files.length > 0 ? files : [], reviewer);

          if (args.includes('--json')) {
            console.log(JSON.stringify(review, null, 2));
          } else {
            console.log(formatReview4R(review));
          }

          process.exit(review.approved ? 0 : 1);
          break;
        }

        case 'interactive': {
          const receiptId = args.find((a) => a.startsWith('--receipt='))?.split('=')[1];

          if (!receiptId) {
            console.error('Usage: interactive --receipt=<id>');
            process.exit(1);
          }

          startInteractiveReview(receiptId);
          break;
        }

        case 'checklist': {
          const lens = args[1] as ReviewLens;

          if (lens && LENS_CHECKLISTS[lens]) {
            const checklist = LENS_CHECKLISTS[lens];
            console.log(`\n${lens.toUpperCase()} Checklist (${checklist.weight}% weight):\n`);
            checklist.items.forEach((item, i) => {
              console.log(`  ${i + 1}. □ ${item}`);
            });
          } else {
            console.log('\nAll 4R Checklists:\n');
            for (const [name, checklist] of Object.entries(LENS_CHECKLISTS)) {
              console.log(`${name.toUpperCase()} (${checklist.weight}%):`);
              checklist.items.slice(0, 3).forEach((item) => console.log(`  • ${item}`));
              console.log(`  ... and ${checklist.items.length - 3} more`);
              console.log('');
            }
          }
          break;
        }

        default:
          console.log('Usage: rdd-4r-review.ts <action> [options]');
          console.log('');
          console.log('Actions:');
          console.log('  auto --receipt=<id> [files...]     Run automated 4R review');
          console.log('  interactive --receipt=<id>         Start interactive review session');
          console.log('  checklist [lens]                   Show 4R checklists');
          console.log('');
          console.log('Options:');
          console.log('  --json    Output as JSON');
          console.log('');
          console.log('Lenses: risk, readability, reliability, resilience');
          process.exit(1);
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  })();
}
