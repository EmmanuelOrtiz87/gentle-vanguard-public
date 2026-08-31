#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

interface Mutation {
  strategy?: string;
  changes?: string[];
  target?: string;
  [key: string]: unknown;
}

interface Violation {
  rule: string;
  type: string;
  severity: string;
  current?: number;
}

interface GuardrailResult {
  allowed: boolean;
  timestamp: string;
  agentId: string;
  violations: Violation[];
  violationCount: number;
  blockedBy: string | null;
}

interface BlockedPattern {
  pattern: string;
  severity: string;
}

interface ResourceLimits {
  maxFilesPerMutation: number;
  maxTokensPerPrompt: number;
  maxNetworkCallsPerMutation: number;
}

interface GuardrailsConfig {
  constitutional: string[];
  blockedPatterns: BlockedPattern[];
  resourceLimits: ResourceLimits;
}

interface GlobalConfig {
  enabled: boolean;
  blockOnViolation: boolean;
  alertOnBlock: boolean;
  requireHumanApproval: boolean;
  auditLevel: string;
}

interface SafetyConfig {
  global: GlobalConfig;
  guardrails: GuardrailsConfig;
  [key: string]: unknown;
}

function getRepoRoot(): string {
  if (process.env.GENTLE_VANGUARD_BASE_DIR) return process.env.GENTLE_VANGUARD_BASE_DIR;
  const __filename = fileURLToPath(import.meta.url);
  let root = path.dirname(path.dirname(__filename));
  while (root && !fs.existsSync(path.join(root, 'config', 'orchestrator.json'))) {
    const parent = path.dirname(root);
    if (parent === root) break;
    root = parent;
  }
  if (!fs.existsSync(path.join(root, 'config', 'orchestrator.json'))) root = process.cwd();
  return root;
}

function loadConfig(root: string): SafetyConfig {
  const configPath = path.join(root, 'config', 'safety-layer.json');
  if (!fs.existsSync(configPath)) {
    console.error('[SAFETY] safety-layer.json not found');
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

function ensureAuditDir(root: string): string {
  const dir = path.join(root, '.session', 'safety', 'audit');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function testConstitutionalRules(mutation: Mutation, config: SafetyConfig): Violation[] {
  const violations: Violation[] = [];
  const mutationStr = JSON.stringify(mutation);
  for (const rule of config.guardrails.constitutional) {
    const fragment = rule.toLowerCase().substring(0, Math.min(30, rule.length));
    if (mutationStr.toLowerCase().includes(fragment)) {
      violations.push({ rule, type: 'constitutional', severity: 'critical' });
    }
  }
  return violations;
}

function testBlockedPatterns(mutation: Mutation, config: SafetyConfig): Violation[] {
  const violations: Violation[] = [];
  const mutationStr = JSON.stringify(mutation);
  for (const bp of config.guardrails.blockedPatterns) {
    try {
      if (new RegExp(bp.pattern, 'i').test(mutationStr)) {
        violations.push({ rule: bp.pattern, type: 'blocked-pattern', severity: bp.severity });
      }
    } catch {
      // skip invalid regex
    }
  }
  return violations;
}

function testResourceLimits(mutation: Mutation, config: SafetyConfig): Violation[] {
  const violations: Violation[] = [];
  if (
    mutation.changes &&
    mutation.changes.length > config.guardrails.resourceLimits.maxFilesPerMutation
  ) {
    violations.push({
      rule: `maxFilesPerMutation (${config.guardrails.resourceLimits.maxFilesPerMutation})`,
      type: 'resource-limit',
      severity: 'warning',
      current: mutation.changes.length,
    });
  }
  return violations;
}

function doValidate(
  agentId: string,
  proposedMutation: string,
  config: SafetyConfig,
  auditDir: string,
): GuardrailResult {
  if (!agentId) {
    console.error('[SAFETY] Provide --agentId');
    throw new Error('Validation failed');
  }
  if (!proposedMutation) {
    console.error('[SAFETY] Provide --mutation as JSON');
    throw new Error('Validation failed');
  }

  let mutation: Mutation;
  try {
    mutation = JSON.parse(proposedMutation);
  } catch {
    console.error('[SAFETY] Invalid JSON in --mutation');
    process.exit(1);
    return undefined as never;
  }

  const constitutionalViolations = testConstitutionalRules(mutation, config);
  const patternViolations = testBlockedPatterns(mutation, config);
  const resourceViolations = testResourceLimits(mutation, config);
  const allViolations = [...constitutionalViolations, ...patternViolations, ...resourceViolations];

  const hasCritical = allViolations.some((v) => v.severity === 'critical');
  const hasHigh = allViolations.some((v) => v.severity === 'high');
  const allowed = !hasCritical && !(hasHigh && config.global.blockOnViolation);

  const result: GuardrailResult = {
    allowed,
    timestamp: new Date().toISOString(),
    agentId,
    violations: allViolations,
    violationCount: allViolations.length,
    blockedBy: !allowed ? (hasCritical ? 'constitutional' : 'blocked-pattern') : null,
  };

  console.log(`\x1b[36m[SAFETY] Guardrails check for ${agentId}:\x1b[0m`);
  if (allowed) {
    console.log(`\x1b[32m[SAFETY] ALLOWED — no violations\x1b[0m`);
  } else {
    console.log(`\x1b[31m[SAFETY] BLOCKED — ${allViolations.length} violation(s)\x1b[0m`);
    for (const v of allViolations) {
      const color =
        v.severity === 'critical' ? '\x1b[31m' : v.severity === 'high' ? '\x1b[33m' : '\x1b[90m';
      console.log(`  ${color}[${v.severity}] ${v.type}: ${v.rule}\x1b[0m`);
    }
  }

  const logFile = path.join(
    auditDir,
    `guardrail-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  fs.writeFileSync(logFile, JSON.stringify(result, null, 2), 'utf-8');

  return result;
}

function doStatus(config: SafetyConfig, auditDir: string): void {
  const enabled = config.global.enabled;
  console.log(`\x1b[36m[SAFETY] Guardrails status:\x1b[0m`);
  console.log(`  Enabled: ${enabled ? '\x1b[32m' : '\x1b[31m'}${enabled}\x1b[0m`);
  console.log(`  \x1b[90mConstitutional rules: ${config.guardrails.constitutional.length}\x1b[0m`);
  console.log(`  \x1b[90mBlocked patterns: ${config.guardrails.blockedPatterns.length}\x1b[0m`);
  console.log(`  \x1b[90mBlock on violation: ${config.global.blockOnViolation}\x1b[0m`);
  console.log(`  \x1b[90mAudit log: ${auditDir}\x1b[0m`);

  if (fs.existsSync(auditDir)) {
    const logs = fs
      .readdirSync(auditDir)
      .filter((f) => f.startsWith('guardrail-') && f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 5);
    if (logs.length > 0) {
      console.log(`  \x1b[90mRecent validations:\x1b[0m`);
      for (const log of logs) {
        const data: GuardrailResult = JSON.parse(
          fs.readFileSync(path.join(auditDir, log), 'utf-8'),
        );
        const color = data.allowed ? '\x1b[32m' : '\x1b[31m';
        console.log(
          `    ${color}${data.timestamp} | ${data.agentId} | ${data.allowed ? 'ALLOWED' : 'BLOCKED'} (${data.violationCount} violations)\x1b[0m`,
        );
      }
    }
  }
}

function doRules(config: SafetyConfig): void {
  console.log(`\x1b[36m[SAFETY] Constitutional rules:\x1b[0m`);
  for (const rule of config.guardrails.constitutional) {
    console.log(`  \x1b[37m• ${rule}\x1b[0m`);
  }
  console.log(`\x1b[36m[SAFETY] Blocked patterns:\x1b[0m`);
  for (const bp of config.guardrails.blockedPatterns) {
    const color =
      bp.severity === 'critical' ? '\x1b[31m' : bp.severity === 'high' ? '\x1b[33m' : '\x1b[90m';
    console.log(`  ${color}[${bp.severity}] ${bp.pattern}\x1b[0m`);
  }
  console.log(`\x1b[36m[SAFETY] Resource limits:\x1b[0m`);
  console.log(
    `  \x1b[90mMax files per mutation: ${config.guardrails.resourceLimits.maxFilesPerMutation}\x1b[0m`,
  );
  console.log(
    `  \x1b[90mMax tokens per prompt: ${config.guardrails.resourceLimits.maxTokensPerPrompt}\x1b[0m`,
  );
  console.log(
    `  \x1b[90mMax network calls: ${config.guardrails.resourceLimits.maxNetworkCallsPerMutation}\x1b[0m`,
  );
}

function printUsage(): void {
  console.log(`Usage:
  npx tsx src/security/safety-guardrails.ts --action <validate|status|rules> [--agentId <id>] [--mutation <json>]`);
}

function parseArgs(): { action: string; agentId: string; mutation: string } {
  const args = process.argv.slice(2);
  let action = 'status';
  let agentId = '';
  let mutation = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--action' && i + 1 < args.length) action = args[++i];
    else if (args[i] === '--agentId' && i + 1 < args.length) agentId = args[++i];
    else if (args[i] === '--mutation' && i + 1 < args.length) mutation = args[++i];
  }
  return { action, agentId, mutation };
}

function main(): void {
  const { action, agentId, mutation } = parseArgs();
  const root = getRepoRoot();
  const config = loadConfig(root);
  const auditDir = ensureAuditDir(root);

  switch (action) {
    case 'validate':
      doValidate(agentId, mutation, config, auditDir);
      break;
    case 'status':
      doStatus(config, auditDir);
      break;
    case 'rules':
      doRules(config);
      break;
    default:
      console.error(`[SAFETY] Unknown action: ${action}`);
      printUsage();
  }
}

if (
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('safety-guardrails.ts'))
) {
  main();
}
