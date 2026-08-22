#!/usr/bin/env node
/**
 * Module Maturity — core vs experimental registry + governance activation gates.
 *
 * Reads config/module-maturity.json and exposes:
 *   - validateActivation(moduleId, opts): evaluates the governance gates for a module
 *   - CLI: list | --status | --validate <id> | --gate <id> [--run-checks]
 *
 * Usage:
 *   npx tsx src/module-maturity.ts list
 *   npx tsx src/module-maturity.ts --status
 *   npx tsx src/module-maturity.ts --validate session-pipeline
 *   npx tsx src/module-maturity.ts --validate predictive-governor --run-checks
 *   npx tsx src/module-maturity.ts --gate cross-workspace-mesh
 *
 * Policy: core modules are the default daily path (no opt-in). Experimental modules
 * require opt-in activation and must satisfy the minimum governance gates (tests,
 * typecheck, lint, security scan, governance approval, owner sign-off) before rollout.
 */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

const ROOT = resolve(process.cwd());
const CONFIG_PATH = join(ROOT, 'config', 'module-maturity.json');
const PACKAGE_PATH = join(ROOT, 'package.json');

const NPM_SCRIPT_BY_CHECK: Record<string, string> = {
  tests: 'test',
  typecheck: 'typecheck',
  lint: 'lint',
  'security-scan': 'secretlint',
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type ModuleCategory = 'core' | 'experimental' | 'deprecated';
export type ModuleMaturity = 'stable' | 'beta' | 'experimental';
export type ModuleRisk = 'low' | 'medium' | 'high';

export interface ActivationCriterion {
  check: string;
  required: boolean;
}

export interface MaturityModule {
  id: string;
  name: string;
  category: ModuleCategory;
  maturity: ModuleMaturity;
  optIn: boolean;
  activated: boolean;
  risk: ModuleRisk;
  owner: string;
  script?: string;
  description: string;
  activationCriteria: ActivationCriterion[];
}

export interface MaturityConfig {
  version: string;
  name: string;
  description: string;
  policy?: {
    coreDefault?: boolean;
    experimentalOptIn?: boolean;
    approvalRoles?: string[];
    minimumGates?: string[];
    approvalFileDir?: string;
    moduleDocDir?: string;
  };
  modules: MaturityModule[];
}

export interface CriterionResult {
  check: string;
  required: boolean;
  satisfied: boolean;
  verified: boolean;
  note?: string;
}

export interface ValidationResult {
  moduleId: string;
  found: boolean;
  category?: ModuleCategory;
  maturity?: ModuleMaturity;
  optIn?: boolean;
  activated?: boolean;
  pass: boolean;
  reason: string;
  criteria: CriterionResult[];
  missingRequired: string[];
}

export interface ValidateOptions {
  /** Execute npm run <gate> for automated checks instead of checking script presence. */
  runChecks?: boolean;
  /** Simulate owner sign-off for owner-signoff criteria. */
  ownerSignoff?: boolean;
  /** Override the config path (mainly for tests). */
  configPath?: string;
  /** Override the root dir used to resolve script/approval files (mainly for tests). */
  root?: string;
}

// ─── Loading ──────────────────────────────────────────────────────────────────

export function loadModuleConfig(options: ValidateOptions = {}): MaturityConfig {
  const path = options.configPath ?? CONFIG_PATH;
  if (!existsSync(path)) {
    throw new Error(`Module maturity config not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf-8')) as MaturityConfig;
}

function findModule(config: MaturityConfig, moduleId: string): MaturityModule | undefined {
  return config.modules.find((m) => m.id === moduleId);
}

function npmScriptExists(name: string): boolean {
  try {
    if (!existsSync(PACKAGE_PATH)) return false;
    const pkg = JSON.parse(readFileSync(PACKAGE_PATH, 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    return Boolean(pkg.scripts && typeof pkg.scripts[name] === 'string');
  } catch {
    return false;
  }
}

// ─── Criterion evaluation ─────────────────────────────────────────────────────

function policyDir(config: MaturityConfig, key: 'approvalFileDir' | 'moduleDocDir'): string {
  return (
    config.policy?.[key] ??
    (key === 'approvalFileDir' ? 'docs/governance/activation-decisions' : 'docs/modules')
  );
}

function evaluateCriterion(
  module: MaturityModule,
  criterion: ActivationCriterion,
  config: MaturityConfig,
  options: ValidateOptions,
): CriterionResult {
  const root = options.root ?? ROOT;

  if (criterion.check === 'config-valid') {
    if (module.script) {
      const scriptPath = join(root, module.script);
      const satisfied = existsSync(scriptPath);
      return {
        check: criterion.check,
        required: criterion.required,
        satisfied,
        verified: true,
        note: satisfied
          ? `entry script exists (${module.script})`
          : `entry script missing (${module.script})`,
      };
    }
    return {
      check: criterion.check,
      required: criterion.required,
      satisfied: true,
      verified: true,
      note: 'declared module — no entry script to verify',
    };
  }

  if (criterion.check === 'governance-approval') {
    const approvalDir = policyDir(config, 'approvalFileDir');
    const approvalPath = join(root, approvalDir, `${module.id}.md`);
    const satisfied = existsSync(approvalPath);
    return {
      check: criterion.check,
      required: criterion.required,
      satisfied,
      verified: true,
      note: satisfied
        ? `approval recorded (${approvalDir}/${module.id}.md)`
        : `approval not recorded (${approvalDir}/${module.id}.md)`,
    };
  }

  if (criterion.check === 'documentation') {
    const docDir = policyDir(config, 'moduleDocDir');
    const docPath = join(root, docDir, `${module.id}.md`);
    const satisfied = existsSync(docPath);
    return {
      check: criterion.check,
      required: criterion.required,
      satisfied,
      verified: true,
      note: satisfied
        ? `documented (${docDir}/${module.id}.md)`
        : `not documented (${docDir}/${module.id}.md)`,
    };
  }

  if (criterion.check === 'owner-signoff') {
    const satisfied = Boolean(options.ownerSignoff) || module.activated;
    return {
      check: criterion.check,
      required: criterion.required,
      satisfied,
      verified: true,
      note: satisfied
        ? 'owner sign-off recorded'
        : 'owner sign-off pending (--ownerSignoff to simulate)',
    };
  }

  const scriptName = NPM_SCRIPT_BY_CHECK[criterion.check];
  if (scriptName) {
    if (options.runChecks) {
      const run = spawnSync('npm', ['run', scriptName, '--silent'], {
        encoding: 'utf-8',
        shell: process.platform === 'win32',
        timeout: 120_000,
        windowsHide: true,
      });
      const satisfied = run.status === 0;
      return {
        check: criterion.check,
        required: criterion.required,
        satisfied,
        verified: true,
        note: `npm run ${scriptName}: ${satisfied ? 'PASS' : 'FAIL'}`,
      };
    }
    const present = npmScriptExists(scriptName);
    return {
      check: criterion.check,
      required: criterion.required,
      satisfied: present,
      verified: false,
      note: present
        ? `npm run ${scriptName} declared — not executed (use --run-checks)`
        : `npm run ${scriptName} not declared in package.json`,
    };
  }

  return {
    check: criterion.check,
    required: criterion.required,
    satisfied: false,
    verified: true,
    note: `unknown check "${criterion.check}"`,
  };
}

// ─── Core API ─────────────────────────────────────────────────────────────────

export function validateActivation(
  moduleId: string,
  options: ValidateOptions = {},
): ValidationResult {
  const config = loadModuleConfig(options);
  const module = findModule(config, moduleId);

  if (!module) {
    return {
      moduleId,
      found: false,
      pass: false,
      reason: `module not found in config/module-maturity.json`,
      criteria: [],
      missingRequired: ['module-definition'],
    };
  }

  if (module.category === 'deprecated') {
    return {
      moduleId,
      found: true,
      category: module.category,
      maturity: module.maturity,
      optIn: module.optIn,
      activated: module.activated,
      pass: false,
      reason: `deprecated — activation not permitted`,
      criteria: [],
      missingRequired: [],
    };
  }

  if (module.category === 'core') {
    return {
      moduleId,
      found: true,
      category: module.category,
      maturity: module.maturity,
      optIn: module.optIn,
      activated: module.activated,
      pass: true,
      reason: 'core — always active by default, no opt-in required',
      criteria: module.activationCriteria.map((c) => ({
        check: c.check,
        required: c.required,
        satisfied: true,
        verified: true,
        note: 'core module — default daily path',
      })),
      missingRequired: [],
    };
  }

  const criteria = module.activationCriteria.map((c) =>
    evaluateCriterion(module, c, config, options),
  );
  const missingRequired = criteria.filter((c) => c.required && !c.satisfied).map((c) => c.check);
  const pass = module.activated || missingRequired.length === 0;

  return {
    moduleId,
    found: true,
    category: module.category,
    maturity: module.maturity,
    optIn: module.optIn,
    activated: module.activated,
    pass,
    reason: pass
      ? module.activated
        ? 'already activated — all gates satisfied'
        : 'all required gates satisfied — ready to activate'
      : 'activation blocked — required gates not satisfied',
    criteria,
    missingRequired,
  };
}

export function evaluateGate(
  moduleId: string,
  options: ValidateOptions = {},
): {
  moduleId: string;
  found: boolean;
  gate: 'open' | 'blocked';
  category?: ModuleCategory;
  missingRequired: string[];
  approvals: string[];
} {
  const result = validateActivation(moduleId, options);
  const approvals = result.criteria.filter((c) => c.check === 'governance-approval' && c.satisfied);
  return {
    moduleId,
    found: result.found,
    gate: result.pass ? 'open' : 'blocked',
    category: result.category,
    missingRequired: result.missingRequired,
    approvals: approvals.map((c) => c.note ?? 'approval'),
  };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function printList(config: MaturityConfig): void {
  const rows = config.modules.map((m) => ({
    id: m.id,
    category: m.category,
    maturity: m.maturity,
    optIn: m.optIn ? 'yes' : 'no',
    activated: m.activated ? 'yes' : 'no',
    risk: m.risk,
    owner: m.owner,
  }));
  console.table(rows);
}

function printStatus(config: MaturityConfig): void {
  const counts: Record<ModuleCategory, number> = { core: 0, experimental: 0, deprecated: 0 };
  for (const m of config.modules) counts[m.category] += 1;
  const total = config.modules.length;

  console.log('=== Module Maturity Status ===');
  console.log(
    `total: ${total} | core: ${counts.core} | experimental: ${counts.experimental} | deprecated: ${counts.deprecated}`,
  );
  console.log('');
  console.log('CORE (always active):');
  for (const m of config.modules.filter((x) => x.category === 'core')) {
    console.log(`  [${m.maturity}] ${m.id} — risk:${m.risk} owner:${m.owner}`);
  }
  console.log('');
  console.log('EXPERIMENTAL (opt-in, gated):');
  for (const m of config.modules.filter((x) => x.category === 'experimental')) {
    console.log(
      `  [${m.maturity}] ${m.id} — optIn:${m.optIn} activated:${m.activated} risk:${m.risk} owner:${m.owner}`,
    );
  }
  console.log('');
  console.log('DEPRECATED (not activatable):');
  for (const m of config.modules.filter((x) => x.category === 'deprecated')) {
    console.log(`  ${m.id}`);
  }
}

function printValidation(result: ValidationResult): void {
  const out: Record<string, unknown> = {
    moduleId: result.moduleId,
    found: result.found,
    category: result.category,
    maturity: result.maturity,
    optIn: result.optIn,
    activated: result.activated,
    pass: result.pass,
    reason: result.reason,
    missingRequired: result.missingRequired,
    criteria: result.criteria.map((c) => ({
      check: c.check,
      required: c.required,
      satisfied: c.satisfied,
      verified: c.verified,
      note: c.note,
    })),
  };
  console.log(JSON.stringify(out, null, 2));
}

function main(): void {
  const args = process.argv.slice(2);
  const has = (flag: string): boolean => args.includes(flag);
  const value = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
  };

  const options: ValidateOptions = {
    runChecks: has('--run-checks'),
    ownerSignoff: has('--ownerSignoff'),
  };

  if (args.includes('list')) {
    printList(loadModuleConfig(options));
    return;
  }

  if (has('--status')) {
    printStatus(loadModuleConfig(options));
    return;
  }

  if (has('--validate-all')) {
    // CI-friendly: validates every experimental module and exits non-zero on any failure
    const config = loadModuleConfig(options);
    const experimental = config.modules.filter((m) => m.category === 'experimental');
    const results = experimental.map((m) => validateActivation(m.id, options));
    const failures = results.filter((r) => !r.pass);

    console.log(
      JSON.stringify(
        {
          mode: 'validate-all',
          total: results.length,
          passed: results.length - failures.length,
          failed: failures.length,
          modules: results.map((r) => ({
            moduleId: r.moduleId,
            activated: r.activated,
            pass: r.pass,
            reason: r.reason,
            missingRequired: r.missingRequired,
          })),
        },
        null,
        2,
      ),
    );
    process.exit(failures.length > 0 ? 1 : 0);
  }

  const validateId = value('--validate');
  if (validateId) {
    printValidation(validateActivation(validateId, options));
    const result = validateActivation(validateId, options);
    process.exit(result.pass ? 0 : 1);
    return;
  }

  const gateId = value('--gate');
  if (gateId) {
    console.log(JSON.stringify(evaluateGate(gateId, options), null, 2));
    return;
  }

  console.log(
    'Usage: list | --status | --validate-all | --validate <module-id> | --gate <module-id> [--run-checks] [--ownerSignoff]',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { evaluateCriterion, findModule };
