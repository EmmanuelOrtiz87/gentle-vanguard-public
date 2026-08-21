#!/usr/bin/env node

/**
 * Test Runner — runs all valid test suites across the Gentle-Vanguard codebase.
 *
 * Suites:
 *   - Config tests:       npx tsx --test tests/config/*.test.ts        (6 tests)
 *   - Workflow tests:     npx tsx --test tests/workflows/*.test.ts     (2 tests)
 *   - Unit tests (basic): npx tsx --test tests/unit/staged-review.test.ts  (8 tests)
 *   - Eval tests:         npx vitest run --config vitest.eval.config.ts (~5 tests, needs vitest)
 *
 * Usage: npx tsx src/test-runner.ts [--all] [--verbose]
 */

import { runSyncShell } from './core/run-command.js';
import { existsSync } from 'fs';

interface Suite {
  name: string;
  cmd: string;
  args: string[];
  required: boolean; // false = optional deps, skip gracefully
  timeout?: number; // custom timeout ms (default 120_000)
}

const SUITES: Suite[] = [
  {
    name: 'Config Tests',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/config/*.test.ts'],
    required: true,
  },
  {
    name: 'Workflow Tests',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/workflows/*.test.ts'],
    required: true,
  },
  {
    name: 'Unit Tests (all)',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/unit/*.test.ts'],
    required: true,
  },
  {
    name: 'Security Orchestrator Tests',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/security/security-orchestrator.test.ts'],
    required: true,
  },
  {
    name: 'Encryption Manager Tests',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/security/encryption-manager.test.ts'],
    required: true,
  },
  {
    name: 'Privacy Sanitizer Tests',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/security/privacy-sanitizer.test.ts'],
    required: true,
  },
  {
    name: 'Secrets Manager Tests',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/security/secrets-manager.test.ts'],
    required: true,
  },
  {
    name: 'Security Logger Tests',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/security/security-logger.test.ts'],
    required: true,
  },
  {
    name: 'Input Validation Tests',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/security/input-validation.test.ts'],
    required: true,
  },
  {
    name: 'Input Validator Tests',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/security/input-validator.test.ts'],
    required: true,
  },
  {
    name: 'Security Checks Tests',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/security/security-checks.test.ts'],
    required: true,
  },
  {
    name: 'Session Autostart Integration',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/integration/session-autostart.test.ts'],
    required: true,
    timeout: 180_000,
  },
  {
    name: 'Routing Critical Flows Integration',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/integration/routing-critical-flows.test.ts'],
    required: true,
    timeout: 180_000,
  },
  {
    name: 'Auto-Delegation Router Integration',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/integration/auto-delegation-router.test.ts'],
    required: true,
  },
  {
    name: 'Tool Detection Integration',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/integration/detect-tool.test.ts'],
    required: true,
  },
  {
    name: 'Engram Orchestrator Integration',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/integration/engram-orchestrator.test.ts'],
    required: true,
  },
  {
    name: 'Session Persistence Integration',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/integration/engram-session-persistence.test.ts'],
    required: true,
  },
  {
    name: 'Post-Session Learning Integration',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/integration/post-session-learning.test.ts'],
    required: true,
  },
  {
    name: 'Pre-Close Validator Integration',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/integration/pre-close-validator.test.ts'],
    required: true,
  },
];

const OPTIONAL_SUITES: Suite[] = [
  {
    name: 'Eval Tests (vitest)',
    cmd: 'npx',
    args: ['vitest', 'run', '--config', 'vitest.eval.config.ts'],
    required: false,
  },
  {
    name: 'Unit Tests (receipt-manager)',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/unit/receipt-manager.test.ts'],
    required: false,
  },
  {
    name: 'Unit Tests (MCP skill-server)',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/unit/mcp/skill-server.test.ts'],
    required: false,
  },
  {
    name: 'Integration Tests (cloud-connectors)',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/integration/cloud-connectors/*.test.ts'],
    required: false,
  },
  {
    name: 'Skills Tests',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/skills/*.test.ts'],
    required: false,
  },
];

function parseArgs(): { all: boolean; verbose: boolean } {
  const args = process.argv.slice(2);
  return {
    all: args.includes('--all') || args.includes('-a'),
    verbose: args.includes('--verbose') || args.includes('-v'),
  };
}

function runSuite(suite: Suite, verbose: boolean): { passed: boolean; output: string } {
  const label = `[${suite.name}]`;
  try {
    const result = runSyncShell(`${suite.cmd} ${suite.args.join(' ')}`, {
      timeout: suite.timeout ?? 120_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const output = result.stdout + result.stderr;
    const passed = result.status === 0;

    if (verbose || !passed) {
      process.stdout.write(`${label} ${passed ? 'PASS' : 'FAIL'}\n`);
      if (!passed && verbose) {
        const lines = output.split('\n').slice(-10).join('\n');
        process.stdout.write(`  └─ ${lines}\n\n`);
      }
    }

    return { passed, output };
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (verbose) {
      process.stdout.write(`${label} ERROR: ${msg}\n`);
    }
    return { passed: false, output: msg };
  }
}

function main(): void {
  const args = parseArgs();
  const suitesToRun = args.all ? [...SUITES, ...OPTIONAL_SUITES] : SUITES;

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  process.stdout.write(`┌────────────────────────────────────────────────┐\n`);
  process.stdout.write(
    `│  TEST RUNNER  —  ${String(suitesToRun.length)} suite(s)                     │\n`,
  );
  process.stdout.write(`└────────────────────────────────────────────────┘\n\n`);

  for (const suite of suitesToRun) {
    // Skip optional suites if deps are missing (check if source file exists)
    if (!suite.required) {
      const testFile = suite.args[suite.args.length - 1];
      if (testFile && !testFile.includes('*') && !existsSync(testFile)) {
        if (args.verbose) {
          process.stdout.write(`[${suite.name}] SKIP (file not found)\n`);
        }
        skipped++;
        continue;
      }
    }

    const result = runSuite(suite, args.verbose);
    if (result.passed) {
      passed++;
    } else {
      failed++;
      // Print a summary line for the failure
      const lines = result.output.split('\n');
      const errLines = lines
        .filter((l) => l.includes('ERR_') || l.includes('Error:') || l.includes('✖'))
        .slice(0, 3);
      process.stdout.write(`  ⚠  ${suite.name}: ${errLines.join('; ') || 'failed'}\n`);
    }
  }

  const total = suitesToRun.length;
  process.stdout.write(`\n┌────────────────────────────────────────────────┐\n`);
  process.stdout.write(
    `│  RESULT: ${passed} passed, ${failed} failed${skipped > 0 ? `, ${skipped} skipped` : ''} | ${total} suites        │\n`,
  );
  process.stdout.write(`└────────────────────────────────────────────────┘\n`);

  if (args.all) {
    process.stdout.write(
      `\nℹ  Optional suites that failed may need: npm install uuid @aws-sdk/client-lambda @azure/identity\n`,
    );
  }

  process.exit(failed > 0 && !args.all ? 1 : 0);
}

main();
