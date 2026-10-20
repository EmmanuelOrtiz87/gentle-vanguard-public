#!/usr/bin/env node
/**
 * Stack Bootstrap — Automatic Gentle-Vanguard Initialization
 *
 * Executes automatically when user connects:
 * 1. Start session
 * 2. Initialize Intelligent Delegator
 * 3. Validate Policy Engine
 * 4. Check OWASP compliance
 * 5. Verify routing system
 * 6. Start background services
 * 7. Report status
 *
 * USAGE:
 *   npm run stack:bootstrap        # Interactive bootstrap
 *   npm run stack:bootstrap:auto   # Non-interactive (CI)
 *   npm run stack:bootstrap -- --force  # Re-run checks despite an existing marker
 *   npm run stack:bootstrap -- --quick  # Run checks without finalizing production readiness
 */

import { existsSync, unlinkSync, writeFileSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { runSync } from '../core/run-command.js';
import {
  createBootstrapStatus,
  healthCheckPassed,
  resolveBootstrapOutcome,
  shouldSkipBootstrapChecks,
  type BootstrapChecks,
  type BootstrapFinalization,
  type BootstrapStatus,
} from './stack-readiness.js';

const ROOT = resolve(process.cwd());
const BOOTSTRAP_FLAG = join(ROOT, '.runtime', '.stack-bootstrapped');

// Colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(message: string, type: 'info' | 'success' | 'warn' | 'error' = 'info'): void {
  const ts = new Date().toISOString().slice(11, 19);
  const color = {
    info: colors.blue,
    success: colors.green,
    warn: colors.yellow,
    error: colors.red,
  }[type];
  console.log(`${color}[${ts}] ${message}${colors.reset}`);
}

function step(name: string, status: 'pending' | 'running' | 'done' | 'error' | 'warn'): void {
  const icons = {
    pending: '○',
    running: '◐',
    done: '✓',
    error: '✗',
    warn: '⚠',
  };
  const color = status === 'done' ? colors.green : status === 'error' ? colors.red : colors.yellow;
  console.log(`${color}${icons[status]} ${name}${colors.reset}`);
}

// =============================================================================
// BOOTSTRAP PHASES
// =============================================================================

async function phase1_startSession(): Promise<boolean> {
  step('Phase 1: Session Autostart', 'running');
  try {
    runSync('npm', ['run', 'session:autostart:detached'], {
      cwd: ROOT,
      timeout: 30000,
    });
    await new Promise((r) => setTimeout(r, 2000)); // Wait for services
    step('Phase 1: Session Autostart', 'done');
    return true;
  } catch (error) {
    step('Phase 1: Session Autostart', 'error');
    log(`Session error: ${error}`, 'warn');
    return false;
  }
}

async function phase2_initDelegation(): Promise<boolean> {
  step('Phase 2: Intelligent Delegator', 'running');
  try {
    const { getDelegatorStatus } = await import('../orchestration/intelligent-delegator.js');
    const status = getDelegatorStatus();

    if (status && status.metrics) {
      step(
        `Phase 2: Delegation Ready (${Object.keys(status.modelAvailability).length} models)`,
        'done',
      );
      return true;
    }
    step('Phase 2: Delegation Initialized', 'done');
    return true;
  } catch (error) {
    step('Phase 2: Delegation Initialization Failed', 'error');
    log(`Delegation error: ${error}`, 'warn');
    return false;
  }
}

async function phase3_initPolicyEngine(): Promise<boolean> {
  step('Phase 3: Policy Engine', 'running');
  try {
    const { PolicyEngine } = await import('../security/policy-engine/policy-engine.js');
    const policyPath = join(ROOT, 'policies', 'shell-commands.yaml');

    if (existsSync(policyPath)) {
      const engine = new PolicyEngine([policyPath], { cachePolicies: false });
      const info = engine.getPoliciesInfo();
      step(`Phase 3: Policy Engine Loaded (${info.length} policies)`, 'done');
    } else {
      step('Phase 3: Policy Engine Policies Missing', 'error');
      return false;
    }
    return true;
  } catch (error) {
    step('Phase 3: Policy Engine Load Failed', 'error');
    log(`Policy error: ${error}`, 'warn');
    return false;
  }
}

async function phase4_initRouting(): Promise<boolean> {
  step('Phase 4: Smallest Route Router', 'running');
  try {
    const { smallestRoute } = await import('../orchestration/smallest-route-router.js');
    const stats = smallestRoute.getStats();
    step(`Phase 4: Routing System Ready (${stats.total} historical)`, 'done');
    return true;
  } catch (error) {
    step('Phase 4: Routing System Failed', 'error');
    log(`Routing error: ${error}`, 'warn');
    return false;
  }
}

async function phase5_validateSecurity(): Promise<boolean> {
  step('Phase 5: Security Validation', 'running');
  try {
    const owaspPath = join(ROOT, 'docs', 'compliance', 'OWASP-AGENTIC-TOP10.md');
    if (existsSync(owaspPath)) {
      const content = readFileSync(owaspPath, 'utf-8');
      const hasFullCoverage = content.includes('10/10') || content.includes('100%');
      if (hasFullCoverage) {
        step('Phase 5: OWASP Compliance (10/10)', 'done');
        return true;
      } else {
        step('Phase 5: OWASP Compliance (partial)', 'warn');
      }
    } else {
      step('Phase 5: OWASP Docs Missing', 'error');
    }
    return false;
  } catch {
    step('Phase 5: Security Validation Failed', 'error');
    return false;
  }
}

async function phase6_healthCheck(): Promise<boolean> {
  step('Phase 6: Health Check', 'running');
  try {
    const result = runSync('npm', ['run', 'watchtower:health'], {
      cwd: ROOT,
      timeout: 60000,
    });
    const output = result.stdout + result.stderr;
    const summary = output.match(/PASS:\s*(\d+)\s*\|\s*WARN:\s*\d+\s*\|\s*FAIL:\s*(\d+)/i);
    if (healthCheckPassed(output)) {
      step(`Phase 6: Stack Health (${summary?.[1]} checks passed)`, 'done');
      return true;
    }
    step('Phase 6: Required health checks did not all pass', 'error');
    return false;
  } catch {
    step('Phase 6: Health Check Incomplete', 'error');
    return false;
  }
}

async function phase7_finalize(checks: BootstrapChecks): Promise<BootstrapStatus> {
  step('Phase 7: Finalizing', 'running');
  const status = createBootstrapStatus(checks);
  if (!status.healthy) {
    step('Phase 7: Bootstrap Not Ready', 'error');
    return status;
  }
  try {
    writeFileSync(BOOTSTRAP_FLAG, status.timestamp);
  } catch (error) {
    clearBootstrapMarker();
    step('Phase 7: Could Not Write Bootstrap Marker', 'error');
    log(`Bootstrap marker error: ${error}`, 'error');
    return { ...status, phase: 'failed', healthy: false };
  }
  step('Phase 7: Bootstrap Complete', 'done');
  return status;
}

function clearBootstrapMarker(): void {
  try {
    if (existsSync(BOOTSTRAP_FLAG)) unlinkSync(BOOTSTRAP_FLAG);
  } catch (error) {
    log(`Could not remove stale bootstrap marker: ${error}`, 'error');
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  const autoMode = process.argv.includes('--auto');
  const quickMode = process.argv.includes('--quick');
  const forceMode = process.argv.includes('--force');

  log('╔════════════════════════════════════════════════════════════════╗', 'info');
  log('║   GENTLE-VANGUARD STACK BOOTSTRAP v1.0                         ║', 'info');
  log('║   Automatic initialization for production use                   ║', 'info');
  log('╚════════════════════════════════════════════════════════════════╝', 'info');
  log('');

  // Check if already bootstrapped
  const markerExists = existsSync(BOOTSTRAP_FLAG);
  if (shouldSkipBootstrapChecks(markerExists, autoMode, forceMode)) {
    const lastBootstrap = readFileSync(BOOTSTRAP_FLAG, 'utf-8');
    log(`Previous bootstrap marker found: ${lastBootstrap}`, 'info');
    log('Readiness is not verified by a marker. Re-run all checks with --force.', 'warn');
    process.exitCode = 1;
    return;
  }

  clearBootstrapMarker();
  const startTime = Date.now();

  // Execute phases
  const results = {
    session: await phase1_startSession(),
    delegation: await phase2_initDelegation(),
    policy: await phase3_initPolicyEngine(),
    routing: await phase4_initRouting(),
    security: await phase5_validateSecurity(),
    health: await phase6_healthCheck(),
  };

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const checksPassed = createBootstrapStatus(results).healthy;
  let finalization: BootstrapFinalization = quickMode ? 'skipped' : 'failed';
  if (!checksPassed) {
    clearBootstrapMarker();
  } else if (!quickMode) {
    const status = await phase7_finalize(results);
    finalization = status.healthy ? 'complete' : 'failed';
  }
  const outcome = resolveBootstrapOutcome(results, finalization);

  // Final report
  log('');
  log('╔════════════════════════════════════════════════════════════════╗', 'info');
  log('║   BOOTSTRAP REPORT                                             ║', 'info');
  log('╠════════════════════════════════════════════════════════════════╣', 'info');
  const statusLabel = outcome.status;
  log(
    `║   Status: ${statusLabel}${' '.repeat(Math.max(0, 39 - statusLabel.length))}║`,
    outcome.readinessVerified ? 'success' : outcome.exitCode === 0 ? 'warn' : 'error',
  );
  log(`║   Duration: ${duration}s${' '.repeat(33)}║`, 'info');
  log('╠════════════════════════════════════════════════════════════════╣', 'info');
  log(
    `║   Session Manager:    ${results.session ? '✅ Ready' : '❌ Failed'}${' '.repeat(25)}║`,
    results.session ? 'success' : 'error',
  );
  log(
    `║   Intelligent Delegation: ${results.delegation ? '✅ Ready' : '❌ Failed'}${' '.repeat(21)}║`,
    results.delegation ? 'success' : 'error',
  );
  log(
    `║   Policy Engine:     ${results.policy ? '✅ Ready' : '❌ Failed'}${' '.repeat(25)}║`,
    results.policy ? 'success' : 'error',
  );
  log(
    `║   Route Router:      ${results.routing ? '✅ Ready' : '❌ Failed'}${' '.repeat(25)}║`,
    results.routing ? 'success' : 'error',
  );
  log(
    `║   Security Compliance: ${results.security ? '✅ Ready' : '❌ Failed'}${' '.repeat(23)}║`,
    results.security ? 'success' : 'error',
  );
  log(
    `║   Health Checks:     ${results.health ? '✅ Ready' : '❌ Failed'}${' '.repeat(25)}║`,
    results.health ? 'success' : 'error',
  );
  log('╚════════════════════════════════════════════════════════════════╝', 'info');
  log('');

  // Quick ref
  log('Quick Commands:', 'info');
  log('  npm run stack:status           # View full status', 'info');
  log('  npm run delegate:status        # View delegation status', 'info');
  log('  npm run route:analyze          # Analyze task routing', 'info');
  log('  npm run validate:stack         # Full validation', 'info');
  log('');
  if (outcome.readinessVerified) {
    log('All required bootstrap checks passed.', 'success');
  } else {
    log('Production readiness not verified.', 'error');
  }

  process.exitCode = outcome.exitCode;
}

// Run
void main();
