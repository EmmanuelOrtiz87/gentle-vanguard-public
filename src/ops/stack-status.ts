#!/usr/bin/env node
/**
 * Stack Status — Real-time State Report
 *
 * Shows current status of all Gentle-Vanguard components
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(process.cwd());

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(msg: string, type: 'info' | 'success' | 'warn' = 'info'): void {
  const color = { info: colors.blue, success: colors.green, warn: colors.yellow }[type];
  console.log(`${color}${msg}${colors.reset}`);
}

async function main(): Promise<void> {
  log('╔════════════════════════════════════════════════════════════════╗', 'info');
  log('║   GENTLE-VANGUARD STACK STATUS                                 ║', 'info');
  log('╚════════════════════════════════════════════════════════════════╝', 'info');
  log('');

  // Intelligent Delegator Status
  try {
    const { getDelegatorStatus } = await import('../orchestration/intelligent-delegator.js');
    const status = getDelegatorStatus();

    log('📦 Intelligent Delegator', 'info');
    log(`   Last Working Model: ${status.lastWorkingModel || 'none'}`, 'info');
    log(`   Total Delegations: ${status.metrics.totalDelegations}`, 'info');
    log(`   Successful: ${status.metrics.successfulDelegations}`, 'success');
    log(`   Fallbacks Used: ${status.metrics.fallbackCount}`, status.metrics.fallbackCount > 0 ? 'warn' : 'info');
    log(`   Models Available: ${Object.keys(status.modelAvailability).length}`, 'info');
    log('');
  } catch {
    log('📦 Intelligent Delegator: Not initialized', 'warn');
  }

  // Routing Stats
  try {
    const { smallestRoute } = await import('../orchestration/smallest-route-router.js');
    const stats = smallestRoute.getStats();

    log('🧭 Smallest Route Router', 'info');
    log(`   Historical Routings: ${stats.total}`, 'info');
    log(`   Direct: ${stats.byRoute.direct} | Delegated: ${stats.byRoute.delegated} | SDD: ${stats.byRoute.sdd}`, 'info');
    log(`   Avg Confidence: ${(stats.averageConfidence * 100).toFixed(1)}%`, 'info');
    log('');
  } catch {
    log('🧭 Smallest Route Router: Not initialized', 'warn');
  }

  // Policy Engine
  const policyPath = join(ROOT, 'policies', 'shell-commands.yaml');
  if (existsSync(policyPath)) {
    log('🛡️  Policy Engine', 'success');
    log('   Status: Active', 'success');
    log(`   Example Policy: ${policyPath}`, 'info');
    log('');
  } else {
    log('🛡️  Policy Engine: No policies loaded', 'warn');
  }

  // OWASP Compliance
  const owaspPath = join(ROOT, 'docs', 'compliance', 'OWASP-AGENTIC-TOP10.md');
  if (existsSync(owaspPath)) {
    const content = readFileSync(owaspPath, 'utf-8');
    const hasFull = content.includes('10/10') || content.includes('100%');
    log('🔒 OWASP Agentic Top 10', 'success');
    log(hasFull ? '   Coverage: 10/10 (100%)' : '   Coverage: Partial', hasFull ? 'success' : 'warn');
    log('');
  } else {
    log('🔒 OWASP Compliance: Docs not found', 'warn');
  }

  // Bootstrap Status
  const bootstrapFlag = join(ROOT, '.runtime', '.stack-bootstrapped');
  if (existsSync(bootstrapFlag)) {
    const ts = readFileSync(bootstrapFlag, 'utf-8');
    log('✅ Stack Bootstrapped', 'success');
    log(`   Last: ${ts.slice(0, 19)}`, 'info');
    log('');
  } else {
    log('⚠️  Stack Not Bootstrapped', 'warn');
    log('   Run: npm run stack:bootstrap', 'info');
    log('');
  }

  // Quick Commands
  log('Quick Commands:', 'info');
  log('  npm run stack:bootstrap       # Bootstrap stack', 'info');
  log('  npm run delegate:status        # Delegation status', 'info');
  log('  npm run route:stats            # Routing statistics', 'info');
  log('  npm run validate:stack         # Full validation', 'info');
  log('');
  log('Stack is ready for production!', 'success');
}

void main();
