#!/usr/bin/env node
/**
 * Planning Templates — Scaffold, store, and link pre-write planning documents.
 *
 * Implements the "Plans before it writes" (superpowers) discipline: generate structured
 * pre-write planning templates (feature / refactoring / bugfix), persist them under
 * `.session/sdd-pipeline/plans/`, and link them to todo tasks before implementation.
 *
 * Usage:
 *   npx tsx src/planning-templates.ts --template feature
 *   npx tsx src/planning-templates.ts --plan --type feature --name user-auth \
 *     --title "User Authentication" --problem "..." --out-of-scope "admin UI" \
 *     --constraints "Node 20, must not break OAuth"
 *   npx tsx src/planning-templates.ts --list
 *   npx tsx src/planning-templates.ts --show user-auth
 *   npx tsx src/planning-templates.ts --link user-auth T3
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

export type PlanType = 'feature' | 'refactor' | 'bugfix';

export interface PlanInput {
  type: PlanType;
  name: string;
  title: string;
  problem: string;
  inScope?: string[];
  outOfScope?: string[];
  constraints?: string[];
}

export interface PlanRecord extends PlanInput {
  createdAt: string;
  gates: Record<string, boolean>;
  linkedTasks: string[];
}

const GATES = ['G1 Scope', 'G2 Approach', 'G3 Risk', 'G4 Tasks', 'G5 Approval'] as const;

export function getPlanRoot(root: string = process.cwd()): string {
  return join(root, '.session', 'sdd-pipeline', 'plans');
}

function sanitizeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .toLowerCase();
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function listValues(values?: string[]): string {
  if (!values || values.length === 0) return '- _none_';
  return values.map((v) => `- ${v}`).join('\n');
}

export function renderPlanMarkdown(plan: PlanInput): string {
  const gates = GATES.map((g) => `- [ ] ${g} defined`).join('\n');
  return `# Plan: ${plan.title}

> Type: \`${plan.type}\` | Name: \`${plan.name}\`

## Scope Definition

**Problem:** ${plan.problem || '_to be defined_'}

**In scope:**
${listValues(plan.inScope)}

**Out of scope:**
${listValues(plan.outOfScope)}

**Constraints:**
${listValues(plan.constraints)}

## Approach Analysis

| # | Approach | Tradeoffs | Rationale |
| - | -------- | --------- | --------- |
| 1 | _to be analyzed_ | _complexity / maintainability / performance_ | _why chosen_ |
| 2 | _alternative_ | _..._ | _why rejected_ |

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
| ---- | ------ | ---------- | ---------- |
| _to be assessed_ | _H/M/L_ | _H/M/L_ | _mitigation_ |

**Dependencies / blockers:** _to be mapped_

**Rollback strategy:** _to be defined_

## Task Breakdown

| # | Task | Acceptance criteria | Depends on | Estimate |
| - | ---- | ------------------- | ---------- | -------- |
| 1 | _to be broken down_ | _AC bullet_ | — | _S/M/L_ |

## Decision Gates

${gates}
`;
}

export function createPlan(plan: PlanInput, root: string = process.cwd()): PlanRecord {
  const dir = getPlanRoot(root);
  ensureDir(dir);
  const record: PlanRecord = {
    ...plan,
    name: sanitizeName(plan.name),
    createdAt: new Date().toISOString(),
    gates: Object.fromEntries(GATES.map((g) => [g, false])),
    linkedTasks: [],
  };
  const mdPath = join(dir, `${record.name}.md`);
  writeFileSync(mdPath, renderPlanMarkdown(record), 'utf-8');
  writeFileSync(join(dir, `${record.name}.json`), JSON.stringify(record, null, 2), 'utf-8');
  return record;
}

export function listPlans(root: string = process.cwd()): string[] {
  const dir = getPlanRoot(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

export function loadPlan(name: string, root: string = process.cwd()): PlanRecord | null {
  const dir = getPlanRoot(root);
  const safe = sanitizeName(name);
  const jsonPath = join(dir, `${safe}.json`);
  if (!existsSync(jsonPath)) return null;
  try {
    return JSON.parse(readFileSync(jsonPath, 'utf-8')) as PlanRecord;
  } catch {
    return null;
  }
}

export function showPlan(name: string, root: string = process.cwd()): string | null {
  const dir = getPlanRoot(root);
  const safe = sanitizeName(name);
  const mdPath = join(dir, `${safe}.md`);
  if (!existsSync(mdPath)) return null;
  return readFileSync(mdPath, 'utf-8');
}

export function linkPlanTask(name: string, task: string, root: string = process.cwd()): boolean {
  const dir = getPlanRoot(root);
  const record = loadPlan(name, root);
  if (!record) return false;
  if (!record.linkedTasks.includes(task)) record.linkedTasks.push(task);
  writeFileSync(join(dir, `${record.name}.json`), JSON.stringify(record, null, 2), 'utf-8');
  return true;
}

export function planStats(root: string = process.cwd()): {
  count: number;
  dir: string;
  types: Record<string, number>;
} {
  const dir = getPlanRoot(root);
  const names = listPlans(root);
  const types: Record<string, number> = {};
  for (const n of names) {
    const rec = loadPlan(n, root);
    if (rec) types[rec.type] = (types[rec.type] ?? 0) + 1;
  }
  return { count: names.length, dir, types };
}

function printHelp(): void {
  console.log(`Planning Templates — pre-write planning scaffold

Usage:
  npx tsx src/planning-templates.ts --template <feature|refactor|bugfix>
  npx tsx src/planning-templates.ts --plan --type <type> --name <id> --title "<title>"
      [--problem "..."] [--in-scope "a;b"] [--out-of-scope "a;b"] [--constraints "a;b"]
  npx tsx src/planning-templates.ts --list [--json]
  npx tsx src/planning-templates.ts --show <name>
  npx tsx src/planning-templates.ts --link <name> <task>
  npx tsx src/planning-templates.ts --stats

Plans are stored in .session/sdd-pipeline/plans/`);
}

function splitList(value: string): string[] | undefined {
  return value
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(args.length === 0 ? 1 : 0);
  }

  if (args.includes('--template')) {
    const idx = args.indexOf('--template');
    const type = (args[idx + 1] ?? '') as PlanType;
    if (!['feature', 'refactor', 'bugfix'].includes(type)) {
      console.error('Invalid template type. Use feature | refactor | bugfix');
      process.exit(1);
    }
    console.log(
      renderPlanMarkdown({
        type,
        name: `${type}-example`,
        title: `[${type === 'feature' ? 'Feature' : type === 'refactor' ? 'Refactoring' : 'Bug Fix'} Name]`,
        problem: '',
      }),
    );
    return;
  }

  if (args.includes('--plan')) {
    const read = (flag: string): string => {
      const i = args.indexOf(flag);
      return i !== -1 && i + 1 < args.length ? (args[i + 1] ?? '') : '';
    };
    const type = (read('--type') || 'feature') as PlanType;
    const name = sanitizeName(read('--name') || `plan-${Date.now()}`);
    const title = read('--title') || name;
    const record = createPlan({
      type,
      name,
      title,
      problem: read('--problem'),
      inScope: read('--in-scope') ? splitList(read('--in-scope')) : undefined,
      outOfScope: read('--out-of-scope') ? splitList(read('--out-of-scope')) : undefined,
      constraints: read('--constraints') ? splitList(read('--constraints')) : undefined,
    });
    console.log(`[OK] Plan "${record.name}" (${record.type}) created`);
    console.log(`     ${join(getPlanRoot(), `${record.name}.md`)}`);
    console.log('     Run: npx tsx src/planning-templates.ts --show ' + record.name);
    return;
  }

  if (args.includes('--list')) {
    const names = listPlans();
    if (args.includes('--json')) {
      console.log(JSON.stringify(names, null, 2));
    } else {
      if (names.length === 0) console.log('No plans stored yet.');
      for (const n of names) console.log(`- ${n}`);
    }
    return;
  }

  if (args.includes('--show')) {
    const i = args.indexOf('--show');
    const name = args[i + 1] ?? '';
    const md = showPlan(name);
    if (!md) {
      console.error(`Plan not found: ${name}`);
      process.exit(1);
    }
    console.log(md);
    return;
  }

  if (args.includes('--link')) {
    const i = args.indexOf('--link');
    const name = args[i + 1] ?? '';
    const task = args[i + 2] ?? '';
    if (!name || !task) {
      console.error('Usage: npx tsx src/planning-templates.ts --link <name> <task>');
      process.exit(1);
    }
    if (!linkPlanTask(name, task)) {
      console.error(`Plan not found: ${name}`);
      process.exit(1);
    }
    console.log(`[OK] Plan "${name}" linked to task "${task}"`);
    return;
  }

  if (args.includes('--stats')) {
    const stats = planStats();
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  console.error('Unknown arguments. Use --help for usage.');
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
