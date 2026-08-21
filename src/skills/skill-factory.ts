#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { runSync } from '../core/run-command.js';

export interface SkillFactoryArgs {
  Name: string;
  Description: string;
  Agent?: string;
  Triggers?: string;
  Register?: boolean;
  DryRun?: boolean;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('-')) {
      const key = arg.replace(/^-+/, '');
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        args[key] = next;
        i++;
      } else {
        args[key] = 'true';
      }
    }
  }
  return args;
}

function findRepoRoot(start: string): string {
  const root = resolve(start);
  let current = root;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(current, 'config', 'orchestrator.json'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return root;
}

const ROOT = process.env.GENTLE_VANGUARD_BASE_DIR
  ? resolve(process.env.GENTLE_VANGUARD_BASE_DIR)
  : findRepoRoot(process.cwd());

function main() {
  const raw = parseArgs(process.argv);
  const args: SkillFactoryArgs = {
    Name: raw['Name'] ?? '',
    Description: raw['Description'] ?? '',
    Agent: raw['Agent'] ?? 'DEV - Code',
    Triggers: raw['Triggers'] ?? '',
    Register: raw['Register'] === 'true',
    DryRun: raw['DryRun'] === 'true',
  };

  if (!args.Name) {
    console.error('[ERROR] Name is required');
    process.exit(1);
  }
  if (!args.Description) {
    console.error('[ERROR] Description is required');
    process.exit(1);
  }

  const name = args.Name;
  const description = args.Description;
  const agent = args.Agent!;
  const triggers = args.Triggers || name.replace(/-skill$/, '').replace(/-/g, ' ');
  const doRegister = args.Register;
  const dryRun = args.DryRun;

  const skillPath = join(ROOT, 'skills', name);
  const skillMdPath = join(skillPath, 'SKILL.md');
  const autoDelPath = join(ROOT, 'config', 'auto-delegation.json');
  const registryPath = join(ROOT, '.atl', 'skill-registry.md');

  if (!/^[a-z0-9][a-z0-9_-]+$/.test(name)) {
    console.error(
      '\x1b[31m[ERROR] Name must be lowercase alphanumeric with hyphens/underscores\x1b[0m',
    );
    process.exit(1);
  }
  if (existsSync(skillPath) && !dryRun) {
    console.error(`\x1b[31m[ERROR] Skill already exists: ${skillPath}\x1b[0m`);
    process.exit(1);
  }

  const agentShort = agent.replace(/ - .*$/, '');

  console.log(`\x1b[36m[SKILL] Creating skill: ${name}\x1b[0m`);
  console.log(`[SKILL] Agent: ${agent} | Triggers: ${triggers}`);

  if (dryRun) {
    console.log(`\x1b[33m[DRY-RUN] Would create: ${skillMdPath}\x1b[0m`);
    if (doRegister) console.log(`\x1b[33m[DRY-RUN] Would register in: ${autoDelPath}\x1b[0m`);
    return;
  }

  mkdirSync(skillPath, { recursive: true });
  mkdirSync(join(skillPath, 'references'), { recursive: true });

  const skillContent = `---
name: ${name}
description: >
  ${description}
trigger: "${triggers}"
---

# ${name}

## When to Use

- ${description}

## Guidelines

- Follow project conventions
- Keep instructions clear and concise
- Reference existing patterns in the codebase

## References

- [Detail](references/detail.md)
`;
  writeFileSync(skillMdPath, skillContent, 'utf8');
  console.log(`\x1b[32m[SKILL] Created: ${skillMdPath}\x1b[0m`);

  const detailContent = `# ${name} -- Detail

## Overview

${description}

## Examples

\`\`\`
# Example usage
\`\`\`

## Edge Cases

- TBD
`;
  writeFileSync(join(skillPath, 'references', 'detail.md'), detailContent, 'utf8');
  console.log('\x1b[36m[SKILL] Created: references/detail.md\x1b[0m');

  if (doRegister) {
    if (existsSync(autoDelPath)) {
      try {
        const config = JSON.parse(readFileSync(autoDelPath, 'utf8')) as Record<string, unknown>;
        if (config.keywordMappings && typeof config.keywordMappings === 'object') {
          const mappings = config.keywordMappings as Record<string, unknown>;
          if (!(name in mappings)) {
            mappings[name] = {
              agent: agentShort,
              skill: name,
              triggers: triggers.split(',').map((s) => s.trim()),
            };
            writeFileSync(autoDelPath, JSON.stringify(config, null, 2), 'utf8');
            console.log('\x1b[32m[SKILL] Registered in auto-delegation.json\x1b[0m');
          } else {
            console.log('\x1b[33m[SKILL] Already in auto-delegation.json\x1b[0m');
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`\x1b[33m[WARN] Could not update auto-delegation.json: ${msg}\x1b[0m`);
      }
    }

    const triggerList = triggers
      .split(',')
      .map((s) => s.trim())
      .join(', ');
    const registryLine = `| ${agent} | ${name} | ${triggerList} |\n`;
    try {
      appendFileSync(registryPath, registryLine, 'utf8');
      console.log('\x1b[32m[SKILL] Appended to skill-registry.md\x1b[0m');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`\x1b[33m[WARN] Could not append to skill-registry.md: ${msg}\x1b[0m`);
    }
  }

  console.log('\x1b[36m[SKILL] Rebuilding MCP server...\x1b[0m');
  try {
    const result = runSync('pnpm', ['build:mcp'], { cwd: ROOT, stdio: 'pipe' });
    if (result.status === 0) {
      console.log('\x1b[32m[SKILL] MCP server rebuilt\x1b[0m');
    } else {
      const errMsg = result.stderr || result.stdout || 'unknown error';
      console.log(`\x1b[33m[WARN] MCP rebuild failed: ${errMsg}\x1b[0m`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`\x1b[33m[WARN] MCP rebuild failed: ${msg}\x1b[0m`);
  }

  console.log(`\x1b[36m[SKILL] Done! New skill: ${name} (agent: ${agent})\x1b[0m`);
  console.log(`  Edit: ${skillMdPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
