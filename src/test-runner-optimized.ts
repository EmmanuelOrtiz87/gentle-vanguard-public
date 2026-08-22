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
 *   npx tsx src/test-runner-optimized.ts [--all] [--quick] [--verbose] [--parallel 4]
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import * as os from 'os';

interface Suite {
  name: string;
  cmd: string;
  args: string[];
  required: boolean;
  timeout?: number;
  quick?: boolean; // Run in quick mode
}

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
    name: 'Unit Tests (all)',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/unit/*.test.ts'],
    required: true,
    timeout: 90_000,
  },
  {
    name: 'Security Tests',
    cmd: 'npx',
    args: ['tsx', '--test', 'tests/security/*.test.ts'],
    required: true,
    timeout: 90_000,
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

function parseArgs(): RunOptions {
  const args = process.argv.slice(2);
  const parallelArg = args.find((_, i) => args[i - 1] === '--parallel');
  return {
    all: args.includes('--all') || args.includes('-a'),
    quick: args.includes('--quick') || args.includes('-q'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    parallel: Math.min(parseInt(parallelArg || '4', 10), os.cpus().length),
  };
}

function runSuite(
  suite: Suite,
  verbose: boolean,
): Promise<{ name: string; passed: boolean; output: string; duration: number }> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const label = `[${suite.name}]`;

    const child = spawn(suite.cmd, suite.args, {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let output = '';
    child.stdout?.on('data', (data) => {
      output += data.toString();
    });
    child.stderr?.on('data', (data) => {
      output += data.toString();
    });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        name: suite.name,
        passed: false,
        output: 'TIMEOUT: Test exceeded time limit',
        duration: Date.now() - startTime,
      });
    }, suite.timeout ?? 60_000);

    child.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;
      const passed = code === 0;

      if (verbose) {
        process.stdout.write(`${label} ${passed ? '✓ PASS' : '✗ FAIL'} (${duration}ms)\n`);
      }

      resolve({ name: suite.name, passed, output, duration });
    });
  });
}

async function runParallel(
  suites: Suite[],
  options: RunOptions,
  progressPrefix: string,
): Promise<{ passed: number; failed: number; results: any[] }> {
  const results: any[] = [];
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

  while (queue.length > 0 || running.length > 0) {
    // Start new tasks up to parallel limit
    while (running.length < options.parallel && queue.length > 0) {
      const suite = queue.shift()!;
      const promise = runSuite(suite, options.verbose).then((result) => {
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
  const { passed, failed, results } = await runParallel(suitesToRun, options, 'Running:');
  const totalDuration = Date.now() - startTime;

  // Summary
  process.stdout.write(`\n┌────────────────────────────────────────────────┐\n`);
  process.stdout.write(
    `│  RESULT: ${passed} passed, ${failed} failed | ${(totalDuration / 1000).toFixed(1)}s           │\n`,
  );
  process.stdout.write(`└────────────────────────────────────────────────┘\n`);

  // Show slow tests
  const slowThreshold = 30_000; // 30 seconds
  const slowTests = results.filter((r: any) => r.duration > slowThreshold);
  if (slowTests.length > 0) {
    process.stdout.write(`\n⚠ Slow tests (>30s):\n`);
    slowTests.forEach((r: any) => {
      process.stdout.write(`  - ${r.name}: ${(r.duration / 1000).toFixed(1)}s\n`);
    });
  }

  // Show failed suite output (observability: CI must reveal WHICH test failed)
  const failedResults = results.filter((r: any) => !r.passed);
  if (failedResults.length > 0) {
    process.stdout.write(`\n🔴 FAILED SUITES — full output:\n`);
    failedResults.forEach((r: any) => {
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
