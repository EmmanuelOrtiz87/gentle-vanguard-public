#!/usr/bin/env node
/**
 * Enforces skill SKILL.md size limits as a ratchet.
 *
 * Why a ratchet and not a plain exit 1: 115 of 236 skills were already over the
 * limit when this check was made enforceable (measured 2026-10-02). Failing on
 * that debt would block every unrelated change, so the checker instead records a
 * baseline and fails only when the debt grows:
 *   - a skill not in the baseline that exceeds the limit  -> FAIL (new debt)
 *   - a baselined skill whose size grew past its record  -> FAIL (regression)
 *   - a baselined skill that shrank                      -> PASS, and the win is
 *     reported so the baseline can be tightened
 * Critical skills (CRITICAL_SKILLS, shipped to 5 tool surfaces) are held to a
 * separate, tighter bar because their metadata budget is shared: exceeding it
 * degrades the auto-trigger of every other skill in the same host.
 *
 * Usage:
 *   node --import tsx src/tools/check-skill-sizes.ts              # ratchet, exit 1 on violation
 *   node --import tsx src/tools/check-skill-sizes.ts --warn-only  # advisory, never fails
 *   node --import tsx src/tools/check-skill-sizes.ts --update-baseline
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CRITICAL_SKILLS } from '../integrations/zcode-sync.js';

const ROOT = resolve(process.cwd());
const BASELINE_PATH = join(ROOT, 'config', 'skill-size-baseline.json');
const BUDGET_PATH = join(ROOT, 'config', 'skill-size-budget.json');

/**
 * Budgets live in config/skill-size-budget.json, not in this file. Before that,
 * four numbers disagreed: 700 recommended, 1000 hard, 250 (which was actually a
 * character limit on `description`, not a token limit), and a critical cap of
 * 4000 that had been written backwards.
 */
interface SizeBudget {
  default: { bodyMaxTokens: number; maxLines: number };
  critical: { bodyMaxTokens: number; maxLines: number };
}

const FALLBACK_BUDGET: SizeBudget = {
  default: { bodyMaxTokens: 1000, maxLines: 150 },
  critical: { bodyMaxTokens: 700, maxLines: 150 },
};

function loadBudget(): SizeBudget {
  if (!existsSync(BUDGET_PATH)) return FALLBACK_BUDGET;
  try {
    const parsed = JSON.parse(readFileSync(BUDGET_PATH, 'utf-8')) as SizeBudget;
    return {
      default: { ...FALLBACK_BUDGET.default, ...parsed.default },
      critical: { ...FALLBACK_BUDGET.critical, ...parsed.critical },
    };
  } catch {
    return FALLBACK_BUDGET;
  }
}

interface SizeRecord {
  lines: number;
  tokens: number;
}

interface Baseline {
  version: string;
  updatedAt: string;
  limits: { maxLines: number; maxTokens: number; criticalMaxTokens: number };
  /** Recorded debt: skill -> size at the moment the baseline was taken. */
  skills: Record<string, SizeRecord>;
}

/** Hosts cap shared skill metadata (excerpt per skill); exceeding it degrades
 *  auto-trigger for every other skill in that host. See zcode-sync.ts CRITICAL_SKILLS. */
const CRITICAL_MAX_TOKENS = 700;

interface SkillSize {
  name: string;
  critical: boolean;
  lines: number;
  tokens: number;
  sizeKB: number;
}

function scan(rootDir: string, critical: Set<string>): SkillSize[] {
  if (!existsSync(rootDir)) return [];
  const out: SkillSize[] = [];
  for (const entry of readdirSyncSafe(rootDir)) {
    const skillMd = join(rootDir, entry, 'SKILL.md');
    if (!existsSync(skillMd)) continue;
    const content = readFileSync(skillMd, 'utf-8');
    const lines = content.split('\n').length;
    out.push({
      name: entry,
      critical: critical.has(entry),
      lines,
      // Same heuristic as the original checker (bytes/4) so records stay comparable.
      tokens: Math.round(Buffer.byteLength(content, 'utf8') / 4),
      sizeKB: Math.round((Buffer.byteLength(content, 'utf8') / 1024) * 10) / 10,
    });
  }
  return out;
}

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Critical skills are held to a STRICTER bar than the default, not a looser one.
 * They are the ones copied to 5 tool surfaces and competing for a shared
 * per-host metadata budget, so the ones with the largest blast radius must be the
 * smallest. An earlier revision set them to 4000 tokens, which inverted the rule.
 */
function limitsFor(skill: SkillSize, budget: SizeBudget): { tokens: number; lines: number } {
  return skill.critical
    ? { tokens: budget.critical.bodyMaxTokens, lines: budget.critical.maxLines }
    : { tokens: budget.default.bodyMaxTokens, lines: budget.default.maxLines };
}

function main(): void {
  const args = process.argv.slice(2);
  const warnOnly = args.includes('--warn-only') || args.includes('-WarnOnly');
  const updateBaseline = args.includes('--update-baseline');
  const budget = loadBudget();
  const overrideTokens = args.includes('--max-tokens')
    ? parseInt(args[args.indexOf('--max-tokens') + 1], 10)
    : null;
  const overrideLines = args.includes('--max-lines')
    ? parseInt(args[args.indexOf('--max-lines') + 1], 10)
    : null;
  const maxTokens = overrideTokens ?? budget.default.bodyMaxTokens;
  const maxLines = overrideLines ?? budget.default.maxLines;
  // A global --max-tokens override is for probing the ratchet; it must never
  // loosen the critical bar, only tighten the default one.
  if (overrideTokens !== null) budget.critical.bodyMaxTokens = Math.min(overrideTokens, budget.critical.bodyMaxTokens);

  const critical = new Set(CRITICAL_SKILLS.map((s) => s.dir));
  const skills = [...scan(join(ROOT, 'skills'), critical)];
  if (skills.length === 0) {
    console.log('[OK] No skills found to scan.');
    return;
  }

  // Current debt: every skill over its applicable limit.
  const current = new Map<string, SizeRecord>();
  for (const skill of skills) {
    const limit = limitsFor(skill, budget);
    if (overrideTokens !== null || overrideLines !== null) {
      limit.tokens = overrideTokens ?? limit.tokens;
      limit.lines = overrideLines ?? limit.lines;
    }
    if (skill.tokens > limit.tokens || skill.lines > limit.lines) {
      current.set(skill.name, { lines: skill.lines, tokens: skill.tokens });
    }
  }

  if (updateBaseline) {
    const baseline: Baseline = {
      version: '1.0.0',
      updatedAt: new Date().toISOString(),
      limits: { maxLines, maxTokens, criticalMaxTokens: CRITICAL_MAX_TOKENS },
      skills: Object.fromEntries([...current.entries()].sort(([a], [b]) => a.localeCompare(b))),
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    console.log(
      `[BASELINE] Recorded ${current.size} over-limit skill(s) at ${maxLines} lines / ${maxTokens} tokens (critical cap ${CRITICAL_MAX_TOKENS})`,
    );
    return;
  }

  const baseline = loadBaseline();
  const violations: Array<{ skill: string; reason: string }> = [];
  const improved: string[] = [];

  for (const [name, record] of current) {
    const previous = baseline?.skills[name];
    if (!previous) {
      violations.push({
        skill: name,
        reason: `new debt: ${record.tokens} tok / ${record.lines} lines (no baseline entry)`,
      });
      continue;
    }
    if (record.tokens > previous.tokens) {
      violations.push({
        skill: name,
        reason: `regressed: ${previous.tokens} -> ${record.tokens} tok`,
      });
    } else if (record.tokens < previous.tokens) {
      improved.push(`${name} (${previous.tokens} -> ${record.tokens})`);
    }
  }
  // Baseline entries that are now within limits: the debt was actually paid.
  for (const name of Object.keys(baseline?.skills ?? {})) {
    if (!current.has(name)) improved.push(`${name} (within limits)`);
  }

  console.log(
    `[SCAN] ${skills.length} skills | ${current.size} over limit | ${baseline ? Object.keys(baseline.skills).length : 0} baselined`,
  );

  if (improved.length > 0) {
    console.log(`[PROGRESS] ${improved.length} skill(s) improved — run --update-baseline to tighten:`);
    for (const line of improved.slice(0, 20)) console.log(`  ${line}`);
  }

  if (violations.length === 0) {
    console.log('[OK] No new or worsened size violations (ratchet holds).');
    return;
  }

  console.error(`[FAIL] ${violations.length} skill(s) violate the size ratchet:`);
  for (const violation of violations) console.error(`  ${violation.skill}: ${violation.reason}`);
  console.error('[ACTION] Move detail into references/ and keep SKILL.md lean.');
  if (!warnOnly) process.exitCode = 1;
  else console.log('[WARN-ONLY] Not failing the build.');
}

function loadBaseline(): Baseline | null {
  if (!existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as Baseline;
  } catch {
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}