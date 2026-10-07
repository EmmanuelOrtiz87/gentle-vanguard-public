#!/usr/bin/env node
/**
 * Separates planned-but-unwritten skills from the active routing surface.
 *
 * Why this exists (measured 2026-10-02): `config/auto-delegation.json#skillToAgentProfile`
 * held 426 entries while `skills/` held 237 directories, so 264 of them (62%) named
 * a skill that existed on no disk. Those entries reached the skill router as
 * catalog entries scoring 0.14-0.21 on generic queries, above real skills, and then
 * failed to load. `agentCodeToSkill` was worse: 33 of 34 entries pointed at phantoms,
 * and nothing reads it at all.
 *
 * Why they are moved rather than deleted: the config's own `_meta.note` says
 * "All others are reference/planned agents for future expansion", and `plannedAgents`
 * was an empty array. The phantoms are a roadmap that was never written, not noise.
 * Deleting them would erase intent; keeping them in the active map is what causes the
 * bug. So they move to `plannedSkills` / `plannedAgentCodeToSkill`: preserved, visible,
 * and no longer reachable by the router, the MCP server or the ml-router.
 *
 * Usage:
 *   node --import tsx src/skills/prune-delegation-config.ts --check   # exit 1 if drift
 *   node --import tsx src/skills/prune-delegation-config.ts --apply
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.cwd());
const CONFIG_PATH = join(ROOT, 'config', 'auto-delegation.json');

export interface PruneResult {
  activeBefore: number;
  activeAfter: number;
  moved: string[];
  plannedBefore: number;
  plannedAfter: number;
  inverseMoved: string[];
  inverseDroppedEmpty: string[];
}

/** Directory names under skills/, plus the frontmatter name each declares. */
function invokableSkillNames(skillsDir = join(ROOT, 'skills')): Set<string> {
  const names = new Set<string>();
  if (!existsSync(skillsDir)) return names;
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMd = join(skillsDir, entry.name, 'SKILL.md');
    if (!existsSync(skillMd)) continue;
    names.add(entry.name);
    const content = readFileSync(skillMd, 'utf-8');
    const declared = content.match(/^name:\s*["']?([^"'\n]+?)["']?\s*$/m)?.[1]?.trim();
    if (declared) names.add(declared);
  }
  return names;
}

type StringMap = Record<string, string>;
type ListMap = Record<string, string[]>;

export function prune(configPath = CONFIG_PATH): PruneResult {
  const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  const invokable = invokableSkillNames();

  const active = (config.skillToAgentProfile ?? {}) as StringMap;
  const planned = (config.plannedSkills ?? {}) as StringMap;

  const nextActive: StringMap = {};
  const moved: string[] = [];
  // Sort so a re-run produces byte-identical output.
  for (const key of Object.keys(active).sort()) {
    if (invokable.has(key)) nextActive[key] = active[key];
    else if (planned[key] === undefined) {
      planned[key] = active[key];
      moved.push(key);
    }
  }

  const inverse = (config.agentCodeToSkill ?? {}) as ListMap;
  const plannedInverse = (config.plannedAgentCodeToSkill ?? {}) as ListMap;
  const nextInverse: ListMap = {};
  const inverseMoved: string[] = [];
  const inverseDroppedEmpty: string[] = [];
  for (const key of Object.keys(inverse).sort()) {
    const values = Array.isArray(inverse[key]) ? inverse[key] : [inverse[key]];
    const kept = values.filter((v) => invokable.has(v));
    const dropped = values.filter((v) => !invokable.has(v));
    if (dropped.length > 0) {
      plannedInverse[key] = [...new Set([...(plannedInverse[key] ?? []), ...dropped])].sort();
      inverseMoved.push(...dropped);
    }
    if (kept.length > 0) nextInverse[key] = kept;
    else inverseDroppedEmpty.push(key);
  }

  // Re-attach in the original key order of the config so the diff stays reviewable.
  const ordered = <T extends Record<string, unknown>>(source: T, next: T): T => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) if (next[key] !== undefined) out[key] = next[key];
    for (const key of Object.keys(next)) if (out[key] === undefined) out[key] = next[key];
    return out as T;
  };

  config.skillToAgentProfile = ordered(active, nextActive);
  config.plannedSkills = ordered(planned, planned);
  config.agentCodeToSkill = ordered(inverse, nextInverse);
  config.plannedAgentCodeToSkill = ordered(plannedInverse, plannedInverse);

  const meta = (config._meta ?? {}) as Record<string, unknown>;
  meta.note =
    'Only skills listed in skillToAgentProfile have a SKILL.md on disk. Skills named only in ' +
    'plannedSkills are the roadmap: preserved for intent, deliberately unreachable by the router, ' +
    'the MCP server and the ml-router. Pruned by src/skills/prune-delegation-config.ts.';
  config._meta = meta;

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');

  return {
    activeBefore: Object.keys(active).length,
    activeAfter: Object.keys(nextActive).length,
    moved,
    plannedBefore: Object.keys(planned).length,
    plannedAfter: Object.keys(planned).length,
    inverseMoved,
    inverseDroppedEmpty,
  };
}

export function countPhantoms(configPath = CONFIG_PATH): { active: number; total: number } {
  const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  const invokable = invokableSkillNames();
  const active = Object.keys((config.skillToAgentProfile ?? {}) as StringMap);
  return {
    active: active.filter((k) => !invokable.has(k)).length,
    total: active.length,
  };
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const before = countPhantoms();
  console.log(
    `[SCAN] skillToAgentProfile: ${before.total} entries, ${before.active} name a skill with no SKILL.md on disk`,
  );
  if (before.active === 0 && !apply) {
    console.log('[OK] No phantom entries.');
    return;
  }
  if (!apply) {
    console.error(
      `[FAIL] ${before.active} phantom entr${before.active === 1 ? 'y' : 'ies'}. ` +
        'Run with --apply to move them to plannedSkills (preserved, not deleted).',
    );
    process.exitCode = 1;
    return;
  }
  const result = prune();
  console.log(
    `[APPLIED] skillToAgentProfile: ${result.activeBefore} -> ${result.activeAfter} | plannedSkills: ${result.plannedBefore} -> ${result.plannedAfter}`,
  );
  console.log(
    `[APPLIED] agentCodeToSkill: ${result.inverseMoved.length} phantom reference(s) moved, ${result.inverseDroppedEmpty.length} code(s) left with no active skill`,
  );
  const now = countPhantoms();
  console.log(`[VERIFY] phantoms now: ${now.active}`);
  if (now.active > 0) {
    console.error('[FAIL] phantoms remain after pruning.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}