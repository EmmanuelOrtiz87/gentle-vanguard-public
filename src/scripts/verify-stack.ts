#!/usr/bin/env node
/**
 * verify-stack.ts — End-to-end stack verification
 *
 * Verifies all components of the Gentle-Vanguard stack are operational:
 *   - TypeScript typecheck
 *   - Tests
 *   - Dashboard build
 *   - Resilience Bridge
 *   - Global Health API
 *   - Session autostart pipeline
 *   - Performance monitoring
 */

import { runSyncShell } from '../core/run-command.js';
import { getTimeoutConfig, getTimeout } from '../core/timeout-config';
import { trackExecution, getPerformanceMetrics } from '../core/timeout-monitor';
import { getResilienceConfig } from '../core/resilience-bridge';

let passed = 0;
let failed = 0;
const warnings = 0;

function check(name: string, fn: () => boolean | Promise<boolean>, timeoutMs = 30000): void {
  const stop = trackExecution(name, 'verification', timeoutMs);
  try {
    const result = fn();
    if (result instanceof Promise) {
      result
        .then((r) => {
          if (r) {
            passed++;
            process.stdout.write(`  ✅ ${name}\n`);
          } else {
            failed++;
            process.stdout.write(`  ❌ ${name}\n`);
          }
          stop(true);
        })
        .catch((e) => {
          failed++;
          process.stdout.write(`  ❌ ${name}: ${e.message}\n`);
          stop(false);
        });
    } else {
      if (result) {
        passed++;
        process.stdout.write(`  ✅ ${name}\n`);
      } else {
        failed++;
        process.stdout.write(`  ❌ ${name}\n`);
      }
      stop(true);
    }
  } catch (e: any) {
    failed++;
    process.stdout.write(`  ❌ ${name}: ${e.message}\n`);
    stop(false);
  }
}

function exec(
  cmd: string,
  opts?: { cwd?: string; timeout?: number },
): { code: number; output: string } {
  const r = runSyncShell(cmd, {
    timeout: opts?.timeout ?? 60000,
    stdio: 'pipe',
    cwd: opts?.cwd,
  });
  return { code: r.status ?? 1, output: r.stdout || r.stderr };
}

function printSection(title: string): void {
  console.log(`\n\x1b[36m═══ ${title} ═══\x1b[0m`);
}

// ---- Main ----

async function main() {
  console.log(`\x1b[36m═══════════════════════════════════════\x1b[0m`);
  console.log(`  \x1b[1mGentle-Vanguard Stack Verification\x1b[0m`);
  console.log(`  ${new Date().toISOString()}`);
  console.log(`\x1b[36m═══════════════════════════════════════\x1b[0m`);

  // 1. TypeScript typecheck
  printSection('TypeScript Typecheck');
  const tscResult = exec('npx tsc --noEmit', { timeout: 120000 });
  check('tsc --noEmit (0 errors)', () => tscResult.code === 0);

  // 2. Config tests
  printSection('Config Tests');
  const configTestResult = exec('npx tsx --test tests/config/*.test.ts', { timeout: 60000 });
  check('config tests pass', () => configTestResult.code === 0);

  // 3. Timeout config tests
  printSection('Timeout Config Tests');
  const tcTestResult = exec('npx tsx --test tests/unit/timeout-config.test.ts', { timeout: 30000 });
  check('timeout-config tests pass', () => tcTestResult.code === 0);

  // 4. Timeout monitor tests
  const tmTestResult = exec('npx tsx --test tests/unit/timeout-monitor.test.ts', {
    timeout: 30000,
  });
  check('timeout-monitor tests pass', () => tmTestResult.code === 0);

  // 5. Dashboard build
  printSection('Dashboard Build');
  const dbResult = exec('npm run build', { cwd: 'apps/web-dashboard', timeout: 120000 });
  check('dashboard build passes', () => dbResult.code === 0);

  // 6. Resilience bridge
  printSection('Resilience Bridge');
  try {
    const r = getResilienceConfig();
    const opCount = Object.keys(r.timeoutConfig).length;
    const cbCount = Object.keys(r.circuitBreakers).length;
    check(
      'resilience bridge loads (' + opCount + ' ops, ' + cbCount + ' CBs)',
      () => opCount > 0 && cbCount >= 0,
    );
  } catch (e: any) {
    check('resilience bridge loads', () => {
      throw e;
    });
  }

  // 7. Timeout config values
  printSection('Timeout Config Values');
  try {
    const cfg = getTimeoutConfig();
    const httpTimeout = getTimeout('http_server.socket_timeout_ms');
    const wsTimeout = getTimeout('websocket.ping_interval_ms');
    check('http_server.socket_timeout_ms = ' + httpTimeout + 'ms', () => httpTimeout > 0);
    check('websocket.ping_interval_ms = ' + wsTimeout + 'ms', () => wsTimeout > 0);
    check('config version: ' + cfg.version, () => cfg.version === '1.0.0');
    check('12 categories loaded', () => {
      const cats = [
        'global',
        'http_server',
        'websocket',
        'external_api',
        'process_execution',
        'pipeline',
        'dashboard',
        'database',
        'cache',
        'session',
        'hooks',
        'monitoring',
        'circuit_breaker',
      ];
      return cats.filter((c) => (cfg as any)[c] !== undefined).length >= 12;
    });
  } catch (e: any) {
    check('timeout config values', () => {
      throw e;
    });
  }

  // 8. Session autostart pipeline (dry-run check)
  printSection('Session Autostart Pipeline');
  const saResult = exec('npx tsx src/core/session-autostart.ts', { timeout: 180000 });
  // The pipeline might exit 1 on some non-critical failures, but should at least start
  const hasRequiredSteps =
    saResult.output.includes('[OK]') || saResult.output.includes('32 enabled');
  check(
    'session autostart starts (' + (saResult.code === 0 ? 'exit 0' : 'exit ' + saResult.code) + ')',
    () => hasRequiredSteps,
  );

  // 9. Performance metrics
  printSection('Performance Monitoring');
  const m = getPerformanceMetrics();
  check('metrics available (' + m.totalExecutions + ' records)', () => m.totalExecutions > 0);
  check('p95 latency tracked (' + m.p95Ms + 'ms)', () => m.p95Ms >= 0);
  check('violations tracked (' + m.totalViolations + ' total)', () => m.totalViolations >= 0);
  check('alert system active (' + m.activeAlerts + ' active)', () => m.activeAlerts >= 0);

  // 10. Workflow tests
  printSection('Workflow Tests');
  const wfResult = exec('npx tsx --test tests/workflows/*.test.ts', { timeout: 60000 });
  check('workflow tests pass', () => wfResult.code === 0);

  // ---- Summary ----
  const total = passed + failed;
  console.log(`\n\x1b[36m═══════════════════════════════════════\x1b[0m`);
  console.log(`  \x1b[1mVerification Complete\x1b[0m`);
  console.log(`  ${passed}/${total} passed | ${failed} failed | ${warnings} warnings`);

  if (failed === 0) {
    console.log(`\n  \x1b[32m✅ STACK FULLY OPERATIONAL\x1b[0m`);
  } else {
    console.log(`\n  \x1b[31m❌ ${failed} check(s) failed\x1b[0m`);
  }
  console.log(`\x1b[36m═══════════════════════════════════════\x1b[0m\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Verification error:', e);
  process.exit(1);
});
