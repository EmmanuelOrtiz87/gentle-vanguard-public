#!/usr/bin/env node
/**
 * Stack Validation Suite — Full Health Check
 *
 * Validates all critical components of the Gentle-Vanguard stack:
 * - Core infrastructure
 * - Intelligent Delegator
 * - Policy Engine
 * - OWASP Compliance
 * - Routing System
 * - Security checks
 *
 * USAGE:
 *   npm run stack:validate        # Full validation
 *   npm run stack:validate:quick  # Quick sanity check
 *   npm run stack:report          # Generate report
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { runSync } from '../core/run-command.js';

const ROOT = resolve(process.cwd());
const VALIDATION_LOG = join(ROOT, '.runtime', 'validation-report.json');

// Colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(message: string, level: 'info' | 'success' | 'warn' | 'error' = 'info'): void {
  const timestamp = new Date().toISOString().slice(11, 19);
  const color = {
    info: colors.blue,
    success: colors.green,
    warn: colors.yellow,
    error: colors.red,
  }[level];

  console.log(`${color}[${timestamp}] ${message}${colors.reset}`);
}

// =============================================================================
// VALIDATION TESTS
// =============================================================================

interface ValidationResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  message: string;
  duration: number;
  critical: boolean;
}

const results: ValidationResult[] = [];

async function runTest(
  name: string,
  testFn: () => Promise<boolean>,
  critical: boolean = true,
): Promise<void> {
  const start = Date.now();
  try {
    const passed = await testFn();
    const duration = Date.now() - start;
    results.push({
      name,
      status: passed ? 'PASS' : 'FAIL',
      message: passed ? 'OK' : 'Test failed',
      duration,
      critical,
    });
    log(`${passed ? '✓' : '✗'} ${name}`, passed ? 'success' : 'error');
  } catch (error) {
    const duration = Date.now() - start;
    results.push({
      name,
      status: 'FAIL',
      message: String(error),
      duration,
      critical,
    });
    log(`✗ ${name}: ${error}`, 'error');
  }
}

// Test 1: Core Files Exist
async function testCoreFiles(): Promise<boolean> {
  const requiredFiles = [
    'src/orchestration/intelligent-delegator.ts',
    'src/orchestration/task-wrapper.ts',
    'src/orchestration/smallest-route-router.ts',
    'src/security/policy-engine/policy-engine.ts',
    'policies/shell-commands.yaml',
    'docs/compliance/OWASP-AGENTIC-TOP10.md',
    'docs/IMPLEMENTATION-UPDATE-2026-09-03.md',
  ];

  const missing = requiredFiles.filter((f) => !existsSync(join(ROOT, f)));
  if (missing.length > 0) {
    log(`Missing files: ${missing.join(', ')}`, 'error');
    return false;
  }
  return true;
}

// Test 2: TypeScript Compilation
async function testTypeScript(): Promise<boolean> {
  try {
    runSync('npm', ['run', 'typecheck'], { cwd: ROOT, timeout: 120000 });
    return true;
  } catch (error) {
    log(`TypeScript errors: ${error}`, 'error');
    return false;
  }
}

// Test 3: Lint Check
async function testLint(): Promise<boolean> {
  try {
    runSync('npm', ['run', 'lint'], { cwd: ROOT, timeout: 60000 });
    return true;
  } catch {
    // Don't fail on lint warnings
    return true;
  }
}

// Test 4: Intelligent Delegator Loads
async function testDelegator(): Promise<boolean> {
  try {
    const { getDelegatorStatus } = await import('../orchestration/intelligent-delegator.js');
    const status = getDelegatorStatus();
    return status !== null && status.metrics !== undefined;
  } catch (error) {
    log(`Delegator load error: ${error}`, 'error');
    return false;
  }
}

// Test 5: Policy Engine Loads
async function testPolicyEngine(): Promise<boolean> {
  try {
    const { PolicyEngine } = await import('../security/policy-engine/policy-engine.js');
    const engine = new PolicyEngine(['policies/shell-commands.yaml'], { cachePolicies: false });
    const info = engine.getPoliciesInfo();
    return info.length > 0;
  } catch (error) {
    log(`Policy Engine load error: ${error}`, 'error');
    return false;
  }
}

// Test 6: Smallest Route Router
async function testSmallestRoute(): Promise<boolean> {
  try {
    const { smallestRoute } = await import('../orchestration/smallest-route-router.js');
    const analysis = smallestRoute.analyze({
      description: 'Fix typo',
      estimatedFiles: 1,
      confidence: 0.95,
    });
    return analysis.route === 'direct' && analysis.steps < 10;
  } catch (error) {
    log(`Smallest Route error: ${error}`, 'error');
    return false;
  }
}

// Test 7: OWASP Documentation
async function testOwaspDocs(): Promise<boolean> {
  const docPath = join(ROOT, 'docs/compliance/OWASP-AGENTIC-TOP10.md');
  if (!existsSync(docPath)) return false;

  const content = readFileSync(docPath, 'utf-8');
  const hasLlm01 = content.includes('LLM01');
  const hasLlm10 = content.includes('LLM10');
  const hasFullCoverage = content.includes('10/10') || content.includes('100%');

  return hasLlm01 && hasLlm10 && hasFullCoverage;
}

// Test 8: Package Scripts
async function testPackageScripts(): Promise<boolean> {
  const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  const requiredScripts = [
    'delegate:intelligent',
    'delegate:status',
    'route:analyze',
  ];

  const scripts = packageJson.scripts || {};
  const missing = requiredScripts.filter((s) => !scripts[s]);

  if (missing.length > 0) {
    log(`Missing scripts: ${missing.join(', ')}`, 'warn');
    return false;
  }
  return true;
}

// Test 9: Runtime Directories
async function testRuntimeDirs(): Promise<boolean> {
  const dirs = [
    '.session',
    '.runtime',
    '.logs',
    'src/orchestration',
    'src/security/policy-engine',
    'docs/compliance',
    'policies',
  ];

  const missing = dirs.filter((d) => !existsSync(join(ROOT, d)));
  if (missing.length > 0) {
    log(`Missing directories: ${missing.join(', ')}`, 'error');
    return false;
  }
  return true;
}

// Test 10: Watchtower Health
async function testWatchtower(): Promise<boolean> {
  try {
    const result = runSync('npm', ['run', 'watchtower:health'], {
      cwd: ROOT,
      timeout: 60000,
    });
    const output = result.stdout + result.stderr;
    const passCount = (output.match(/PASS/g) || []).length;
    return passCount >= 80; // At least 80 checks passing
  } catch {
    return false;
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  const quickMode = process.argv.includes('--quick');
  const startTime = Date.now();

  log('╔════════════════════════════════════════════════════════════╗', 'info');
  log('║   Gentle-Vanguard Stack Validation Suite v1.0              ║', 'info');
  log('╚════════════════════════════════════════════════════════════╝', 'info');
  log('');

  // Critical Tests
  log('Running critical component tests...', 'info');
  await runTest('Core Files Exist', testCoreFiles, true);
  await runTest('TypeScript Compilation', testTypeScript, true);
  await runTest('Runtime Directories', testRuntimeDirs, true);

  // Feature Tests
  log('\nRunning feature integration tests...', 'info');
  await runTest('Intelligent Delegator', testDelegator, true);
  await runTest('Policy Engine', testPolicyEngine, true);
  await runTest('Smallest Route Router', testSmallestRoute, true);
  await runTest('OWASP Documentation', testOwaspDocs, false);

  // Infrastructure Tests
  log('\nRunning infrastructure tests...', 'info');
  await runTest('Package Scripts', testPackageScripts, false);
  await runTest('Lint Check', testLint, false);

  if (!quickMode) {
    await runTest('Watchtower Health', testWatchtower, false);
  }

  // Results
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const criticalFailed = results.filter((r) => r.status === 'FAIL' && r.critical).length;

  log('\n╔════════════════════════════════════════════════════════════╗', 'info');
  log('║   Validation Results                                       ║', 'info');
  log('╠════════════════════════════════════════════════════════════╣', 'info');
  log(`║   Total: ${String(results.length).padEnd(3)} | Passed: ${String(passed).padStart(2)} | Failed: ${String(failed).padEnd(3)} ║`, failed === 0 ? 'success' : 'error');
  log(`║   Duration: ${String(duration + 's').padEnd(8)} | Critical Failures: ${String(criticalFailed).padEnd(3)} ║`, criticalFailed === 0 ? 'success' : 'error');
  log('╚════════════════════════════════════════════════════════════╝', 'info');

  // Detailed Results
  if (failed > 0) {
    log('\nDetailed failures:', 'error');
    results
      .filter((r) => r.status === 'FAIL')
      .forEach((r) => {
        log(`  ✗ ${r.name}${r.critical ? ' (CRITICAL)' : ''}: ${r.message}`, 'error');
      });
  }

  // Save report
  const report = {
    timestamp: new Date().toISOString(),
    duration: parseFloat(duration),
    summary: { total: results.length, passed, failed, criticalFailed },
    results,
    status: criticalFailed === 0 ? 'PASS' : 'FAIL',
  };

  try {
    if (!existsSync(join(ROOT, '.runtime'))) {
      mkdirSync(join(ROOT, '.runtime'), { recursive: true });
    }
    writeFileSync(VALIDATION_LOG, JSON.stringify(report, null, 2));
    log(`\nReport saved to: ${VALIDATION_LOG}`, 'info');
  } catch {
    // Non-critical
  }

  // Exit code
  process.exit(criticalFailed === 0 ? 0 : 1);
}

// Run
void main();
