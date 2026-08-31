#!/usr/bin/env node

/**
 * Test Runner Optimized v2 — parallel execution with reduced timeouts
 *
 * Improvements:
 *   - Parallel test execution (max 4 concurrent)
 *   - Reduced default timeout from 120s to 60s
 *   - Quick mode: only critical tests (--quick flag)
 *   - Better progress reporting
 *
 * Usage:
 *   npx tsx src/review/test-runner-optimized.ts [--all] [--quick] [--verbose] [--parallel 4]
 */

import { run } from '../core/run-command';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import * as os from 'os';
import { join } from 'path';

interface Suite {
  name: string;
  cmd: string;
  args: string[];
  required: boolean;
  timeout?: number;
  quick?: boolean; // Run in quick mode
  exclusiveGroup?: string;
}

const UNIT_TEST_FILES = readdirSync('tests/unit')
  .filter((file) => file.endsWith('.test.ts') && file !== 'secret-scanner.test.ts')
  .sort()
  .map((file) => `tests/unit/${file}`);

// Core suites - always run
const CORE_SUITES: Suite[] = [
  {
    name: 'Config Tests',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/config/*.test.ts'],
    required: true,
    timeout: 60_000,
    quick: true,
  },
  {
    name: 'Workflow Tests',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/workflows/*.test.ts'],
    required: true,
    timeout: 60_000,
    quick: true,
  },
];

// Extended suites - run in normal mode
const EXTENDED_SUITES: Suite[] = [
  {
    name: 'Secret Scanner Tests',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/unit/secret-scanner.test.ts'],
    required: true,
    timeout: 90_000,
  },
  {
    name: 'Unit Tests (isolated from secret scanner)',
    cmd: 'npx',
    args: ['tsx', '--test', ...UNIT_TEST_FILES],
    required: true,
    timeout: 90_000,
    exclusiveGroup: 'process-heavy',
  },
  {
    name: 'Security Tests',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/security/*.test.ts'],
    required: true,
    timeout: 90_000,
    exclusiveGroup: 'process-heavy',
  },
  {
    name: 'Integration Tests',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/integration/*.test.ts'],
    required: true,
    timeout: 120_000,
  },
];

// Optional suites
const OPTIONAL_SUITES: Suite[] = [
  {
    name: 'Eval Tests (vitest)',
    cmd: 'npx',
    args: ['vitest', 'run', '--config', 'vitest.eval.config.ts'],
    required: false,
    timeout: 180_000,
  },
  {
    name: 'Skills Tests',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/skills/*.test.ts'],
    required: false,
    timeout: 120_000,
  },
  {
    name: 'E2E Release Workflow Tests',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/e2e/release-workflow.test.ts'],
    required: false,
    timeout: 120_000,
  },
];

interface RunOptions {
  all: boolean;
  quick: boolean;
  verbose: boolean;
  parallel: number;
}

interface SuiteResult {
  name: string;
  passed: boolean;
  output: string;
  duration: number;
}

function parseArgs(): RunOptions {
  const args = process.argv.slice(2);
  const parallelArg = args.find((_, i) => args[i - 1] === '--parallel');
  return {
    all: args.includes('--all') || args.includes('-a'),
    quick: args.includes('--quick') || args.includes('-q'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    parallel: Math.max(1, Math.min(parseInt(parallelArg || '4', 10) || 1, os.cpus().length)),
  };
}

function runSuite(
  suite: Suite,
  verbose: boolean,
  env: NodeJS.ProcessEnv,
): Promise<{ name: string; passed: boolean; output: string; duration: number }> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const label = `[${suite.name}]`;
    const runtimeDir = mkdtempSync(join(os.tmpdir(), 'gentle-vanguard-test-'));

    const child = run(suite.cmd, suite.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...env, GENTLE_VANGUARD_DB_DIR: runtimeDir },
    });

    let output = '';
    child.stdout?.on('data', (data) => {
      output += data.toString();
    });
    child.stderr?.on('data', (data) => {
      output += data.toString();
    });
    child.on('error', (error) => {
      output += `\nRunner error: ${error.message}\n`;
    });

    const cleanup = (): void => {
      rmSync(runtimeDir, { recursive: true, force: true });
    };

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      cleanup();
      resolve({
        name: suite.name,
        passed: false,
        output: `TIMEOUT: Test exceeded time limit\nRuntime directory: ${runtimeDir}`,
        duration: Date.now() - startTime,
      });
    }, suite.timeout ?? 60_000);

    child.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;
      const passed = code === 0;
      cleanup();

      if (verbose) {
        process.stdout.write(`${label} ${passed ? '✓ PASS' : '✗ FAIL'} (${duration}ms)\n`);
      }

      const diagnostic = passed
        ? ''
        : `\nExit code: ${code ?? 'null'}\nSignal: ${child.signalCode ?? 'none'}\nRuntime directory: ${runtimeDir}`;
      resolve({ name: suite.name, passed, output: output + diagnostic, duration });
    });
  });
}

async function runParallel(
  suites: Suite[],
  options: RunOptions,
  progressPrefix: string,
  env: NodeJS.ProcessEnv,
): Promise<{ passed: number; failed: number; results: SuiteResult[] }> {
  const results: SuiteResult[] = [];
  let passed = 0;
  let failed = 0;
  let completed = 0;

  const queue = [...suites];
  // Trackable promises with completion status
  interface TrackablePromise extends Promise<void> {
    isCompleted: boolean;
  }

  function makeTrackable(promise: Promise<void>): TrackablePromise {
    const trackable = promise.finally(() => {
      (trackable as TrackablePromise).isCompleted = true;
    }) as TrackablePromise;
    trackable.isCompleted = false;
    return trackable;
  }

  const running: TrackablePromise[] = [];
  const activeGroups = new Set<string>();

  function canStart(suite: Suite): boolean {
    return !suite.exclusiveGroup || !activeGroups.has(suite.exclusiveGroup);
  }

  function startableSuiteIndex(): number {
    return queue.findIndex(canStart);
  }

  while (queue.length > 0 || running.length > 0) {
    // Start new tasks up to parallel limit
    while (running.length < options.parallel && queue.length > 0) {
      const index = startableSuiteIndex();
      if (index === -1) break;
      const suite = queue.splice(index, 1)[0];
      if (suite.exclusiveGroup) activeGroups.add(suite.exclusiveGroup);
      const promise = runSuite(suite, options.verbose, env).then((result) => {
        results.push(result);
        completed++;

        if (result.passed) {
          passed++;
        } else {
          failed++;
          if (options.verbose) {
            const lines = result.output.split('\n').slice(-5).join('\n');
            process.stdout.write(`  ⚠ ${result.name}: ${lines}\n`);
          }
        }

        if (!options.verbose) {
          process.stdout.write(
            `\r${progressPrefix} ${completed}/${suites.length} (${passed}✓ ${failed}✗)`,
          );
        }
        if (suite.exclusiveGroup) activeGroups.delete(suite.exclusiveGroup);
      });
      running.push(makeTrackable(promise));
    }

    // Wait for at least one to complete
    if (running.length > 0) {
      await Promise.race(running);
      // Allow event loop to process completed promises
      await new Promise((resolve) => setImmediate(resolve));
      // Remove completed promises
      for (let i = running.length - 1; i >= 0; i--) {
        if (running[i].isCompleted) {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          running.splice(i, 1);
        }
      }
    }
  }

  if (!options.verbose) {
    process.stdout.write('\n');
  }

  return { passed, failed, results };
}

async function main(): Promise<void> {
  const options = parseArgs();

  // Select suites based on mode
  let suitesToRun: Suite[] = [];
  if (options.quick) {
    suitesToRun = CORE_SUITES.filter((s) => s.quick);
    process.stdout.write('⚡ QUICK MODE: Running only critical tests\n\n');
  } else {
    suitesToRun = [...CORE_SUITES, ...EXTENDED_SUITES];
    if (options.all) {
      suitesToRun = [...suitesToRun, ...OPTIONAL_SUITES];
    }
  }

  // Filter out non-existent optional suites
  suitesToRun = suitesToRun.filter((suite) => {
    if (suite.required) return true;
    const testFile = suite.args[suite.args.length - 1];
    if (testFile && !testFile.includes('*')) {
      return existsSync(testFile);
    }
    return true;
  });

  process.stdout.write(`┌────────────────────────────────────────────────┐\n`);
  process.stdout.write(`│  TEST RUNNER OPTIMIZED v2                        │\n`);
  process.stdout.write(
    `│  ${String(suitesToRun.length).padStart(3)} suites | ${options.parallel} parallel | ${options.quick ? 'QUICK' : 'FULL'} mode        │\n`,
  );
  process.stdout.write(`└────────────────────────────────────────────────┘\n\n`);

  const startTime = Date.now();
  const { passed, failed, results } = await runParallel(
    suitesToRun,
    options,
    'Running:',
    process.env,
  );
  const totalDuration = Date.now() - startTime;

  // Summary
  process.stdout.write(`\n┌────────────────────────────────────────────────┐\n`);
  process.stdout.write(
    `│  RESULT: ${passed} passed, ${failed} failed | ${(totalDuration / 1000).toFixed(1)}s           │\n`,
  );
  process.stdout.write(`└────────────────────────────────────────────────┘\n`);

  // Show slow tests
  const slowThreshold = 30_000; // 30 seconds
  const slowTests = results.filter((r) => r.duration > slowThreshold);
  if (slowTests.length > 0) {
    process.stdout.write(`\n⚠ Slow tests (>30s):\n`);
    slowTests.forEach((r) => {
      process.stdout.write(`  - ${r.name}: ${(r.duration / 1000).toFixed(1)}s\n`);
    });
  }

  // Show failed suite output (observability: CI must reveal WHICH test failed)
  const failedResults = results.filter((r) => !r.passed);
  if (failedResults.length > 0) {
    process.stdout.write(`\n🔴 FAILED SUITES — full output:\n`);
    failedResults.forEach((r) => {
      process.stdout.write(
        `\n========== ${r.name} (${(r.duration / 1000).toFixed(1)}s) ==========\n`,
      );
      process.stdout.write(`${r.output || '(no output captured)'}\n`);
      process.stdout.write(`========== end ${r.name} ==========\n`);
    });
  }

  // Recommendations
  if (options.all && failed > 0) {
    process.stdout.write(`\n💡 Try running without --all for faster execution\n`);
  }
  if (!options.quick && failed === 0) {
    process.stdout.write(`\n💡 For CI/CD, try --quick flag for 2x faster runs\n`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
