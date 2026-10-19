#!/usr/bin/env node
/** Structural audit for canonical skills: metadata, trigger collisions and local references. */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type SkillRecord = {
  directory: string;
  file: string;
  name: string | null;
  description: string | null;
  triggers: string[];
  source: string | null;
  upstream: string | null;
  references: string[];
};

type GovernanceReport = {
  generatedAt: string;
  summary: {
    skills: number;
    validMetadata: number;
    missingMetadata: number;
    duplicateNames: number;
    triggerCollisions: number;
    actionableTriggerCollisions: number;
    brokenReferences: number;
    skillsWithoutTriggers: number;
  };
  duplicateNames: Array<{ name: string; files: string[] }>;
  triggerCollisions: Array<{ trigger: string; skills: string[] }>;
  actionableTriggerCollisions: Array<{ trigger: string; skills: string[] }>;
  brokenReferences: Array<{ skill: string; reference: string; file: string }>;
  skillsWithoutTriggers: string[];
  sourceCounts: Record<string, number>;
  skills: SkillRecord[];
};

const root = resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd());
const skillsRoot = join(root, 'skills');
const outputDir = join(root, '.session', 'audit');
const outputPath = join(outputDir, 'skills-governance.json');

function parseSkill(file: string, directory: string): SkillRecord {
  const text = readFileSync(file, 'utf8');
  const frontmatter = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/i)?.[1] ?? '';
  const lineValue = (key: string): string | null => {
    const match = frontmatter.match(new RegExp(`^\\s*${key}:[ \\t]*(.+)$`, 'm'));
    return match?.[1].trim().replace(/^['"]|['"]$/g, '') ?? null;
  };
  const triggers = [...frontmatter.matchAll(/^\s*-\s+(.+)$/gm)]
    .map((match) => match[1].trim().replace(/^['"]|['"]$/g, ''))
    .filter((value) => value.length >= 2 && !value.startsWith('http'));
  const references = [...text.matchAll(/\]\(([^)]+)\)/g)]
    .map((match) => match[1].split('#')[0])
    .filter((value) => value.startsWith('./') || value.startsWith('../') || value.startsWith('reference/'));
  return {
    directory,
    file,
    name: lineValue('name'),
    description: lineValue('description'),
    triggers,
    source: lineValue('source'),
    upstream: lineValue('upstream'),
    references,
  };
}

function walkSkillDirs(): SkillRecord[] {
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directory = entry.name;
      const file = join(skillsRoot, directory, 'SKILL.md');
      return existsSync(file) ? parseSkill(file, directory) : null;
    })
    .filter((skill): skill is SkillRecord => skill !== null);
}

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

function main(): void {
  const skills = walkSkillDirs();
  const byName = new Map<string, string[]>();
  const byTrigger = new Map<string, string[]>();
  const sourceCounts: Record<string, number> = {};
  for (const skill of skills) {
    if (skill.name) byName.set(skill.name, [...(byName.get(skill.name) ?? []), skill.file]);
    for (const trigger of skill.triggers) {
      const normalized = normalize(trigger);
      byTrigger.set(normalized, [...(byTrigger.get(normalized) ?? []), skill.name ?? skill.directory]);
    }
    const source = skill.source ?? 'unspecified';
    sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
  }
  const duplicateNames = [...byName.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([name, files]) => ({ name, files }));
  const triggerCollisions = [...byTrigger.entries()]
    .filter(([, names]) => new Set(names).size > 1)
    .map(([trigger, names]) => ({ trigger, skills: [...new Set(names)].sort() }))
    .sort((a, b) => b.skills.length - a.skills.length || a.trigger.localeCompare(b.trigger));
  const actionableTriggerCollisions = triggerCollisions.filter(({ trigger }) => {
    // ATT&CK/control identifiers are intentionally repeated taxonomy labels;
    // generic natural-language triggers are the ones that create routing risk.
    if (/^[a-z0-9.-]+$/i.test(trigger) && /\d/.test(trigger)) return false;
    return trigger.length >= 4 && !['security', 'compliance', 'governance', 'design', 'testing', 'audit'].includes(trigger);
  });
  const brokenReferences = skills.flatMap((skill) =>
    skill.references
      .filter((reference) => !existsSync(resolve(skill.file, '..', reference)))
      .map((reference) => ({ skill: skill.name ?? skill.directory, reference, file: skill.file })),
  );
  const skillsWithoutTriggers = skills.filter((skill) => skill.triggers.length === 0).map((skill) => skill.name ?? skill.directory);
  const report: GovernanceReport = {
    generatedAt: new Date().toISOString(),
    summary: {
      skills: skills.length,
      validMetadata: skills.filter((skill) => Boolean(skill.name && skill.description)).length,
      missingMetadata: skills.filter((skill) => !skill.name || !skill.description).length,
      duplicateNames: duplicateNames.length,
      triggerCollisions: triggerCollisions.length,
      actionableTriggerCollisions: actionableTriggerCollisions.length,
      brokenReferences: brokenReferences.length,
      skillsWithoutTriggers: skillsWithoutTriggers.length,
    },
    duplicateNames,
    triggerCollisions,
    actionableTriggerCollisions,
    brokenReferences,
    skillsWithoutTriggers,
    sourceCounts,
    skills,
  };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ outputPath, ...report.summary, topActionableTriggerCollisions: actionableTriggerCollisions.slice(0, 12) }, null, 2));
}

main();
