#!/usr/bin/env npx tsx
/**
 * Stack Compliance Enforcer
 *
 * Verifies stack integrity at session start and after changes.
 * Runs as a required step in session-autostart pipeline.
 *
 * Checks:
 *   1. opencode.json subagents — no PowerShell @{...} syntax, valid model configs
 *   2. auto-delegation.json agentProfiles — match opencode subagents
 *   3. No deprecated bypass scripts (team-orchestrator, agent-message-bus, etc.)
 *   4. session-autostart.cmd — references TS not PS1
 *   5. model-switch availability — npm scripts registered
 *   6. Model active — .runtime/model-active.json exists if switched
 *
 * Output: .runtime/stack-compliance-report.json
 * Exit: 0 = PASS, 1 = WARN, 2 = FAIL
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORT_PATH = join(ROOT, '.runtime', 'stack-compliance-report.json');
const MODEL_ACTIVE_PATH = join(ROOT, '.runtime', 'model-active.json');

// ─── Helpers ────────────────────────────────────────────────────────────────

interface CheckResult {
  name: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  message: string;
}

const checks: CheckResult[] = [];

function check(
  name: string,
  pass: boolean,
  message: string,
  severity: 'PASS' | 'WARN' | 'FAIL' = 'PASS',
): void {
  const status = pass ? 'PASS' : severity;
  checks.push({ name, status, message });
}

function readJsonSafe<T>(path: string): T | null {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    /* ignore */
  }
  return null;
}

// ─── Checks ─────────────────────────────────────────────────────────────────

function checkOpenCodeSubagents(): void {
  const path = join(ROOT, 'opencode.json');
  if (!existsSync(path)) {
    check('opencode.json exists', false, 'File not found', 'FAIL');
    return;
  }

  try {
    const config = JSON.parse(readFileSync(path, 'utf-8'));
    const agents = config.agent || {};
    const agentNames = Object.keys(agents);

    // Check for PowerShell @{...} syntax (would cause JSON parse to fail, so this is just a safeguard)
    const content = readFileSync(path, 'utf-8');
    const hasPS1Syntax = /@\{/.test(content);

    // Count subagents
    const subagents = agentNames.filter((name: string) => agents[name].mode === 'subagent');

    check(
      'opencode.json parsable',
      true,
      `${agentNames.length} agents (${subagents.length} subagents)`,
    );
    check('No PS1 @{...} syntax', !hasPS1Syntax, 'Clean JSON');

    // Check each subagent has valid structure
    const issues: string[] = [];
    for (const [name, agent] of Object.entries(agents) as [string, any][]) {
      if (agent.mode === 'subagent') {
        // Validate description and steps exist
        if (!agent.description) issues.push(`${name}: missing description`);
        if (!agent.steps) issues.push(`${name}: missing steps`);
        // Validate model field is present (injected by model:fix — prevents
        // OpenCode's internal stale defaults like openrouter/moonshot/kimi-k2.6)
        if (!agent.model) issues.push(`${name}: missing model (run npm run model:fix)`);
      }
    }

    if (issues.length > 0) {
      check('Subagent validation', false, issues.join('; '), 'WARN');
    } else {
      check('Subagent validation', true, 'All subagents valid');
    }
  } catch (err) {
    check('opencode.json parse', false, `Invalid JSON: ${err}`, 'FAIL');
  }
}

function checkAutoDelegation(): void {
  const path = join(ROOT, 'config', 'auto-delegation.json');
  if (!existsSync(path)) {
    check('auto-delegation.json exists', false, 'File not found', 'WARN');
    return;
  }

  try {
    const config = JSON.parse(readFileSync(path, 'utf-8'));
    const opencodePath = join(ROOT, 'opencode.json');
    const opencodeConfig = readJsonSafe<{ agent: Record<string, any> }>(opencodePath);
    const opencodeAgents = opencodeConfig?.agent ? Object.keys(opencodeConfig.agent) : [];

    // Check if _meta exists
    const hasMeta = !!config._meta;

    // Check availableAgents reference valid subagents
    const available = config.availableAgents || config.agentProfiles || {};
    const availableNames = Object.keys(available);

    const missing = availableNames.filter((name: string) => !opencodeAgents.includes(name));

    if (missing.length > 0) {
      check(
        'auto-delegation references',
        false,
        `${missing.length} agents not in opencode.json: ${missing.join(', ')}`,
        'WARN',
      );
    } else {
      check(
        'auto-delegation references',
        true,
        `${availableNames.length} agents match opencode.json`,
      );
    }

    check(
      'auto-delegation _meta',
      hasMeta,
      hasMeta ? '_meta section present' : 'Missing _meta section',
      'WARN',
    );
  } catch (err) {
    check('auto-delegation.json parse', false, `Invalid JSON: ${err}`, 'WARN');
  }
}

function checkDeprecatedScripts(): void {
  const deprecatedScripts = [
    'team-orchestrator.ts',
    'agent-message-bus.ts',
    'sdd-pipeline.ts',
    'orchestrate-auto-fix.ts',
  ];

  const found: string[] = [];
  for (const script of deprecatedScripts) {
    const path = join(ROOT, 'src', script);
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf-8');
      // Check if it has a deprecation header
      if (!content.includes('@deprecated') && !content.includes('DEPRECATED')) {
        found.push(script);
      }
    }
  }

  if (found.length > 0) {
    check(
      'Deprecated bypass scripts',
      false,
      `${found.length} non-deprecated scripts found: ${found.join(', ')}`,
      'WARN',
    );
  } else {
    check('Deprecated bypass scripts', true, 'No active bypass scripts');
  }
}

function checkSessionAutostart(): void {
  const path = join(ROOT, 'scripts', 'utilities', 'session', 'session-autostart.cmd');
  if (!existsSync(path)) {
    check('session-autostart.cmd', false, 'File not found', 'WARN');
    return;
  }

  const content = readFileSync(path, 'utf-8');
  const referencesTS = content.includes('session-autostart.ts');

  check(
    'session-autostart.cmd references TS',
    referencesTS,
    referencesTS ? 'References src/session-autostart.ts' : 'References .ps1 (outdated)',
    referencesTS ? 'PASS' : 'FAIL',
  );
}

function checkModelSwitch(): void {
  const packagePath = join(ROOT, 'package.json');
  if (!existsSync(packagePath)) {
    check('model-switch scripts', false, 'package.json not found', 'WARN');
    return;
  }

  try {
    const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
    const scripts = pkg.scripts || {};

    const hasModelCurrent = 'model:current' in scripts;
    const hasModelSwitch = 'model:switch' in scripts;
    const hasModelList = 'model:list' in scripts;
    const hasModelHelp = 'model:help' in scripts;

    if (hasModelCurrent && hasModelSwitch && hasModelList && hasModelHelp) {
      check(
        'model-switch npm scripts',
        true,
        'model:current, model:switch, model:list, model:help',
      );
    } else {
      const missing = [];
      if (!hasModelCurrent) missing.push('model:current');
      if (!hasModelSwitch) missing.push('model:switch');
      if (!hasModelList) missing.push('model:list');
      if (!hasModelHelp) missing.push('model:help');
      check('model-switch npm scripts', false, `Missing: ${missing.join(', ')}`, 'WARN');
    }

    // Check model-switch.ts exists
    const scriptPath = join(ROOT, 'scripts', 'utilities', 'MODEL-ROUTER', 'model-switch.ts');
    check(
      'model-switch.ts exists',
      existsSync(scriptPath),
      existsSync(scriptPath) ? 'Script found' : 'Script not found',
      'WARN',
    );

    // Check model-active.json
    const active = readJsonSafe<{ model: string }>(MODEL_ACTIVE_PATH);
    if (active?.model) {
      check('Active model persisted', true, `Current: ${active.model}`);
    } else {
      check(
        'Active model persisted',
        false,
        'No model:switch executed yet (run npm run model:switch <model>)',
        'WARN',
      );
    }
  } catch (err) {
    check('model-switch check', false, `Error: ${err}`, 'WARN');
  }
}

function checkProviderConfig(): void {
  const path = join(ROOT, 'opencode.json');
  if (!existsSync(path)) return;

  try {
    const config = JSON.parse(readFileSync(path, 'utf-8'));
    const providers = config.provider || {};
    const providerNames = Object.keys(providers);

    if (providerNames.length > 0) {
      check(
        'Provider configs',
        true,
        `${providerNames.length} providers: ${providerNames.join(', ')}`,
      );

      // Check openrouter has models
      if (providers.openrouter) {
        const modelCount = Object.keys(providers.openrouter.models || {}).length;
        check(
          'OpenRouter models',
          modelCount > 0,
          `${modelCount} models configured`,
          modelCount > 0 ? 'PASS' : 'WARN',
        );
      }
    } else {
      check('Provider configs', true, 'No custom providers (using opencode default)');
    }
  } catch (err) {
    check('Provider check', false, `Error: ${err}`, 'WARN');
  }
}

// ─── Report ─────────────────────────────────────────────────────────────────

function generateReport(): void {
  const passed = checks.filter((c) => c.status === 'PASS').length;
  const warnings = checks.filter((c) => c.status === 'WARN').length;
  const failures = checks.filter((c) => c.status === 'FAIL').length;

  const report = {
    session: `session-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    timestamp: new Date().toISOString(),
    checks: checks.map((c) => ({
      name: c.name,
      status: c.status,
      message: c.message,
    })),
    summary: {
      passed,
      warnings,
      failures,
      total: checks.length,
    },
    verdict: failures > 0 ? 'FAIL' : warnings > 0 ? 'WARN' : 'PASS',
  };

  // Ensure .runtime directory exists
  const dir = dirname(REPORT_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');

  // Console output
  console.log('\n' + '═'.repeat(47));
  console.log('  STACK COMPLIANCE REPORT');
  console.log('═'.repeat(47));
  console.log(`  Session: ${report.session}`);
  console.log(`  Time:    ${report.timestamp}\n`);

  for (const c of checks) {
    const icon = c.status === 'PASS' ? '✅' : c.status === 'WARN' ? '⚠️' : '❌';
    console.log(`  ${icon} [${c.status}] ${c.name}`);
    console.log(`     ${c.message}`);
  }

  console.log(`\n  Summary: ${passed} passed, ${warnings} warnings, ${failures} failures`);
  console.log(`  Verdict: ${report.verdict}`);

  if (failures > 0) {
    console.log('\n  ❌ FAILURES DETECTED — pipeline should be blocked');
    process.exit(2);
  } else if (warnings > 0) {
    console.log('\n  ⚠️  Warnings detected — review recommended');
    process.exit(1);
  } else {
    console.log('\n  ✅ All checks passed');
    process.exit(0);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  checkOpenCodeSubagents();
  checkAutoDelegation();
  checkDeprecatedScripts();
  checkSessionAutostart();
  checkModelSwitch();
  checkProviderConfig();
  generateReport();
}

main();
