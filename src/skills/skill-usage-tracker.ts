#!/usr/bin/env node
/**
 * Skill usage tracker — tracks skill usage, failures, and metrics.
 * TS migration of scripts/skills/usage-tracker.ps1
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { DatabaseManager } from '../database/nexus/manager.js';
import type { SkillEvidenceKind } from '../database/nexus/repositories/SkillRepo.js';
import { parseSkillRegistry } from './skill-registry-parser.js';

// Minimal shape of the DatabaseManager used for lazy SQLite dual-write.
interface SkillUsageDbManager {
  recordSkillUsage: (
    skillName: string,
    sessionId: string | undefined,
    tokenCount: number,
  ) => unknown;
  recordSkillOutcome: (
    skillName: string,
    success: boolean,
    options?: { detail?: string; evidenceKind?: SkillEvidenceKind },
  ) => unknown;
}

let _db: SkillUsageDbManager | null = null;
function getDb(): SkillUsageDbManager | null {
  if (!_db) {
    try {
      _db = DatabaseManager.getInstance();
    } catch {
      // SQLite not available — skip dual-write
    }
  }
  return _db;
}

/**
 * DI injection point (STACK-EVOLUTION-PLAN F2.6 batch 2).
 * Container-injected db handle takes precedence over the lazy require().
 */
export function setSkillUsageDb(handle: SkillUsageDbManager | null): void {
  _db = handle;
}

interface SkillMetric {
  skillName: string;
  useCount: number;
  lastUsedAt: string | null;
  failureCount: number;
  failurePatterns: Array<{
    timestamp: string;
    errorType: string;
    description: string;
    fixApplied: string | null;
  }>;
  avgTokensUsed: number;
  successRate: number;
  lastOutcome: string | null;
}

const ROOT = resolve(process.cwd());

function findRepoRoot(dir: string): string {
  let current = resolve(dir);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return dir;
}

const repoRoot =
  process.env.GENTLE_VANGUARD_BASE_DIR && existsSync(process.env.GENTLE_VANGUARD_BASE_DIR)
    ? process.env.GENTLE_VANGUARD_BASE_DIR
    : findRepoRoot(ROOT);
const usageDir = join(repoRoot, '.session', 'skill-usage');
const nudgeDir = join(repoRoot, '.session', 'skill-nudges');

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function getInitialMetric(name: string): SkillMetric {
  return {
    skillName: name,
    useCount: 0,
    lastUsedAt: null,
    failureCount: 0,
    failurePatterns: [],
    avgTokensUsed: 0,
    successRate: 1.0,
    lastOutcome: null,
  };
}

function getSkillList(): string[] {
  const registry = join(repoRoot, '.atl', 'skill-registry.md');
  if (!existsSync(registry)) return [];
  return parseSkillRegistry(readFileSync(registry, 'utf-8'));
}

function readMetric(name: string): SkillMetric | null {
  const path = join(usageDir, `${name}.json`);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      console.warn(`Corrupt metric for ${name}, reinitializing`);
    }
  }
  return null;
}

function saveMetric(name: string, metric: SkillMetric): void {
  writeFileSync(join(usageDir, `${name}.json`), JSON.stringify(metric, null, 2), 'utf-8');
}

export function parseExplicitOutcome(outcome: string | null): boolean | null {
  if (!outcome) return null;
  const normalized = outcome.trim().toLowerCase();
  if (['success', 'succeeded', 'completed', 'pass', 'passed'].includes(normalized)) return true;
  if (['failure', 'failed', 'error', 'fail'].includes(normalized)) return false;
  return null;
}

function writeOutcome(
  name: string,
  outcome: string | null,
  detail?: string,
  evidenceKind: SkillEvidenceKind = 'production',
): void {
  const success = parseExplicitOutcome(outcome);
  if (success === null) return;
  try {
    getDb()?.recordSkillOutcome(name, success, {
      detail: detail ?? outcome ?? undefined,
      evidenceKind,
    });
  } catch {
    /* Nexus outcome recording is best-effort; file metrics remain available. */
  }
}

function increment(
  name: string,
  outcome: string | null,
  tokenCount: number,
  evidenceKind: SkillEvidenceKind,
): void {
  const metric = readMetric(name) || getInitialMetric(name);
  metric.useCount++;
  metric.lastUsedAt = new Date().toISOString();
  if (outcome) metric.lastOutcome = outcome;
  if (tokenCount > 0)
    metric.avgTokensUsed =
      Math.round(
        ((metric.avgTokensUsed * (metric.useCount - 1) + tokenCount) / metric.useCount) * 10,
      ) / 10;
  saveMetric(name, metric);
  console.log(`[OK] ${name} incremented (uses: ${metric.useCount})`);
  // SQLite dual-write
  try {
    const mgr = getDb();
    if (mgr) mgr.recordSkillUsage(name, undefined, tokenCount);
  } catch {
    /* */
  }
  writeOutcome(name, outcome, undefined, evidenceKind);
}

function recordFailure(
  name: string,
  errorType: string,
  description: string,
  evidenceKind: SkillEvidenceKind,
): void {
  const metric = readMetric(name) || getInitialMetric(name);
  metric.useCount++;
  metric.failureCount++;
  metric.lastUsedAt = new Date().toISOString();
  metric.lastOutcome = 'failure';
  metric.successRate =
    Math.round((1.0 - metric.failureCount / Math.max(metric.useCount, 1)) * 100) / 100;
  if (errorType && description)
    metric.failurePatterns.push({
      timestamp: new Date().toISOString(),
      errorType,
      description,
      fixApplied: null,
    });
  saveMetric(name, metric);
  console.log(`[WARN] ${name} failed (failures: ${metric.failureCount})`);
  if (metric.failureCount % 3 === 0)
    console.log(`[NUDGE] ${name} has ${metric.failureCount} failures — consider checking skill`);

  // Also check nudge conditions
  checkNudgeConditions();
  // SQLite dual-write
  try {
    const mgr = getDb();
    if (mgr) mgr.recordSkillUsage(name, undefined, 0);
  } catch {
    /* */
  }
  writeOutcome(name, 'failure', `${errorType}: ${description}`, evidenceKind);
}

function record(
  name: string,
  outcome: string | null,
  tokenCount: number,
  evidenceKind: SkillEvidenceKind,
): void {
  const metric = readMetric(name) || getInitialMetric(name);
  metric.lastUsedAt = new Date().toISOString();
  if (outcome) metric.lastOutcome = outcome;
  if (tokenCount > 0) {
    metric.useCount++;
    metric.avgTokensUsed =
      Math.round(
        ((metric.avgTokensUsed * (metric.useCount - 1) + tokenCount) / metric.useCount) * 10,
      ) / 10;
  }
  saveMetric(name, metric);
  console.log(`[OK] ${name} recorded`);
  // SQLite dual-write
  try {
    const mgr = getDb();
    if (mgr) mgr.recordSkillUsage(name, undefined, tokenCount);
  } catch {
    /* */
  }
  writeOutcome(name, outcome, undefined, evidenceKind);
}

function scan(): void {
  ensureDir(usageDir);
  const skills = getSkillList();
  let created = 0;
  for (const s of skills) {
    if (!readMetric(s)) {
      saveMetric(s, getInitialMetric(s));
      created++;
    }
  }
  console.log(`[OK] Scanned ${skills.length} skills, created ${created} new metric files`);
}

function checkNudgeConditions(): void {
  ensureDir(usageDir);
  const files = readdirSync(usageDir).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    try {
      const m: SkillMetric = JSON.parse(readFileSync(join(usageDir, f), 'utf-8'));
      if (m.failureCount >= 3)
        console.log(`[NUDGE] ${m.skillName}: ${m.failureCount} failures, rate ${m.successRate}`);
      if (m.useCount >= 10 && m.successRate < 0.7)
        console.log(
          `[NUDGE] ${m.skillName}: Declining success rate (${m.successRate}) after ${m.useCount} uses`,
        );
    } catch {
      /* */
    }
  }
}

function showReport(): void {
  ensureDir(usageDir);
  const files = readdirSync(usageDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  if (files.length === 0) {
    console.log('[INFO] No usage data found. Run scan first.');
    return;
  }
  console.log(`\n=== Skill Usage Report ===`);
  console.log(
    `${'Skill'.padEnd(30)} ${'Uses'.padStart(8)} ${'Failures'.padStart(9)} ${'Rate'.padStart(10)} ${'Last'.padStart(8)}`,
  );
  console.log(
    `${'----'.padEnd(30)} ${'----'.padStart(8)} ${'--------'.padStart(9)} ${'----'.padStart(10)} ${'----'.padStart(8)}`,
  );
  for (const f of files) {
    try {
      const m: SkillMetric = JSON.parse(readFileSync(join(usageDir, f), 'utf-8'));
      const last = m.lastUsedAt ? m.lastUsedAt.slice(0, 10) : 'never';
      const rate = m.successRate !== null ? `${Math.round(m.successRate * 100)}%` : '-';
      console.log(
        `${m.skillName.padEnd(30)} ${String(m.useCount).padStart(8)} ${String(m.failureCount).padStart(9)} ${rate.padStart(10)} ${last.padStart(8)}`,
      );
    } catch {
      /* */
    }
  }
  console.log(`\nTotal files: ${files.length}`);
}

function main(): void {
  const args = process.argv.slice(2);
  const skillName = args.includes('--name') ? args[args.indexOf('--name') + 1] : '';
  const action = args.includes('--action') ? args[args.indexOf('--action') + 1] : '';
  const outcome = args.includes('--outcome') ? args[args.indexOf('--outcome') + 1] : '';
  const tokenCount = parseInt(
    args.includes('--tokens') ? args[args.indexOf('--tokens') + 1] : '0',
    10,
  );
  const errorType = args.includes('--error-type') ? args[args.indexOf('--error-type') + 1] : '';
  const description = args.includes('--description') ? args[args.indexOf('--description') + 1] : '';
  const requestedEvidenceKind = args.includes('--evidence-kind')
    ? args[args.indexOf('--evidence-kind') + 1]
    : 'production';
  if (!['production', 'evaluation', 'maintenance'].includes(requestedEvidenceKind)) {
    throw new Error(`Invalid --evidence-kind: ${requestedEvidenceKind}`);
  }
  const evidenceKind = requestedEvidenceKind as SkillEvidenceKind;
  const report = args.includes('--report');

  ensureDir(usageDir);
  ensureDir(nudgeDir);

  if (report) {
    showReport();
    return;
  }

  if (!skillName) {
    scan();
    return;
  }

  switch (action) {
    case 'increment':
      increment(skillName, outcome, tokenCount, evidenceKind);
      break;
    case 'fail':
      recordFailure(skillName, errorType, description, evidenceKind);
      break;
    case 'record':
      record(skillName, outcome, tokenCount, evidenceKind);
      break;
    default: {
      const metric = readMetric(skillName);
      if (!metric) {
        saveMetric(skillName, getInitialMetric(skillName));
        console.log(`[OK] Created initial metric for ${skillName}`);
      } else
        console.log(
          `[OK] ${skillName}: ${metric.useCount} uses, ${metric.failureCount} failures, rate ${metric.successRate}`,
        );
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
