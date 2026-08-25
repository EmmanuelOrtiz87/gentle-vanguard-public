/**
 * Skill Loader - Native Skill System
 *
 * Agnostic skill loader that works with ANY AI tool (Claude, Cursor, etc.)
 * No dependency on opencode. Reads skills from /skills/ directory.
 *
 * Usage:
 *   npx tsx src/skill-loader.ts --list
 *   npx tsx src/skill-loader.ts --match "code review"
 *   npx tsx src/skill-loader.ts --load code-review-skill
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface Skill {
  name: string;
  aliases: string[];
  description: string;
  triggers: string[];
  content: string;
  path: string;
}

interface SkillFrontmatter {
  name?: string;
  description?: string;
  triggers?: string[];
  aliases?: string[];
  metadata?: Record<string, unknown>;
}

const SKILLS_DIR = join(process.cwd(), 'skills');

/**
 * Parse YAML frontmatter from markdown content
 */
function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const yaml = match[1];
  const body = match[2];

  // Parsed fields accumulator — keys are dynamic YAML keys, values are scalars or arrays
  const fields: Record<string, string | string[]> = {};

  // Simple YAML parser for basic types
  const lines = yaml.split('\n');
  let currentKey = '';
  let currentArray: string[] = [];

  for (const line of lines) {
    const keyMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      // Save previous array if exists
      if (currentKey && currentArray.length > 0) {
        fields[currentKey] = currentArray;
        currentArray = [];
      }

      currentKey = keyMatch[1];
      const value = keyMatch[2].trim();

      if (value.startsWith('[') && value.endsWith(']')) {
        // Array inline: [item1, item2]
        fields[currentKey] = value
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim());
      } else if (value.startsWith('>')) {
        // Multi-line string indicator
        fields[currentKey] = '';
      } else if (value) {
        fields[currentKey] = value;
      }
    } else if (line.trim().startsWith('- ')) {
      // Array item
      currentArray.push(line.trim().slice(2));
    } else if (currentKey && line.trim() && !fields[currentKey]?.length) {
      // Continue multi-line value
      const current = fields[currentKey];
      if (typeof current === 'string') {
        fields[currentKey] = current + ' ' + line.trim();
      }
    }
  }

  // Save final array
  if (currentKey && currentArray.length > 0) {
    fields[currentKey] = currentArray;
  }

  // Project known keys into the typed frontmatter shape
  const frontmatter: SkillFrontmatter = {};
  if (typeof fields.name === 'string') frontmatter.name = fields.name;
  if (typeof fields.description === 'string') frontmatter.description = fields.description;
  if (Array.isArray(fields.triggers)) frontmatter.triggers = fields.triggers;
  if (Array.isArray(fields.aliases)) frontmatter.aliases = fields.aliases;

  return { frontmatter, body };
}

/**
 * Load all skills from /skills/ directory
 */
export function loadSkills(): Skill[] {
  if (!existsSync(SKILLS_DIR)) {
    console.error(`Skills directory not found: ${SKILLS_DIR}`);
    return [];
  }

  const skills: Skill[] = [];
  const entries = readdirSync(SKILLS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillPath = join(SKILLS_DIR, entry.name, 'SKILL.md');
    if (!existsSync(skillPath)) continue;

    try {
      const content = readFileSync(skillPath, 'utf-8');
      const { frontmatter, body } = parseFrontmatter(content);

      const skill: Skill = {
        name: frontmatter.name || entry.name,
        aliases: frontmatter.aliases || [],
        description: frontmatter.description || '',
        triggers: frontmatter.triggers || [],
        content: body,
        path: skillPath,
      };

      skills.push(skill);
    } catch (error) {
      console.error(`Failed to load skill ${entry.name}:`, error);
    }
  }

  return skills;
}

/**
 * Match skills against user input
 */
export function matchSkill(input: string, skills: Skill[]): Skill | null {
  const normalized = input.toLowerCase();

  // Exact match on name
  for (const skill of skills) {
    if (skill.name.toLowerCase() === normalized) {
      return skill;
    }
  }

  // Match on aliases
  for (const skill of skills) {
    if (skill.aliases.some((alias) => alias.toLowerCase() === normalized)) {
      return skill;
    }
  }

  // Match on triggers
  for (const skill of skills) {
    if (skill.triggers.some((trigger) => normalized.includes(trigger.toLowerCase()))) {
      return skill;
    }
  }

  // Partial match on name
  for (const skill of skills) {
    if (
      skill.name.toLowerCase().includes(normalized) ||
      normalized.includes(skill.name.toLowerCase())
    ) {
      return skill;
    }
  }

  return null;
}

/**
 * Get skill content by name
 */
export function getSkillContent(name: string, skills: Skill[]): string | null {
  const skill = skills.find(
    (s) =>
      s.name.toLowerCase() === name.toLowerCase() ||
      s.aliases.some((a) => a.toLowerCase() === name.toLowerCase()),
  );

  return skill ? skill.content : null;
}

/**
 * CLI interface
 */
function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  const skills = loadSkills();

  switch (command) {
    case '--list':
      console.log(`\n=== Skills Loaded: ${skills.length} ===\n`);
      for (const skill of skills) {
        console.log(`${skill.name}`);
        console.log(`  Description: ${skill.description.slice(0, 60)}...`);
        console.log(`  Aliases: ${skill.aliases.join(', ') || 'none'}`);
        console.log(`  Triggers: ${skill.triggers.join(', ') || 'none'}`);
        console.log();
      }
      break;

    case '--match':
      const query = args.slice(1).join(' ');
      const match = matchSkill(query, skills);
      if (match) {
        console.log(`\n✓ Matched skill: ${match.name}`);
        console.log(`  Description: ${match.description}`);
        console.log(`  Path: ${match.path}`);
      } else {
        console.log(`\n✗ No skill matched: "${query}"`);
      }
      break;

    case '--load':
      const name = args[1];
      const content = getSkillContent(name, skills);
      if (content) {
        console.log(content);
      } else {
        console.error(`Skill not found: ${name}`);
        process.exit(1);
      }
      break;

    default:
      console.log(`
Native Skill Loader - Gentle-Vanguard

Usage:
  npx tsx src/skill-loader.ts --list           # List all skills
  npx tsx src/skill-loader.ts --match "query"  # Find matching skill
  npx tsx src/skill-loader.ts --load name      # Load skill content

Features:
  - Works with ANY AI tool (Claude, Cursor, etc.)
  - No opencode dependency
  - Loads from /skills/ directory
  - Matches by name, aliases, or triggers
`);
  }
}

// Export for use as module
export { parseFrontmatter };

// Run CLI if executed directly
import { pathToFileURL } from 'url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
