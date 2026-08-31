#!/usr/bin/env node
/**
 * Skill Migrator - Migrate opencode skills to native format
 *
 * Converts skills from .opencode/skills/ to /skills/ with native structure.
 * Usage: npx tsx src/skill-migrator.ts --migrate-all
 */

import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, basename } from 'path';

interface OpenCodeSkill {
  name: string;
  description: string;
  triggers: string[];
}

interface NativeSkill {
  name: string;
  description: string | string[];
  triggers: string[];
  aliases: string[];
  metadata: {
    source: string;
    migrated: boolean;
    migratedAt: string;
    originalPath: string;
  };
}

const OPENCODE_SKILLS_DIR = join(process.cwd(), '.opencode', 'skills');
const NATIVE_SKILLS_DIR = join(process.cwd(), 'skills');

// Priority skills to migrate
const PRIORITY_SKILLS = [
  'validate-stack',
  'ab-testing',
  'api-and-interface-design',
  'ci-cd-and-automation',
  'code-review-and-quality',
  'code-simplification',
  'debugging-and-error-recovery',
  'documentation-and-adrs',
  'doubt-driven-development',
  'frontend-ui-engineering',
  'git-workflow-and-versioning',
  'planning-and-task-breakdown',
  'test-driven-development',
  'web-research',
  'work-unit-commits',
];

/**
 * Parse opencode skill frontmatter
 */
function parseOpenCodeFrontmatter(content: string): Partial<OpenCodeSkill> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!match) return {};

  const yaml = match[1];
  const skill: Partial<OpenCodeSkill> = {};

  // Parse simple key:value pairs
  const lines = yaml.split('\n');
  let currentKey = '';
  let inArray = false;
  const currentArray: string[] = [];

  for (const line of lines) {
    const keyMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      // Save previous array
      if (inArray && currentKey) {
        (skill as Record<string, unknown>)[currentKey] = currentArray.slice();
        currentArray.length = 0;
      }

      currentKey = keyMatch[1];
      const value = keyMatch[2].trim();

      if (value) {
        (skill as Record<string, unknown>)[currentKey] = value;
      }
      inArray = !value;
    } else if (line.trim().startsWith('- ')) {
      // Array item
      inArray = true;
      currentArray.push(line.trim().slice(2));
    }
  }

  // Save final array
  if (inArray && currentKey && currentArray.length > 0) {
    (skill as Record<string, unknown>)[currentKey] = currentArray.slice();
  }

  return skill;
}

/**
 * Convert opencode skill to native format
 */
function convertToNative(opencodeSkill: OpenCodeSkill, skillPath: string): NativeSkill {
  return {
    name: opencodeSkill.name || basename(skillPath),
    description: opencodeSkill.description || '',
    triggers: opencodeSkill.triggers || [],
    aliases: [opencodeSkill.name].filter(Boolean),
    metadata: {
      source: 'opencode-migrated',
      migrated: true,
      migratedAt: new Date().toISOString(),
      originalPath: skillPath,
    },
  };
}

/**
 * Generate native SKILL.md content
 */
function generateNativeSkillMd(skill: NativeSkill, originalContent: string): string {
  const bodyMatch = originalContent.match(/---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
  const body = bodyMatch ? bodyMatch[1] : originalContent;

  const desc = Array.isArray(skill.description)
    ? skill.description.join('\n  ')
    : skill.description || '';

  return `---
name: ${skill.name}
aliases: ${JSON.stringify(skill.aliases)}
description: >
  ${desc.replace(/\n/g, '\n  ')}
triggers:
  - ${skill.triggers.join('\n  - ')}
metadata:
  source: ${skill.metadata.source}
  migrated: ${skill.metadata.migrated}
  migratedAt: "${skill.metadata.migratedAt}"
  originalPath: ${skill.metadata.originalPath}
  version: "1.0.0"
---

${body.trim()}
`;
}

/**
 * List all opencode skills
 */
function listOpenCodeSkills(): string[] {
  if (!existsSync(OPENCODE_SKILLS_DIR)) {
    console.error(`Directory not found: ${OPENCODE_SKILLS_DIR}`);
    return [];
  }

  return readdirSync(OPENCODE_SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

/**
 * Check if skill already exists natively
 */
function existsNative(skillName: string): boolean {
  return existsSync(join(NATIVE_SKILLS_DIR, skillName, 'SKILL.md'));
}

/**
 * Migrate a single skill
 */
function migrateSkill(skillName: string): { success: boolean; error?: string } {
  try {
    const opencodePath = join(OPENCODE_SKILLS_DIR, skillName, 'SKILL.md');

    if (!existsSync(opencodePath)) {
      return { success: false, error: `SKILL.md not found in ${opencodePath}` };
    }

    // Check if already exists natively
    if (existsNative(skillName)) {
      console.log(`  ⚠️  ${skillName} already exists natively, skipping`);
      return { success: true };
    }

    // Read opencode skill
    const content = readFileSync(opencodePath, 'utf-8');
    const frontmatter = parseOpenCodeFrontmatter(content);

    // Convert to native
    const nativeSkill = convertToNative(frontmatter as OpenCodeSkill, opencodePath);

    // Create native skill directory
    const nativeDir = join(NATIVE_SKILLS_DIR, skillName);
    mkdirSync(nativeDir, { recursive: true });

    // Write native SKILL.md
    const nativeContent = generateNativeSkillMd(nativeSkill, content);
    writeFileSync(join(nativeDir, 'SKILL.md'), nativeContent, 'utf-8');

    console.log(`  ✅ ${skillName} migrated successfully`);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Migrate priority skills
 */
function migratePriority(): void {
  console.log('\n=== Migrating Priority Skills ===\n');

  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const skill of PRIORITY_SKILLS) {
    if (existsNative(skill)) {
      console.log(`  ⚠️  ${skill} already exists, skipping`);
      skipped++;
      continue;
    }

    const result = migrateSkill(skill);
    if (result.success) {
      success++;
    } else {
      console.error(`  ❌ ${skill}: ${result.error}`);
      failed++;
    }
  }

  console.log(`\nResults: ${success} migrated, ${failed} failed, ${skipped} skipped`);
}

/**
 * Migrate all opencode skills
 */
function migrateAll(): void {
  console.log('\n=== Migrating All OpenCode Skills ===\n');

  const skills = listOpenCodeSkills();
  console.log(`Found ${skills.length} skills in .opencode/skills/\n`);

  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const skill of skills) {
    if (existsNative(skill)) {
      console.log(`  ⚠️  ${skill} already exists natively, skipping`);
      skipped++;
      continue;
    }

    const result = migrateSkill(skill);
    if (result.success) {
      success++;
    } else {
      console.error(`  ❌ ${skill}: ${result.error}`);
      failed++;
    }
  }

  console.log(`\n=== Migration Complete ===`);
  console.log(`  ✅ Success: ${success}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  ⚠️  Skipped: ${skipped}`);
  console.log(`  📊 Total: ${success + failed + skipped}`);
}

/**
 * CLI
 */
function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case '--list-opencode':
      console.log('\n=== OpenCode Skills ===\n');
      listOpenCodeSkills().forEach((s) => console.log(`  ${s}`));
      break;

    case '--list-native':
      console.log('\n=== Native Skills ===\n');
      const nativeSkills = readdirSync(NATIVE_SKILLS_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      nativeSkills.forEach((s) => console.log(`  ${s}`));
      console.log(`\nTotal: ${nativeSkills.length} native skills`);
      break;

    case '--migrate-priority':
      migratePriority();
      break;

    case '--migrate-all':
      migrateAll();
      break;

    case '--migrate':
      const skill = args[1];
      if (!skill) {
        console.error('Usage: --migrate <skill-name>');
        process.exit(1);
      }
      const result = migrateSkill(skill);
      console.log(result.success ? '✅ Success' : `❌ Failed: ${result.error}`);
      break;

    default:
      console.log(`
Skill Migrator - Migrate opencode skills to native format

Usage:
  --list-opencode          List skills in .opencode/skills/
  --list-native            List native skills
  --migrate <skill>        Migrate specific skill
  --migrate-priority       Migrate priority skills
  --migrate-all            Migrate all skills (64 total)

Description:
  Converts opencode-specific skill format to native /skills/ structure.
  Makes skills portable to Claude, Cursor, and other AI tools.
`);
  }
}

import { pathToFileURL } from 'url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { migrateSkill, listOpenCodeSkills, migratePriority };
