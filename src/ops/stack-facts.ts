#!/usr/bin/env node
/** Generate canonical stack facts from live config, filesystem, and Nexus schema. */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CRITICAL_SKILLS } from '../integrations/zcode-sync.js';

interface StackFacts {
  generatedAt: string;
  packageVersion: string;
  runtime: { node: string; packageManager: string };
  nexus: { tables: number; migrations: number; rows: number; journalMode: string };
  budgets: {
    daily: number;
    perSession: number;
    perAgent: number;
    softThreshold: number;
    hardThreshold: number;
  };
  agents: { opencode: number };
  skills: { indexed: number; critical: number };
  tools: string[];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function collectStackFacts(root = process.cwd()): StackFacts {
  const resolved = resolve(root);
  const pkg = readJson<{ version: string; packageManager?: string }>(
    join(resolved, 'package.json'),
  );
  const budget = readJson<{
    tokenBudget: { limits: StackFacts['budgets'] };
  }>(join(resolved, 'config', 'token-budget-guard.json'));
  const embedding = readJson<{ metadata: { totalSkills: number } }>(
    join(resolved, '.atl', 'skill-embeddings.json'),
  );
  const agentDir = join(resolved, '.opencode', 'agents');
  const tools = readdirSync(join(resolved, 'config'))
    .filter((name) => /^tool-.+\.json$/.test(name))
    .map((name) => name.slice(5, -5))
    .sort();

  const db = new Database(join(resolved, '.runtime', 'gentle-vanguard.db'), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const migrations = (
      db.prepare('SELECT COUNT(*) count FROM _migrations').get() as { count: number }
    ).count;
    const tableNames = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    let rows = 0;
    for (const { name } of tableNames) {
      const escaped = name.replace(/"/g, '""');
      rows += (db.prepare(`SELECT COUNT(*) count FROM "${escaped}"`).get() as { count: number })
        .count;
    }
    const journalMode = (db.pragma('journal_mode', { simple: true }) as string).toUpperCase();
    return {
      generatedAt: new Date().toISOString(),
      packageVersion: pkg.version,
      runtime: { node: process.version, packageManager: pkg.packageManager ?? 'unknown' },
      nexus: { tables: tableNames.length, migrations, rows, journalMode },
      budgets: budget.tokenBudget.limits,
      agents: {
        opencode: existsSync(agentDir)
          ? readdirSync(agentDir).filter((name) => name.endsWith('.md')).length
          : 0,
      },
      skills: { indexed: embedding.metadata.totalSkills, critical: CRITICAL_SKILLS.length },
      tools,
    };
  } finally {
    db.close();
  }
}

function stableFacts(facts: StackFacts): unknown {
  return {
    packageVersion: facts.packageVersion,
    packageManager: facts.runtime.packageManager,
    nexus: {
      tables: facts.nexus.tables,
      migrations: facts.nexus.migrations,
      journalMode: facts.nexus.journalMode,
    },
    budgets: facts.budgets,
    agents: facts.agents,
    skills: facts.skills,
    tools: facts.tools,
  };
}

function renderMarkdown(facts: StackFacts): string {
  return `# Gentle-Vanguard Stack Facts

> Generated from live configuration and Nexus. Do not edit manually.

- Generated: \`${facts.generatedAt}\`
- Stack version: \`${facts.packageVersion}\`
- Runtime: \`${facts.runtime.node}\`, \`${facts.runtime.packageManager}\`
- Nexus: \`${facts.nexus.tables}\` tables, \`${facts.nexus.migrations}\` migrations, \`${facts.nexus.rows}\` rows, \`${facts.nexus.journalMode}\`
- Token budgets: daily \`${facts.budgets.daily}\`, session \`${facts.budgets.perSession}\`, agent \`${facts.budgets.perAgent}\`
- OpenCode agents: \`${facts.agents.opencode}\`
- Skills: \`${facts.skills.indexed}\` indexed, \`${facts.skills.critical}\` critical
- Tool profiles: ${facts.tools.map((tool) => `\`${tool}\``).join(', ')}
`;
}

function main(): void {
  const root = process.cwd();
  const jsonPath = resolve(root, 'docs', 'generated', 'stack-facts.json');
  const markdownPath = resolve(root, 'docs', 'generated', 'STACK-FACTS.md');
  const facts = collectStackFacts(root);
  if (process.argv.includes('--check')) {
    if (!existsSync(jsonPath)) {
      console.error('[STACK-FACTS] Missing generated facts. Run npm run stack:facts.');
      process.exitCode = 1;
      return;
    }
    const stored = readJson<StackFacts>(jsonPath);
    const matches = JSON.stringify(stableFacts(stored)) === JSON.stringify(stableFacts(facts));
    console.log(`[STACK-FACTS] ${matches ? 'PASS' : 'DRIFT'}`);
    if (!matches) process.exitCode = 1;
    return;
  }
  mkdirSync(resolve(root, 'docs', 'generated'), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(facts, null, 2)}\n`);
  writeFileSync(markdownPath, renderMarkdown(facts));
  console.log(JSON.stringify(facts, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
