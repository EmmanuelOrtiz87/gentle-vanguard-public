#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

interface MutationData {
  strategy?: string;
  target?: string;
  changeCount?: number;
  [key: string]: unknown;
}

interface SignalScores {
  scopeImpact: number;
  capabilityDrift: number;
  patternViolations: number;
  historicalRisk: number;
  similarityToBad: number;
}

interface ScorerResult {
  agentId: string;
  timestamp: string;
  score: number;
  riskLevel: string;
  signals: SignalScores;
  config: {
    minAutoApprove: number;
    minAutoEscalate: number;
  };
}

interface BlockedPattern {
  pattern: string;
  severity: string;
}

interface ScoringSignals {
  scopeImpactWeight: number;
  capabilityDriftWeight: number;
  patternViolationsWeight: number;
  historicalRiskWeight: number;
  similarityToBadWeight: number;
}

interface ScoringConfig {
  minAutoApproveScore: number;
  minAutoEscalateScore: number;
  signals: ScoringSignals;
}

interface GuardrailsConfig {
  blockedPatterns: BlockedPattern[];
  [key: string]: unknown;
}

interface SafetyConfig {
  scoring: ScoringConfig;
  guardrails: GuardrailsConfig;
  [key: string]: unknown;
}

interface MutationHistoryEntry {
  status?: string;
  scoreBefore?: number;
  scoreAfter?: number;
  strategy?: string;
  target?: string;
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
    console.error('[SAFETY-SCORER] safety-layer.json not found');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

function ensureAuditDir(root: string): string {
  const dir = path.join(root, '.session', 'safety', 'audit');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getScopeImpact(mutationData: MutationData): number {
  const changeCount = mutationData.changeCount ?? 1;
  if (changeCount <= 3) return 0.9;
  if (changeCount <= 10) return 0.5;
  return 0.2;
}

function getCapabilityDrift(mutationData: MutationData): number {
  const driftTargets = [
    'file-system',
    'network',
    'database',
    'security',
    'auth',
    'admin',
    'sudo',
    'root',
    'system',
    'kernel',
    'exec',
    'shell',
  ];
  const target = (mutationData.target ?? '').toLowerCase();
  for (const dt of driftTargets) {
    if (target.includes(dt)) return 0.3;
  }
  return 0.9;
}

function getPatternViolationScore(mutationData: MutationData, config: SafetyConfig): number {
  const mutationStr = JSON.stringify(mutationData);
  let violations = 0;
  for (const bp of config.guardrails.blockedPatterns) {
    try {
      if (new RegExp(bp.pattern, 'i').test(mutationStr)) violations++;
    } catch {
      // skip invalid regex
    }
  }
  if (violations === 0) return 1.0;
  return Math.max(0.0, 1.0 - violations * 0.3);
}

function getHistoricalRisk(agent: string, root: string): number {
  const agentDir = path.join(root, '.session', 'evolution', agent);
  if (!fs.existsSync(agentDir)) return 0.9;

  let entries: string[];
  try {
    entries = fs.readdirSync(agentDir).filter((f) => f.endsWith('.json'));
  } catch {
    return 0.9;
  }
  if (entries.length === 0) return 0.9;

  let rollbacks = 0;
  let total = 0;
  for (const entry of entries) {
    try {
      const data: MutationHistoryEntry = JSON.parse(
        fs.readFileSync(path.join(agentDir, entry), 'utf-8'),
      );
      total++;
      if (
        data.status === 'rolled-back' ||
        (data.scoreBefore !== null &&
          data.scoreBefore !== undefined &&
          data.scoreAfter !== null &&
          data.scoreAfter !== undefined &&
          data.scoreAfter < data.scoreBefore)
      ) {
        rollbacks++;
      }
    } catch {
      // skip unparseable entries
    }
  }

  if (total === 0) return 0.9;
  const failureRate = rollbacks / total;
  return Math.max(0.1, 1.0 - failureRate);
}

function getSimilarityToBadMutations(mutationData: MutationData, root: string): number {
  const badDir = path.join(root, '.session', 'safety', 'audit', 'blocked');
  if (!fs.existsSync(badDir)) return 0.9;

  const strategy = (mutationData.strategy ?? '').toLowerCase();
  const target = (mutationData.target ?? '').toLowerCase();

  let logs: string[];
  try {
    logs = fs.readdirSync(badDir).filter((f) => f.endsWith('.json'));
  } catch {
    return 0.9;
  }

  let similarCount = 0;
  for (const log of logs) {
    try {
      const data: MutationHistoryEntry = JSON.parse(
        fs.readFileSync(path.join(badDir, log), 'utf-8'),
      );
      const dataStrategy = (data.strategy ?? '').toLowerCase();
      const dataTarget = (data.target ?? '').toLowerCase();
      if (dataStrategy === strategy && dataTarget === target) {
        similarCount++;
      }
    } catch {
      // skip unparseable entries
    }
  }

  if (similarCount === 0) return 0.9;
  return Math.max(0.1, 1.0 - similarCount * 0.2);
}

function doScore(
  agentId: string,
  mutationJson: string,
  config: SafetyConfig,
  root: string,
  auditDir: string,
): ScorerResult {
  if (!agentId) {
    console.error('[SAFETY-SCORER] Provide --agentId');
    process.exit(1);
  }
  if (!mutationJson) {
    console.error('[SAFETY-SCORER] Provide --mutation as JSON');
    process.exit(1);
  }

  let mutationData: MutationData;
  try {
    mutationData = JSON.parse(mutationJson);
  } catch {
    console.error('[SAFETY-SCORER] Invalid JSON in --mutation');
    process.exit(1);
    return undefined as never;
  }

  const weights = config.scoring.signals;

  const scopeImpact = getScopeImpact(mutationData);
  const capabilityDrift = getCapabilityDrift(mutationData);
  const patternViolations = getPatternViolationScore(mutationData, config);
  const historicalRisk = getHistoricalRisk(agentId, root);
  const similarityToBad = getSimilarityToBadMutations(mutationData, root);

  const signals: SignalScores = {
    scopeImpact: Math.round(scopeImpact * 1000) / 1000,
    capabilityDrift: Math.round(capabilityDrift * 1000) / 1000,
    patternViolations: Math.round(patternViolations * 1000) / 1000,
    historicalRisk: Math.round(historicalRisk * 1000) / 1000,
    similarityToBad: Math.round(similarityToBad * 1000) / 1000,
  };

  const rawScore =
    scopeImpact * weights.scopeImpactWeight +
    capabilityDrift * weights.capabilityDriftWeight +
    patternViolations * weights.patternViolationsWeight +
    historicalRisk * weights.historicalRiskWeight +
    similarityToBad * weights.similarityToBadWeight;

  const score = Math.round(Math.max(0.0, Math.min(1.0, rawScore)) * 1000) / 1000;

  const riskLevel =
    score >= config.scoring.minAutoApproveScore
      ? 'low'
      : score >= config.scoring.minAutoEscalateScore
        ? 'medium'
        : 'high';

  console.log(`\x1b[36m[SAFETY-SCORER] Mutation safety score for ${agentId}:\x1b[0m`);
  const riskColor =
    riskLevel === 'low' ? '\x1b[32m' : riskLevel === 'medium' ? '\x1b[33m' : '\x1b[31m';
  console.log(`  Overall score: ${riskColor}${score} (risk: ${riskLevel})\x1b[0m`);
  console.log(`  \x1b[90mSignals:\x1b[0m`);
  for (const [key, val] of Object.entries(signals)) {
    console.log(`    \x1b[90m${key}: ${val}\x1b[0m`);
  }

  const result: ScorerResult = {
    agentId,
    timestamp: new Date().toISOString(),
    score,
    riskLevel,
    signals,
    config: {
      minAutoApprove: config.scoring.minAutoApproveScore,
      minAutoEscalate: config.scoring.minAutoEscalateScore,
    },
  };

  const logFile = path.join(
    auditDir,
    `scorer-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  fs.writeFileSync(logFile, JSON.stringify(result, null, 2), 'utf-8');

  return result;
}

function doConfig(config: SafetyConfig): void {
  console.log(`\x1b[36m[SAFETY-SCORER] Scoring configuration:\x1b[0m`);
  console.log(`  \x1b[32mMin auto-approve score: ${config.scoring.minAutoApproveScore}\x1b[0m`);
  console.log(`  \x1b[33mMin auto-escalate score: ${config.scoring.minAutoEscalateScore}\x1b[0m`);
  console.log(`  \x1b[90mSignal weights:\x1b[0m`);
  for (const [key, val] of Object.entries(config.scoring.signals)) {
    console.log(`    \x1b[90m${key}: ${val}\x1b[0m`);
  }
}

function printUsage(): void {
  console.log(`Usage:
  npx tsx src/review/mutation-safety-scorer.ts --action <score|config> [--agentId <id>] [--mutation <json>]`);
}

function parseArgs(): { action: string; agentId: string; mutation: string } {
  const args = process.argv.slice(2);
  let action = 'config';
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
    case 'score':
      doScore(agentId, mutation, config, root, auditDir);
      break;
    case 'config':
      doConfig(config);
      break;
    default:
      console.error(`[SAFETY-SCORER] Unknown action: ${action}`);
      printUsage();
      process.exit(1);
  }
}

if (
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('mutation-safety-scorer.ts'))
) {
  main();
}
