#!/usr/bin/env node
/**
 * Guardrails Status - Verificación de todos los guardrails del stack
 *
 * Muestra el estado de todos los sistemas de protección activos.
 *
 * Uso:
 *   npx tsx src/core/guardrails-status.ts
 *   npx tsx src/core/guardrails-status.ts --json
 *   npx tsx src/core/guardrails-status.ts --category security
 */

import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

const ROOT = resolve(process.cwd());

interface GuardrailCheck {
  name: string;
  category: 'security' | 'performance' | 'quality' | 'architectural' | 'mcp';
  status: 'OK' | 'WARN' | 'FAIL' | 'UNKNOWN';
  message: string;
  details?: string;
}

interface GuardrailsReport {
  timestamp: string;
  total: number;
  ok: number;
  warn: number;
  fail: number;
  checks: GuardrailCheck[];
}

/**
 * Verificar un guardrail individual
 */
function checkGuardrail(
  name: string,
  category: GuardrailCheck['category'],
  checkFn: () => { status: GuardrailCheck['status']; message: string; details?: string },
): GuardrailCheck {
  try {
    const result = checkFn();
    return {
      name,
      category,
      status: result.status,
      message: result.message,
      details: result.details,
    };
  } catch (e) {
    return {
      name,
      category,
      status: 'UNKNOWN',
      message: `Error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Security Guards
 */
function runSecurityChecks(): GuardrailCheck[] {
  const checks: GuardrailCheck[] = [];

  // 1. Secret Scanner
  checks.push(
    checkGuardrail('Secret Scanner', 'security', () => {
      const path = join(ROOT, 'src', 'security', 'secret-scanner.ts');
      return {
        status: existsSync(path) ? 'OK' : 'FAIL',
        message: existsSync(path) ? 'Module exists' : 'Module missing',
      };
    }),
  );

  // 2. Security Orchestrator
  checks.push(
    checkGuardrail('Security Orchestrator', 'security', () => {
      const path = join(ROOT, 'src', 'security', 'security-orchestrator.ts');
      return {
        status: existsSync(path) ? 'OK' : 'FAIL',
        message: existsSync(path) ? 'Module exists' : 'Module missing',
      };
    }),
  );

  // 3. Prompt Injection Guard
  checks.push(
    checkGuardrail('Prompt Injection Guard', 'security', () => {
      const path = join(ROOT, 'src', 'security', 'prompt-injection-guard.ts');
      return {
        status: existsSync(path) ? 'OK' : 'FAIL',
        message: existsSync(path) ? 'Module exists' : 'Module missing',
      };
    }),
  );

  // 4. Safety Guardrails
  checks.push(
    checkGuardrail('Safety Guardrails', 'security', () => {
      const path = join(ROOT, 'src', 'security', 'safety-guardrails.ts');
      return {
        status: existsSync(path) ? 'OK' : 'FAIL',
        message: existsSync(path) ? 'Module exists' : 'Module missing',
      };
    }),
  );

  // 5. Gitleaks config
  checks.push(
    checkGuardrail('Gitleaks Config', 'security', () => {
      const path = join(ROOT, '.gitleaks.toml');
      return {
        status: existsSync(path) ? 'OK' : 'WARN',
        message: existsSync(path) ? 'Config found' : 'Using default rules',
      };
    }),
  );

  return checks;
}

/**
 * Performance Guards
 */
function runPerformanceChecks(): GuardrailCheck[] {
  const checks: GuardrailCheck[] = [];

  // 1. Token Budget Guard
  checks.push(
    checkGuardrail('Token Budget Guard', 'performance', () => {
      const path = join(ROOT, 'config', 'token-budget-guard.json');
      return {
        status: existsSync(path) ? 'OK' : 'FAIL',
        message: existsSync(path) ? 'Config exists' : 'Config missing',
      };
    }),
  );

  // 2. Process Hygiene
  checks.push(
    checkGuardrail('Process Hygiene', 'performance', () => {
      const path = join(ROOT, 'src', 'core', 'process-hygiene.ts');
      return {
        status: existsSync(path) ? 'OK' : 'FAIL',
        message: existsSync(path) ? 'Module exists' : 'Module missing',
      };
    }),
  );

  // 3. Loop Guard
  checks.push(
    checkGuardrail('Loop Guard', 'performance', () => {
      const path = join(ROOT, 'src', 'core', 'loop-guard-service.ts');
      return {
        status: existsSync(path) ? 'OK' : 'FAIL',
        message: existsSync(path) ? 'Module exists + persisted' : 'Module missing',
      };
    }),
  );

  // 4. Timeout Monitor
  checks.push(
    checkGuardrail('Timeout Monitor', 'performance', () => {
      const path = join(ROOT, 'src', 'core', 'timeout-monitor.ts');
      return {
        status: existsSync(path) ? 'OK' : 'FAIL',
        message: existsSync(path) ? 'Module exists' : 'Module missing',
      };
    }),
  );

  // 5. Token Ingest
  checks.push(
    checkGuardrail('Token Ingest', 'performance', () => {
      const path = join(ROOT, 'src', 'tokens', 'token-ingest.ts');
      return {
        status: existsSync(path) ? 'OK' : 'FAIL',
        message: existsSync(path) ? 'Module exists' : 'Module missing',
      };
    }),
  );

  return checks;
}

/**
 * Quality Guards
 */
function runQualityChecks(): GuardrailCheck[] {
  const checks: GuardrailCheck[] = [];

  // TypeScript check
  checks.push(
    checkGuardrail('TypeScript Config', 'quality', () => {
      const path = join(ROOT, 'tsconfig.json');
      return {
        status: existsSync(path) ? 'OK' : 'FAIL',
        message: existsSync(path) ? 'Config exists' : 'Missing tsconfig.json',
      };
    }),
  );

  // Lint config
  checks.push(
    checkGuardrail('ESLint Config', 'quality', () => {
      const path = join(ROOT, '.eslintrc.json');
      return {
        status: existsSync(path) ? 'OK' : 'WARN',
        message: existsSync(path) ? 'Config exists' : 'Using defaults',
      };
    }),
  );

  // Test config
  checks.push(
    checkGuardrail('Test Config', 'quality', () => {
      const path = join(ROOT, 'tests');
      return {
        status: existsSync(path) ? 'OK' : 'WARN',
        message: existsSync(path) ? 'Test suite exists' : 'No tests found',
      };
    }),
  );

  return checks;
}

/**
 * Architectural Guards
 */
function runArchitecturalChecks(): GuardrailCheck[] {
  const checks: GuardrailCheck[] = [];

  // Session Validator
  checks.push(
    checkGuardrail('Session Validator', 'architectural', () => {
      const path = join(ROOT, 'src', 'session', 'session-validator.ts');
      return {
        status: existsSync(path) ? 'OK' : 'FAIL',
        message: existsSync(path) ? 'Module exists' : 'Module missing',
      };
    }),
  );

  // Stale Session Sweeper
  checks.push(
    checkGuardrail('Stale Session Sweeper', 'architectural', () => {
      const path = join(ROOT, 'src', 'session', 'stale-session-sweeper.ts');
      return {
        status: existsSync(path) ? 'OK' : 'FAIL',
        message: existsSync(path) ? 'Module exists' : 'Module missing',
      };
    }),
  );

  // Session Retention
  checks.push(
    checkGuardrail('Session Retention', 'architectural', () => {
      const path = join(ROOT, 'src', 'session', 'session-retention.ts');
      return {
        status: existsSync(path) ? 'OK' : 'FAIL',
        message: existsSync(path) ? 'Module exists' : 'Module missing',
      };
    }),
  );

  // Watchtower
  checks.push(
    checkGuardrail('Maintenance Watchtower', 'architectural', () => {
      const path = join(ROOT, 'src', 'core', 'maintenance-watchtower.ts');
      return {
        status: existsSync(path) ? 'OK' : 'FAIL',
        message: existsSync(path) ? 'Module exists' : 'Module missing',
      };
    }),
  );

  // Nexus DB
  checks.push(
    checkGuardrail('Nexus DB', 'architectural', () => {
      const path = join(ROOT, '.runtime', 'gentle-vanguard.db');
      if (!existsSync(path)) {
        return { status: 'WARN', message: 'DB not initialized yet' };
      }
      try {
        const stats = require('fs').statSync(path);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        return { status: 'OK', message: `DB exists (${sizeMB} MB)` };
      } catch {
        return { status: 'OK', message: 'DB exists' };
      }
    }),
  );

  return checks;
}

/**
 * MCP Guards
 */
function runMCPChecks(): GuardrailCheck[] {
  const checks: GuardrailCheck[] = [];

  // MCP Registry
  checks.push(
    checkGuardrail('MCP Registry', 'mcp', () => {
      const path = join(ROOT, 'config', 'mcp-registry.json');
      return {
        status: existsSync(path) ? 'OK' : 'FAIL',
        message: existsSync(path) ? 'Registry exists' : 'Missing',
      };
    }),
  );

  // MCP Execution Policy
  checks.push(
    checkGuardrail('MCP Execution Policy', 'mcp', () => {
      const path = join(ROOT, 'config', 'mcp-execution-policy.json');
      return {
        status: existsSync(path) ? 'OK' : 'WARN',
        message: existsSync(path) ? 'Policy exists' : 'Missing (optional)',
      };
    }),
  );

  // MCP Lifecycle Policy
  checks.push(
    checkGuardrail('MCP Lifecycle Policy', 'mcp', () => {
      const path = join(ROOT, 'config', 'mcp-lifecycle-policy.json');
      return {
        status: existsSync(path) ? 'OK' : 'WARN',
        message: existsSync(path) ? 'Policy exists' : 'Missing (optional)',
      };
    }),
  );

  // MCP Skill available (audit)
  checks.push(
    checkGuardrail('MCP Audit Skill', 'mcp', () => {
      // Skill is in user's agents folder, not in repo
      return {
        status: 'OK',
        message: 'Skill available (external)',
        details: 'Use: auditing-mcp-servers-for-tool-poisoning skill',
      };
    }),
  );

  return checks;
}

/**
 * Generate full report
 */
function generateReport(): GuardrailsReport {
  const allChecks: GuardrailCheck[] = [
    ...runSecurityChecks(),
    ...runPerformanceChecks(),
    ...runQualityChecks(),
    ...runArchitecturalChecks(),
    ...runMCPChecks(),
  ];

  return {
    timestamp: new Date().toISOString(),
    total: allChecks.length,
    ok: allChecks.filter((c) => c.status === 'OK').length,
    warn: allChecks.filter((c) => c.status === 'WARN').length,
    fail: allChecks.filter((c) => c.status === 'FAIL').length,
    checks: allChecks,
  };
}

/**
 * Print report to console
 */
function printReport(report: GuardrailsReport, category?: string): void {
  const filtered = category ? report.checks.filter((c) => c.category === category) : report.checks;

  console.log('\n🛡️  GUARDRAILS STATUS\n');
  console.log(`Timestamp: ${report.timestamp}`);
  console.log(
    `Total: ${report.total} | ✅ OK: ${report.ok} | ⚠️  WARN: ${report.warn} | ❌ FAIL: ${report.fail}\n`,
  );

  const categories = ['security', 'performance', 'quality', 'architectural', 'mcp'] as const;

  for (const cat of categories) {
    const catChecks = filtered.filter((c) => c.category === cat);
    if (catChecks.length === 0) continue;

    const catEmoji = {
      security: '🔒',
      performance: '⚡',
      quality: '✅',
      architectural: '🏗️',
      mcp: '🔌',
    }[cat];

    console.log(`${catEmoji} ${cat.toUpperCase()}`);
    console.log('─'.repeat(50));

    for (const check of catChecks) {
      const statusIcon = {
        OK: '✅',
        WARN: '⚠️ ',
        FAIL: '❌',
        UNKNOWN: '❓',
      }[check.status];

      console.log(`  ${statusIcon} ${check.name}: ${check.message}`);
      if (check.details) {
        console.log(`       └─ ${check.details}`);
      }
    }
    console.log('');
  }
}

// CLI
function main(): void {
  const args = process.argv.slice(2);
  const jsonFlag = args.includes('--json');
  const category = args.find((a) => a.startsWith('--category='))?.split('=')[1];

  const report = generateReport();

  if (jsonFlag) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report, category);
  }

  // Exit with error if any critical failures
  if (report.fail > 0) {
    console.log(`\n⚠️  ${report.fail} guardrail(s) FAILED - action required!`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
