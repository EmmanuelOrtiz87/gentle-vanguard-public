#!/usr/bin/env node
/**
 * Fetch Diagnostics Tool
 *
 * Diagnoses and tests fetch() functionality in the Node.js environment.
 * Helps identify UV_HANDLE_CLOSING and other fetch-related issues.
 *
 * Usage:
 *   npx tsx src/tools/fetch-diagnostics.ts [--test-url <url>] [--verbose]
 */

import { pathToFileURL } from 'url';
import { getExternalApiTimeouts } from '../core/timeout-config';

interface DiagnosticResult {
  test: string;
  status: 'pass' | 'fail' | 'skip';
  message: string;
  duration?: number;
  error?: string;
}

interface DiagnosticsReport {
  timestamp: string;
  nodeVersion: string;
  platform: string;
  results: DiagnosticResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  recommendations: string[];
}

// ─── Logger ───────────────────────────────────────────────────────────────────

function log(message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info'): void {
  const colors: Record<string, string> = {
    info: '\x1b[36m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    success: '\x1b[32m',
  };
  const reset = '\x1b[0m';
  console.log(`${colors[level]}[FETCH-DIAG]${reset} ${message}`);
}

// ─── Diagnostics Tests ────────────────────────────────────────────────────────

async function testBasicFetch(): Promise<DiagnosticResult> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      getExternalApiTimeouts()?.http_client_default_ms ?? 5000,
    );

    const response = await fetch('https://httpbin.org/get', {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    return {
      test: 'Basic HTTP GET',
      status: response.ok ? 'pass' : 'fail',
      message: `Status: ${response.status}`,
      duration: Date.now() - start,
    };
  } catch (err: unknown) {
    return {
      test: 'Basic HTTP GET',
      status: 'fail',
      message: 'Failed to fetch',
      duration: Date.now() - start,
      error: (err as Error)?.message || String(err),
    };
  }
}

async function testFetchWithRetry(): Promise<DiagnosticResult> {
  const start = Date.now();
  const maxRetries = 3;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        getExternalApiTimeouts()?.http_client_default_ms ?? 5000,
      );

      const response = await fetch('https://httpbin.org/get', {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        return {
          test: 'Fetch with Retry Logic',
          status: 'pass',
          message: `Success on attempt ${i + 1}/${maxRetries}`,
          duration: Date.now() - start,
        };
      }
    } catch (err: unknown) {
      const errorMsg = (err as Error)?.message || String(err);

      if (errorMsg.includes('UV_HANDLE_CLOSING')) {
        log(`UV_HANDLE_CLOSING detected on attempt ${i + 1}, retrying...`, 'warn');
        if (i < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
      }

      if (i === maxRetries - 1) {
        return {
          test: 'Fetch with Retry Logic',
          status: 'fail',
          message: `Failed after ${maxRetries} attempts`,
          duration: Date.now() - start,
          error: errorMsg,
        };
      }
    }
  }

  return {
    test: 'Fetch with Retry Logic',
    status: 'fail',
    message: 'All retry attempts exhausted',
    duration: Date.now() - start,
  };
}

async function testGitHubAPI(): Promise<DiagnosticResult> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      getExternalApiTimeouts()?.github_api_ms ?? 10000,
    );

    const response = await fetch(
      'https://api.github.com/repos/Gentleman-Programming/gentle-ai/releases/latest',
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Gentle-Vanguard-Diagnostics/1.0',
        },
        signal: controller.signal,
      },
    );

    clearTimeout(timeout);

    return {
      test: 'GitHub API Access',
      status: response.ok || response.status === 403 ? 'pass' : 'fail',
      message: `Status: ${response.status} (${response.status === 403 ? 'Rate limited (expected)' : 'OK'})`,
      duration: Date.now() - start,
    };
  } catch (err: unknown) {
    return {
      test: 'GitHub API Access',
      status: 'fail',
      message: 'Failed to reach GitHub API',
      duration: Date.now() - start,
      error: (err as Error)?.message || String(err),
    };
  }
}

async function testConcurrentFetch(): Promise<DiagnosticResult> {
  const start = Date.now();
  const urls = [
    'https://httpbin.org/get',
    'https://httpbin.org/ip',
    'https://httpbin.org/user-agent',
  ];

  try {
    const results = await Promise.allSettled(
      urls.map(async (url) => {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          getExternalApiTimeouts()?.http_client_default_ms ?? 5000,
        );
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        return response.ok;
      }),
    );

    const successCount = results.filter((r) => r.status === 'fulfilled' && r.value).length;

    return {
      test: 'Concurrent Fetch Requests',
      status: successCount === urls.length ? 'pass' : successCount > 0 ? 'pass' : 'fail',
      message: `${successCount}/${urls.length} requests succeeded`,
      duration: Date.now() - start,
    };
  } catch (err: unknown) {
    return {
      test: 'Concurrent Fetch Requests',
      status: 'fail',
      message: 'Concurrent fetch failed',
      duration: Date.now() - start,
      error: (err as Error)?.message || String(err),
    };
  }
}

function checkNodeVersion(): DiagnosticResult {
  const version = process.version;
  const majorVersion = parseInt(version.slice(1).split('.')[0], 10);

  return {
    test: 'Node.js Version Check',
    status: majorVersion >= 18 ? 'pass' : 'fail',
    message: `Node.js ${version} (fetch ${majorVersion >= 18 ? 'native' : 'requires polyfill'})`,
  };
}

function checkFetchAvailability(): DiagnosticResult {
  return {
    test: 'Fetch API Availability',
    status: typeof fetch === 'function' ? 'pass' : 'fail',
    message: typeof fetch === 'function' ? 'fetch() is available' : 'fetch() not found',
  };
}

// ─── Main Logic ───────────────────────────────────────────────────────────────

async function runDiagnostics(_verbose = false): Promise<DiagnosticsReport> {
  log('Starting fetch diagnostics...', 'info');

  const results: DiagnosticResult[] = [];

  // Run synchronous checks
  results.push(checkNodeVersion());
  results.push(checkFetchAvailability());

  // Run async tests
  log('Testing basic fetch...', 'info');
  results.push(await testBasicFetch());

  log('Testing fetch with retry logic...', 'info');
  results.push(await testFetchWithRetry());

  log('Testing GitHub API access...', 'info');
  results.push(await testGitHubAPI());

  log('Testing concurrent fetch...', 'info');
  results.push(await testConcurrentFetch());

  // Generate recommendations
  const recommendations: string[] = [];
  const failedTests = results.filter((r) => r.status === 'fail');

  if (failedTests.some((t) => t.error?.includes('UV_HANDLE_CLOSING'))) {
    recommendations.push(
      'UV_HANDLE_CLOSING detected: Use fetchWithRetry() wrapper with AbortController timeout',
    );
    recommendations.push('Consider increasing delay between retries to 2-3 seconds');
    recommendations.push('Limit concurrent fetch requests to avoid handle exhaustion');
  }

  if (failedTests.some((t) => t.test === 'GitHub API Access')) {
    recommendations.push(
      'GitHub API may be rate-limited: Consider using a GitHub token for authenticated requests',
    );
  }

  if (failedTests.length === 0) {
    recommendations.push('All tests passed: Fetch is working correctly');
  }

  const report: DiagnosticsReport = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    results,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.status === 'pass').length,
      failed: results.filter((r) => r.status === 'fail').length,
      skipped: results.filter((r) => r.status === 'skip').length,
    },
    recommendations,
  };

  return report;
}

// ─── CLI Entry ─────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');

  await (async () => {
    try {
      const report = await runDiagnostics(verbose);

      console.log('\n' + '='.repeat(60));
      console.log('FETCH DIAGNOSTICS REPORT');
      console.log('='.repeat(60));
      console.log(`Timestamp: ${report.timestamp}`);
      console.log(`Node.js: ${report.nodeVersion}`);
      console.log(`Platform: ${report.platform}`);
      console.log('\n--- Test Results ---');

      for (const result of report.results) {
        const icon = result.status === 'pass' ? '✅' : result.status === 'fail' ? '❌' : '⏭️';
        console.log(`${icon} ${result.test}: ${result.message}`);
        if (verbose && result.duration) {
          console.log(`   Duration: ${result.duration}ms`);
        }
        if (verbose && result.error) {
          console.log(`   Error: ${result.error}`);
        }
      }

      console.log('\n--- Summary ---');
      console.log(`Total: ${report.summary.total}`);
      console.log(`Passed: ${report.summary.passed}`);
      console.log(`Failed: ${report.summary.failed}`);
      console.log(`Skipped: ${report.summary.skipped}`);

      console.log('\n--- Recommendations ---');
      for (const rec of report.recommendations) {
        console.log(`• ${rec}`);
      }

      console.log('\n' + '='.repeat(60));

      // Exit with appropriate code
      process.exit(report.summary.failed > 0 ? 1 : 0);
    } catch (err) {
      log(`Fatal error: ${err instanceof Error ? err.message : String(err)}`, 'error');
      process.exit(2);
    }
  })();
}

export { runDiagnostics };
export type { DiagnosticsReport, DiagnosticResult };
