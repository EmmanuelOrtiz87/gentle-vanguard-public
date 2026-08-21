#!/usr/bin/env node
/**
 * Skill Recommender — Recommends best skills for a task using workspace
 * context, task description, and git branch hints via ML router.
 *
 * Migrated from: scripts/utilities/agents/AUTO-DELEGATION/skill-recommender.ps1
 */

import { existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runSync, runNpxTsxSync } from '../core/run-command.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface Args {
  Context?: string;
  TaskDescription?: string;
  TopN?: number;
  Raw?: boolean;
  Proactive?: boolean;
}

interface SkillRecommendation {
  skill: string;
  agent: string;
  score: number;
  confidence: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-Context' && argv[i + 1]) args.Context = argv[++i];
    else if (arg === '-TaskDescription' && argv[i + 1]) args.TaskDescription = argv[++i];
    else if (arg === '-TopN' && argv[i + 1]) args.TopN = Number(argv[++i]);
    else if (arg === '-Raw') args.Raw = true;
    else if (arg === '-Proactive') args.Proactive = true;
  }
  return args;
}

function resolveProjectRoot(): string {
  let dir = join(__dirname, '..');
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(process.cwd());
}

const PROJECT_ROOT = resolveProjectRoot();
const ROUTER_PATH = join(PROJECT_ROOT, 'src', 'ml-router.ts');

function getWorkspaceContext(): string {
  const analyzerPath = join(resolveProjectRoot(), 'src', 'context-analyzer.ts');
  if (!existsSync(analyzerPath)) return '';
  try {
    const result = runNpxTsxSync(analyzerPath, ['--raw'], {
      timeout: 15000,
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).stdout.trim();
    if (result) {
      const parsed = JSON.parse(result);
      if (parsed?.contextText) return parsed.contextText;
    }
  } catch {
    /* ignore */
  }
  return '';
}

function invokeSkillRecommendation(queryText: string, topN: number): SkillRecommendation[] {
  if (!existsSync(ROUTER_PATH)) {
    console.error(`[AUTO-DELEGATION] ML router not found at ${ROUTER_PATH}`);
    return [];
  }
  try {
    const raw = runNpxTsxSync(
      'src/ml-router.ts',
      ['--query', queryText, '--topn', String(topN * 2), '--raw'],
      {
        cwd: PROJECT_ROOT,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    ).stdout.trim();
    if (!raw) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.filter(
      (r): r is SkillRecommendation =>
        r !== null && typeof r === 'object' && 'skill' in r && 'score' in r,
    );
  } catch {
    return [];
  }
}

function getBranchSkillHint(branch: string): string {
  if (!branch) return '';
  const lower = branch.toLowerCase();
  const hints: string[] = [];
  if (/feature/.test(lower)) hints.push('new feature development');
  if (/bug|fix|hotfix/.test(lower)) hints.push('bug fixing debugging');
  if (/release/.test(lower)) hints.push('release management deployment');
  if (/docs?|readme/.test(lower)) hints.push('documentation writing');
  if (/refactor/.test(lower)) hints.push('refactoring code quality');
  if (/test/.test(lower)) hints.push('testing quality assurance');
  if (/sec|security/.test(lower)) hints.push('security audit review');
  if (/deps?|update/.test(lower)) hints.push('dependency update maintenance');
  return hints.join(' ');
}

function getGitBranch(): string | null {
  try {
    return runSync('git', ['-C', PROJECT_ROOT, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    }).stdout.trim();
  } catch {
    return null;
  }
}

function main() {
  const args = parseArgs(process.argv);
  const topN = args.TopN ?? 5;

  const queryParts: string[] = [];

  let context = args.Context ?? '';
  if (!context) context = getWorkspaceContext();
  if (context) queryParts.push(context);

  if (args.TaskDescription) queryParts.push(args.TaskDescription);

  if (args.Proactive || !args.TaskDescription) {
    const branch = getGitBranch();
    if (branch) {
      const hint = getBranchSkillHint(branch);
      if (hint) queryParts.push(hint);
    }
  }

  if (queryParts.length === 0) {
    console.log('[AUTO-DELEGATION] No context available for skill recommendation');
    process.exit(0);
  }

  const combinedQuery = queryParts.filter(Boolean).join(' ');
  const recommendations = invokeSkillRecommendation(combinedQuery, topN);
  const top = recommendations.slice(0, topN);

  if (args.Raw) {
    console.log(JSON.stringify(top, null, 2));
    process.exit(0);
  }

  console.log('\x1b[36m=== Skill Recommendations ===\x1b[0m');
  if (args.Proactive) console.log('\x1b[35m[Proactive Mode]\x1b[0m');
  const truncated = combinedQuery.substring(0, Math.min(80, combinedQuery.length));
  console.log(`\x1b[90mQuery: '${truncated}...'\x1b[0m`);
  console.log('-'.repeat(70));

  if (top.length === 0) {
    console.log('\x1b[33mNo relevant skills found for current context.\x1b[0m');
    process.exit(0);
  }

  console.log(
    `${'Rank'.padEnd(5)} ${'Skill'.padEnd(32)} ${'Agent'.padEnd(8)} ${'Score'.padEnd(8)} ${'Confidence'.padEnd(10)}`,
  );
  console.log('-'.repeat(70));

  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    const scorePct = r.score ? Math.round(r.score * 100) : 0;
    const color = scorePct >= 80 ? '\x1b[32m' : scorePct >= 60 ? '\x1b[33m' : '\x1b[33m';
    const reset = '\x1b[0m';
    const conf = r.confidence ?? 'low';
    console.log(
      `${color}${String(i + 1).padEnd(5)} ${(r.skill ?? '').padEnd(32)} ${(r.agent ?? '').padEnd(8)} ${String(scorePct + '%').padEnd(8)} ${conf.padEnd(10)}${reset}`,
    );
  }

  console.log('\x1b[90m' + '-'.repeat(70) + '\x1b[0m');
  process.exit(0);
}

main();
