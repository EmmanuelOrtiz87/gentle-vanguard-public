#!/usr/bin/env node
/**
 * profile-timeouts.ts — Performance Profiling Script
 *
 * Benchmarks key stack operations against centralized timeout configuration,
 * measures real execution times, and reports violations.
 *
 * Usage:
 *   npx tsx src/scripts/profile-timeouts.ts
 *   npx tsx src/scripts/profile-timeouts.ts --verbose
 *   npx tsx src/scripts/profile-timeouts.ts --daemon
 */

import {
  trackExecution,
  getPerformanceMetrics,
  getActiveAlerts,
  startMonitorDaemon,
} from '../core/timeout-monitor';
import { getTimeout, getActiveEnvironment } from '../core/timeout-config';
import { runSync } from '../core/run-command.js';
import * as fs from 'fs';
import * as pathModule from 'path';

const args = process.argv.slice(2);
const DAEMON = args.includes('--daemon') || args.includes('-d');

// ---------------------------------------------------------------------------
// Benchmark helpers
// ---------------------------------------------------------------------------

async function benchmarkOperation(
  name: string,
  category: string,
  timeoutMs: number,
  fn: () => Promise<void> | void,
): Promise<{ operation: string; durationMs: number; violated: boolean; timeoutMs: number }> {
  const stop = trackExecution(name, category, timeoutMs);
  try {
    await fn();
    const record = stop(true);
    return {
      operation: name,
      durationMs: record.durationMs,
      violated: record.violated,
      timeoutMs: record.timeoutMs,
    };
  } catch {
    const record = stop(false);
    return {
      operation: name,
      durationMs: record.durationMs,
      violated: true,
      timeoutMs: record.timeoutMs,
    };
  }
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

async function benchmarkConfigLoad(): Promise<void> {
  console.log(`\n\x1b[36m  ── Config Load ──\x1b[0m`);
  const result = await benchmarkOperation('config-load', 'process_execution', 5000, async () => {
    const config = await import('../core/timeout-config');
    config.getTimeoutConfig();
  });
  console.log(
    `    Config Load:          ${result.durationMs}ms ${result.violated ? '\x1b[31m⚠ VIOLATION\x1b[0m' : '\x1b[32m✓\x1b[0m'}`,
  );
}

async function benchmarkFilesystemOps(): Promise<void> {
  console.log(`\n\x1b[36m  ── Filesystem Ops ──\x1b[0m`);

  const r1 = await benchmarkOperation('read-config', 'process_execution', 5000, () => {
    fs.readFileSync(pathModule.resolve(process.cwd(), 'config', 'timeout-config.json'), 'utf-8');
  });
  console.log(
    `    Read config file:     ${r1.durationMs}ms ${r1.violated ? '\x1b[31m⚠\x1b[0m' : '\x1b[32m✓\x1b[0m'}`,
  );

  const r2 = await benchmarkOperation('list-dir', 'process_execution', 5000, () => {
    fs.readdirSync(pathModule.resolve(process.cwd(), 'src'));
  });
  console.log(
    `    List src/ directory:  ${r2.durationMs}ms ${r2.violated ? '\x1b[31m⚠\x1b[0m' : '\x1b[32m✓\x1b[0m'}`,
  );
}

async function benchmarkTypecheck(): Promise<void> {
  console.log(`\n\x1b[36m  ── TypeScript Typecheck ──\x1b[0m`);
  const tscTimeout = getTimeout('process_execution.tsc_typecheck_ms', 120000);
  const r = await benchmarkOperation('tsc-typecheck', 'process_execution', tscTimeout, () => {
    runSync('npx', ['tsc', '--noEmit'], { timeout: tscTimeout, stdio: 'pipe' });
  });
  console.log(
    `    tsc --noEmit:         ${r.durationMs}ms ${r.violated ? '\x1b[31m⚠ VIOLATION\x1b[0m' : '\x1b[32m✓\x1b[0m'} (threshold: ${r.timeoutMs}ms)`,
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function printSummary(): void {
  const m = getPerformanceMetrics();
  console.log(`\n\x1b[36m═══════════════════════════════════════\x1b[0m`);
  console.log(`  \x1b[1mPerformance Profiling Summary\x1b[0m`);
  console.log(`  Environment: \x1b[33m${getActiveEnvironment()}\x1b[0m`);
  console.log(`\x1b[36m═══════════════════════════════════════\x1b[0m`);
  console.log(`  Total Executions : \x1b[32m${m.totalExecutions}\x1b[0m`);
  console.log(
    `  Total Violations : ${m.totalViolations > 0 ? '\x1b[31m' : '\x1b[32m'}${m.totalViolations}\x1b[0m`,
  );
  console.log(`  Violation Rate   : ${(m.violationRate * 100).toFixed(1)}%`);
  console.log(
    `  Active Alerts    : ${m.activeAlerts > 0 ? '\x1b[33m' : '\x1b[32m'}${m.activeAlerts}\x1b[0m`,
  );

  const p95Color = m.p95Ms > 50000 ? '\x1b[31m' : m.p95Ms > 10000 ? '\x1b[33m' : '\x1b[32m';
  const avgColor = m.avgMs > 30000 ? '\x1b[31m' : m.avgMs > 5000 ? '\x1b[33m' : '\x1b[32m';
  console.log(`  p95 Latency      : ${p95Color}${m.p95Ms}ms\x1b[0m`);
  console.log(`  p99 Latency      : ${m.p99Ms}ms`);
  console.log(`  Avg Latency      : ${avgColor}${m.avgMs}ms\x1b[0m`);

  if (m.topSlowest.length > 0) {
    console.log(`\n  \x1b[1mSlowest Operations\x1b[0m`);
    for (const r of m.topSlowest.slice(0, 5)) {
      const icon = r.violated ? '\x1b[31m⚠\x1b[0m' : '\x1b[32m✓\x1b[0m';
      console.log(
        `  ${icon} ${r.operation.padEnd(30)} ${r.durationMs}ms (threshold: ${r.timeoutMs}ms)`,
      );
    }
  }

  const alerts = getActiveAlerts();
  if (alerts.length > 0) {
    console.log(`\n  \x1b[1mActive Alerts:\x1b[0m`);
    for (const a of alerts) {
      console.log(`  \x1b[33m[${a.severity.toUpperCase()}]\x1b[0m ${a.message}`);
    }
  }

  console.log(`\n  \x1b[90mRun with --daemon for continuous monitoring\x1b[0m`);
  console.log();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\x1b[36m═══════════════════════════════════════\x1b[0m`);
  console.log(`  \x1b[1mGentle-Vanguard Performance Profile\x1b[0m`);
  console.log(`  ${new Date().toISOString()}`);
  console.log(`\x1b[36m═══════════════════════════════════════\x1b[0m`);

  if (DAEMON) {
    startMonitorDaemon(5000);
    console.log('\n  Monitoring daemon running. Press Ctrl+C to stop.\n');
    await new Promise(() => {});
    return;
  }

  await benchmarkConfigLoad();
  await benchmarkFilesystemOps();
  await benchmarkTypecheck();

  printSummary();
}

main().catch((err) => {
  console.error('\x1b[31mProfile error:\x1b[0m', err);
  process.exit(1);
});
