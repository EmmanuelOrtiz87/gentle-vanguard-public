#!/usr/bin/env node
/**
 * Audits relative links in SKILL.md bodies and reports the ones that do not resolve.
 *
 * Why this exists (measured 2026-10-02): 29 skills shipped links into a
 * `references/` directory that does not exist, including 4 CRITICAL skills
 * (`security-and-hardening` 8/8 broken, `planning-and-task-breakdown` 7/7). An
 * agent that follows a dead link gets no pattern catalog and silently degrades,
 * which is worse than the skill being absent because the route still matched.
 *
 * A dead reference link is exactly the failure mode that a size ratchet cannot
 * see: the file is small and well-formed, it just points nowhere.
 *
 * Usage:
 *   node --import tsx src/tools/check-skill-references.ts            # report
 *   node --import tsx src/tools/check-skill-references.ts --strict   # exit 1
 *   node --import tsx src/tools/check-skill-references.ts --json
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CRITICAL_SKILLS } from '../integrations/zcode-sync.js';

const ROOT = resolve(process.cwd());
const SKILLS_DIR = join(ROOT, 'skills');
const BASELINE_PATH = join(ROOT, 'config', 'skill-reference-baseline.json');

interface ReferenceBaseline {
  version: string;
  updatedAt: string;
  /** skill -> sorted list of dead targets already recorded. */
  skills: Record<string, string[]>;
}

export interface BrokenLink {
  skill: string;
  critical: boolean;
  line: number;
  target: string;
  /** Why it failed, so the report is actionable rather than just a count. */
  reason: 'missing-file' | 'missing-parent' | 'anchor-only' | 'escapes-skill';
}

/** Markdown code fence delimiter. */
const FENCE = '```';

/**
 * Two simple passes instead of one alternation. The combined form nested a group
 * with an optional prefix and a directory alternation, which
 * security/detect-unsafe-regex correctly rejects. Both patterns below are flat:
 * a literal, then a character class.
 */
const MD_LINK = /\]\(([^)\s]+)\)/g;
const LINK_DIRS = ['references', 'reference', 'assets', 'scripts', 'examples', 'data', 'rules'];
const BARE_PATH = new RegExp(
  String.raw`(?:^|[\s(>])\.{0,2}/?(?:${LINK_DIRS.join('|')})/[A-Za-z0-9._\-/]*[A-Za-z0-9._\-]`,
  'g',
);

/** Collects every local path a line points at, deduplicated. */
function extractTargets(line: string): string[] {
  const targets = new Set<string>();
  for (const match of line.matchAll(MD_LINK)) {
    const value = (match[1] ?? '').trim();
    if (value) targets.add(value);
  }
  for (const match of line.matchAll(BARE_PATH)) {
    // Drop the leading delimiter character the capture relies on.
    const value = match[0].trim().replace(/^[(\s>]+/, '');
    if (value) targets.add(value);
  }
  return [...targets];
}

/**
 * Resolves a link target against three bases, in order:
 *   1. the skill directory (the normal case for `references/`, `assets/`)
 *   2. the repository root (skills legitimately cite repo files such as
 *      `src/agent-delegator.ts` or `rules/TOKEN-BUDGET-POLICY.md`)
 *   3. the repository root again for `../..` escapes, which are legal as long as
 *      the file exists — flagging every `../../` as broken was a false positive
 */
function resolveTarget(
  skillDir: string,
  rawTarget: string,
): { target: string; reason: BrokenLink['reason'] } {
  const target = rawTarget.split('#')[0].trim();
  if (target.length === 0) return { target: rawTarget, reason: 'anchor-only' };

  if (existsSync(join(skillDir, target))) return { target, reason: 'missing-file' };
  if (existsSync(join(ROOT, target))) return { target, reason: 'missing-file' };

  // Distinguish "the whole references/ dir was never shipped" from "one file was
  // renamed": the first is a packaging bug, the second is a stale link.
  const absolute = join(skillDir, target);
  const parent = dirname(absolute);
  return { target, reason: existsSync(parent) ? 'missing-file' : 'missing-parent' };
}

export function auditSkillReferences(skillsDir = SKILLS_DIR): {
  skills: number;
  linksChecked: number;
  broken: BrokenLink[];
} {
  const critical = new Set(CRITICAL_SKILLS.map((s) => s.dir));
  const broken: BrokenLink[] = [];
  let linksChecked = 0;
  let skills = 0;

  let entries: string[] = [];
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return { skills: 0, linksChecked: 0, broken };
  }

  for (const skill of entries) {
    const skillMd = join(skillsDir, skill, 'SKILL.md');
    if (!existsSync(skillMd)) continue;
    skills++;
    const content = readFileSync(skillMd, 'utf-8');
    const skillDir = join(skillsDir, skill);
    let inFence = false;

    content.split('\n').forEach((line, index) => {
      // Fence detection must run BEFORE inline-code stripping. Stripping turns
      // "```bash" into "bash", so the fence never opens and every path inside an
      // example block gets reported as a dead link. That bug inflated the count
      // from the real figure to 145 on 2026-10-02.
      if (line.trim().startsWith(FENCE)) {
        inFence = !inFence;
        return;
      }
      if (inFence) return;
      // Frontmatter is metadata, not prose; paths there are not links.
      if (index < 2 || line.trim() === '---') return;
      // Inline code is a mention of a path, not a link to follow.
      const prose = line.replace(/`[^`]*`/g, '');

      for (const raw of extractTargets(prose)) {
        if (/^(https?:|mailto:|#)/i.test(raw)) continue;
        linksChecked++;
        const { target, reason } = resolveTarget(skillDir, raw);
        if (reason !== 'missing-file') {
          broken.push({ skill, critical: critical.has(skill), line: index + 1, target, reason });
        }
      }
    });
  }

  return { skills, linksChecked, broken };
}

function loadBaseline(): ReferenceBaseline | null {
  if (!existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as ReferenceBaseline;
  } catch {
    return null;
  }
}

function writeBaseline(broken: BrokenLink[]): void {
  const skills: Record<string, string[]> = {};
  for (const link of broken) {
    skills[link.skill] = [...new Set([...(skills[link.skill] ?? []), link.target])].sort();
  }
  const ordered: Record<string, string[]> = {};
  for (const skill of Object.keys(skills).sort()) ordered[skill] = skills[skill];
  const baseline: ReferenceBaseline = {
    version: '1.0.0',
    updatedAt: new Date().toISOString(),
    skills: ordered,
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
}

function main(): void {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const asJson = args.includes('--json');
  const updateBaseline = args.includes('--update-baseline');
  const report = auditSkillReferences();

  if (updateBaseline) {
    writeBaseline(report.broken);
    console.log(
      `[BASELINE] Recorded ${report.broken.length} dead link(s) across ${new Set(report.broken.map((b) => b.skill)).size} skill(s)`,
    );
    return;
  }

  // Ratchet, same design as check-skill-sizes: the existing debt was inherited,
  // not created here, so failing on it would block every unrelated change. New or
  // additional dead links fail; a link that gets fixed disappears from the set.
  const baseline = loadBaseline();
  const stillBroken = new Set(report.broken.map((b) => `${b.skill}::${b.target}`));
  // Built from the baseline, not from the current report: a skill whose links are
  // ALL fixed has no entry in report.broken, so deriving `known` from the report
  // silently reported zero progress for a completely repaired skill.
  const known = new Set(
    Object.entries(baseline?.skills ?? {}).flatMap(([skill, targets]) =>
      targets.map((t) => `${skill}::${t}`),
    ),
  );
  const violations = baseline
    ? report.broken.filter((b) => !known.has(`${b.skill}::${b.target}`))
    : report.broken;
  const fixed = [...known].filter((entry) => !stillBroken.has(entry));

  if (asJson) {
    console.log(
      JSON.stringify(
        { ...report, ratchet: { violations: violations.length, fixed: fixed.length, baselined: baseline !== null } },
        null,
        2,
      ),
    );
    if (violations.length > 0 && strict) process.exitCode = 1;
    return;
  }

  console.log(`[SCAN] ${report.skills} skills | ${report.linksChecked} local links checked`);
  console.log(
    `[DEBT] ${report.broken.length} dead link(s) in ${new Set(report.broken.map((b) => b.skill)).size} skill(s) | ${report.broken.filter((b) => b.critical).length} in CRITICAL skills`,
  );
  if (fixed.length > 0) {
    console.log(`[PROGRESS] ${fixed.length} link(s) fixed since the baseline — run --update-baseline to tighten.`);
  }

  if (violations.length === 0) {
    if (!baseline) {
      console.error('[FAIL] No reference baseline on record. Run --update-baseline to adopt the current debt.');
      process.exitCode = 1;
      return;
    }
    console.log('[OK] No new dead references (ratchet holds).');
    return;
  }

  const criticalCount = violations.filter((b) => b.critical).length;
  console.error(`[BROKEN] ${violations.length} new dead link(s), ${criticalCount} in CRITICAL skills:`);
  const grouped = new Map<string, BrokenLink[]>();
  for (const broken of violations) {
    grouped.set(broken.skill, [...(grouped.get(broken.skill) ?? []), broken]);
  }
  for (const [skill, entries] of [...grouped.entries()].sort()) {
    console.error(`  ${entries[0].critical ? 'CRITICAL' : '        '} ${skill}: ${entries.length} new`);
    for (const entry of entries.slice(0, 4)) {
      console.error(`      line ${entry.line}: ${entry.target} (${entry.reason})`);
    }
  }
  console.error('[ACTION] Create the file, or remove the link and inline the content.');
  if (strict) process.exitCode = 1;
  else console.log('[ADVISORY] Re-run with --strict to fail.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}