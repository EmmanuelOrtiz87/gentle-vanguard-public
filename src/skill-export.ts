#!/usr/bin/env node
/**
 * skill-export.ts — Export all Gentle-Vanguard skills to every supported tool
 * format via the format adapters.
 *
 * This is the consumer that wires the `adapters/` layer into the stack so it:
 *   1. Loads every format adapter through `loadAdapters()`.
 *   2. Scans `skills/<name>/SKILL.md`.
 *   3. Converts each skill into the native format of each tool.
 *
 * Usage:
 *   npx tsx src/skill-export.ts                 # export all tools → all skills
 *   npx tsx src/skill-export.ts --tool codex    # only one tool
 *   npx tsx src/skill-export.ts --skill git     # only skills matching "git"
 *   npx tsx src/skill-export.ts --dry-run       # report only, write nothing
 */
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { loadAdapters } from '../adapters/index.js';

const ROOT = resolve(process.cwd());
const SKILLS_DIR = join(ROOT, 'skills');

// Default output directory per tool (relative to the repo root).
const OUTPUT_DIRS: Record<string, string> = {
  antigravity: '.antigravity/skills',
  codex: '.codex/skills',
  windsurf: '.windsurf/plugins',
};

interface CliArgs {
  tool?: string;
  skill?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tool') args.tool = argv[++i];
    else if (a === '--skill') args.skill = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

function listSkills(filter?: string): string[] {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => !filter || name.toLowerCase().includes(filter.toLowerCase()));
}

async function main(): Promise<number> {
  const { tool, skill, dryRun } = parseArgs(process.argv.slice(2));
  const adapters = await loadAdapters();

  // Minimal adapter contract: converts a SKILL.md into the target tool format
  interface FormatAdapter {
    convert: (skillPath: string, outputPath: string) => void;
  }

  const available: { name: string; adapter: FormatAdapter }[] = [];
  if (adapters.antigravityAdapter)
    available.push({ name: 'antigravity', adapter: adapters.antigravityAdapter });
  if (adapters.codexAdapter) available.push({ name: 'codex', adapter: adapters.codexAdapter });
  if (adapters.windsurfAdapter)
    available.push({ name: 'windsurf', adapter: adapters.windsurfAdapter });

  if (available.length === 0) {
    console.error('[skill-export] No format adapters available. Check adapters/ directory.');
    return 1;
  }

  const skills = listSkills(skill);
  console.log(`[skill-export] ${skills.length} skill(s) found in ${SKILLS_DIR}`);
  console.log(`[skill-export] Adapters available: ${available.map((a) => a.name).join(', ')}`);

  let converted = 0;
  let skipped = 0;

  for (const { name: toolName, adapter } of available) {
    if (tool && toolName !== tool) continue;
    const outDir = join(ROOT, OUTPUT_DIRS[toolName] ?? `.${toolName}/skills`);
    if (!dryRun) mkdirSync(outDir, { recursive: true });

    for (const skillName of skills) {
      const skillPath = join(SKILLS_DIR, skillName, 'SKILL.md');
      if (!existsSync(skillPath)) {
        skipped++;
        continue;
      }
      try {
        if (dryRun) {
          console.log(`  [dry-run] ${toolName}: ${skillName}`);
        } else {
          // codex/antigravity converters write a single JSON file; windsurf
          // creates a plugin directory. Pass the right output target per tool.
          const output =
            toolName === 'windsurf'
              ? outDir
              : join(outDir, `${skillName.replace(/\s+/g, '-')}.json`);
          adapter.convert(skillPath, output);
          converted++;
        }
      } catch (err) {
        console.error(`  [ERROR] ${toolName}/${skillName}: ${(err as Error).message}`);
        skipped++;
      }
    }
  }

  console.log(`[skill-export] Done. converted=${converted} skipped=${skipped} dryRun=${dryRun}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[skill-export] Fatal:', err);
    process.exit(1);
  });
