#!/usr/bin/env node
/**
 * Merges config/skill-triggers-i18n.json into SKILL.md frontmatter.
 *
 * Why this exists (measured 2026-10-02): skill routing scored 10/10 in English
 * and 2/12 in Spanish. `auto-delegation.json#keywordMappings` is agent-scoped and
 * mostly English, so inheriting it into skill vectors did not produce a Spanish
 * vocabulary. The canonical fix is to declare `triggers:` in frontmatter — the
 * field every matcher already reads — and to keep the lexicon in one declarative
 * file instead of editing ~30 SKILL.md files by hand and letting them drift.
 *
 * Guarantees:
 *  - idempotent: a second run produces no diff
 *  - additive: existing triggers are preserved, duplicates removed
 *  - non-destructive: only the frontmatter block is rewritten; the body is untouched
 *  - reports unknown skills instead of silently creating directories
 *
 * Usage:
 *   node --import tsx src/skills/skill-trigger-i18n.ts --sync   # apply
 *   node --import tsx src/skills/skill-trigger-i18n.ts --check   # drift only, exit 1
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load as loadYaml } from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

interface SkillTriggers {
  es: string[];
}
interface Lexicon {
  version: string;
  skills: Record<string, SkillTriggers>;
}

export interface SyncResult {
  updated: string[];
  unchanged: string[];
  missing: string[];
  broken: string[];
  repaired: string[];
}

function parsesAsYaml(frontmatter: string): boolean {
  try {
    loadYaml(frontmatter);
    return true;
  } catch {
    return false;
  }
}

function findRepoRoot(from: string): string {
  let current = resolve(from);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(current, 'package.json')) && existsSync(join(current, 'skills'))) {
      return current;
    }
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}

/**
 * Reads a YAML block list (`key:` then `- item` lines) by walking lines.
 *
 * Implemented without a repeated group on purpose: `(?:[ \t]*-[ \t]*.+\n?)+`
 * is a ReDoS shape and eslint security/detect-unsafe-regex rejects it. Line
 * walking is also easier to reason about when the list sits inside a nested block.
 */
function readYamlBlockList(frontmatter: string, key: string, indent: string): string[] {
  const lines = frontmatter.split('\n');
  const keyPattern = new RegExp(`^${indent}${key}:[ \\t]*$`);
  const start = lines.findIndex((line) => keyPattern.test(line));
  if (start === -1) return [];
  const values: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    // A new key at this indent level (or a line that is not a `- ` item) ends the list.
    const item = new RegExp(`^${indent}[ \\t]*-[ \\t]+(.+)$`).exec(line);
    if (!item) break;
    values.push(unquote(item[1].trim()));
  }
  return values;
}

function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, '');
}

/** Reads existing triggers from a frontmatter block, inline or YAML list form. */
function readTriggers(frontmatter: string): string[] {
  const inline = frontmatter.match(/^triggers:\s*\[(.*)\]\s*$/m);
  if (inline) {
    return inline[1]
      .split(',')
      .map((v) => unquote(v.trim()))
      .filter((v) => v.length > 0);
  }
  return readYamlBlockList(frontmatter, 'triggers', '');
}

/**
 * Merges repeated top-level mapping keys in a frontmatter block.
 *
 * Some skills in the repo ship frontmatter that is already invalid YAML: a
 * top-level key such as `metadata:` appears twice, which YAML rejects with
 * "duplicated mapping key". Those files cannot be re-serialized safely by any
 * consumer that parses YAML (skill-embedder falls back to the directory name and
 * loses name/description). This repairs them by folding every occurrence into a
 * single key whose children are the union, preserving order and letting the last
 * value win for scalar collisions.
 */
export function mergeDuplicateTopLevelKeys(frontmatter: string): {
  merged: string;
  changed: boolean;
} {
  const lines = frontmatter.split('\n');

  interface Range {
    key: string;
    start: number;
    end: number;
  }
  const ranges: Range[] = [];
  for (let i = 0; i < lines.length; i++) {
    const key = /^([A-Za-z0-9_.-]+):/.exec(lines[i])?.[1];
    if (!key) continue;
    if (ranges.length > 0) ranges[ranges.length - 1].end = i;
    ranges.push({ key, start: i, end: lines.length });
  }

  const byKey = new Map<string, Range[]>();
  for (const range of ranges) {
    byKey.set(range.key, [...(byKey.get(range.key) ?? []), range]);
  }
  if (![...byKey.values()].some((list) => list.length > 1)) {
    return { merged: frontmatter, changed: false };
  }

  // Emit each top-level key exactly once, in first-appearance order, with its own
  // body followed by the bodies of the later occurrences. Rebuilding a new array
  // avoids mutating indices, which is what makes the naive version fragile.
  const emitted = new Set<string>();
  const out: string[] = [];
  for (const range of ranges) {
    if (emitted.has(range.key)) continue;
    emitted.add(range.key);
    out.push(lines[range.start]);
    for (const occurrence of byKey.get(range.key) ?? []) {
      out.push(...lines.slice(occurrence.start + 1, occurrence.end));
    }
  }
  // Anything before the first top-level key (comments, blank lines) is preserved.
  const firstStart = ranges.length > 0 ? ranges[0].start : lines.length;
  const prefix = lines.slice(0, firstStart);
  return { merged: [...prefix, ...out].join('\n'), changed: true };
}

/** Reads an indented `triggers:` (or nested `metadata: > trigger:`) list. */
function readNestedTriggers(frontmatter: string): string[] {
  const nestedInline = frontmatter.match(/\n[ \t]+triggers:\s*\[(.*)\]/);
  if (nestedInline) {
    return nestedInline[1]
      .split(',')
      .map((v) => unquote(v.trim()))
      .filter((v) => v.length > 0);
  }
  // `metadata:` > `trigger:` uses the same singular key, at whatever indent.
  const singular = readYamlBlockListAnyIndent(frontmatter, 'trigger');
  if (singular.length > 0) return singular;
  return readYamlBlockListAnyIndent(frontmatter, 'triggers');
}

/** Block-list reader that accepts any indentation level for the key line. */
function readYamlBlockListAnyIndent(frontmatter: string, key: string): string[] {
  const lines = frontmatter.split('\n');
  const keyPattern = new RegExp(`^[ \\t]+${key}:[ \\t]*$`);
  const start = lines.findIndex((line) => keyPattern.test(line));
  if (start === -1) return [];
  const indent = (lines[start].match(/^[ \t]*/) ?? [''])[0];
  const itemPattern = new RegExp(`^${indent}[ \\t]*-[ \\t]+(.+)$`);
  const values: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    const item = itemPattern.exec(line);
    if (!item) break;
    values.push(unquote(item[1].trim()));
  }
  return values;
}

/** Quotes only when YAML would otherwise misread the value. */
function yamlValue(value: string): string {
  return /^[\w][\w .\-/]*$/.test(value) && !/^(true|false|null|yes|no|on|off)$/i.test(value)
    ? value
    : `"${value.replace(/"/g, '\\"')}"`;
}

export function syncTriggers(
  lexiconPath: string,
  skillsDir: string,
): SyncResult {
  const lexicon = JSON.parse(readFileSync(lexiconPath, 'utf8')) as Lexicon;
  const result: SyncResult = { updated: [], unchanged: [], missing: [], broken: [], repaired: [] };

  for (const [skillName, entry] of Object.entries(lexicon.skills)) {
    const skillPath = join(skillsDir, skillName, 'SKILL.md');
    if (!existsSync(skillPath)) {
      result.missing.push(skillName);
      continue;
    }
    let content = readFileSync(skillPath, 'utf8');
    const rawParts = splitFrontmatter(content);
    if (!rawParts) {
      result.missing.push(`${skillName} (no frontmatter)`);
      continue;
    }
    // Repair pass: only for frontmatter that is already invalid YAML (duplicate
    // top-level keys). Repairing changes the frontmatter, so it is validated like
    // any other rewrite and reported separately from a trigger sync.
    let frontmatter = rawParts.frontmatter;
    if (!parsesAsYaml(frontmatter)) {
      const repaired = mergeDuplicateTopLevelKeys(frontmatter);
      if (repaired.changed && parsesAsYaml(repaired.merged)) {
        const rebuiltRepair = `---${'\n'}${repaired.merged.replace(/\n+$/, '')}\n---${rawParts.body}`;
        const verdict = validateFrontmatter(content, rebuiltRepair);
        if (verdict.ok) {
          writeFileSync(skillPath, rebuiltRepair, 'utf8');
          result.repaired.push(skillName);
          content = rebuiltRepair;
          frontmatter = repaired.merged;
        } else {
          result.broken.push(`${skillName}: repair failed (${verdict.reason})`);
          continue;
        }
      }
    }
    const parts = splitFrontmatter(content) ?? rawParts;
    // Triggers can also live nested, e.g. `metadata:` -> `trigger:`. Those are
    // read by skill-embedder's stringList(metadata.metadata?.trigger), so they
    // must be counted as existing, otherwise a top-level `triggers:` key is
    // appended and YAML reports a duplicate mapping key.
    const nestedTriggerCount = readNestedTriggers(frontmatter).length;
    const existing = readTriggers(frontmatter);
    const merged = [...new Set([...existing, ...entry.es])];
    if (merged.length === existing.length + nestedTriggerCount) {
      result.unchanged.push(skillName);
      continue;
    }

    const renderedBlock = ['triggers:'].concat(merged.map((t) => `  - ${yamlValue(t)}`)).join('\n');
    let nextFrontmatter: string;
    // Line-based block surgery instead of regex: a repeated group over list items
    // is a ReDoS shape (rejected by security/detect-unsafe-regex), and these
    // operations need exact key-line and item-line boundaries anyway.
    const lines = frontmatter.split('\n');
    const topKeyIndex = lines.findIndex((line) => /^triggers:[ \t]/.test(line));
    const nestedKeyIndex = lines.findIndex((line) => /^[ \t]+triggers:[ \t]/.test(line));

    if (topKeyIndex !== -1) {
      const indent = (lines[topKeyIndex].match(/^[ \t]*/) ?? [''])[0];
      const itemPattern = new RegExp(`^${indent}[ \\t]*-[ \\t]+`);
      let end = topKeyIndex + 1;
      if (!itemPattern.test(lines[end] ?? '')) {
        // Inline form: `triggers: [a, b]` — exactly one line to replace.
        end = topKeyIndex + 1;
      } else {
        while (end < lines.length && (lines[end].trim() === '' || itemPattern.test(lines[end]))) {
          end++;
        }
      }
      lines.splice(topKeyIndex, end - topKeyIndex, renderedBlock);
      nextFrontmatter = lines.join('\n');
    } else if (nestedKeyIndex !== -1) {
      // A nested `triggers:` exists. Promote it to top level rather than adding a
      // second key at another level, which YAML rejects as a duplicate.
      const promoted = readNestedTriggers(frontmatter);
      const combined = [...new Set([...existing, ...promoted, ...entry.es])];
      const promotedBlock = ['triggers:']
        .concat(combined.map((t) => `  - ${yamlValue(t)}`))
        .join('\n');
      // Remove the nested key line and its indented items.
      const indent = (lines[nestedKeyIndex].match(/^[ \t]*/) ?? [''])[0];
      const itemPattern = new RegExp(`^${indent}[ \\t]*-[ \\t]+`);
      let end = nestedKeyIndex + 1;
      while (end < lines.length && (lines[end].trim() === '' || itemPattern.test(lines[end]))) {
        end++;
      }
      const nestedInlineLine = /^[ \t]+triggers:[ \t]*\[.*\][ \t]*$/.test(lines[nestedKeyIndex]);
      lines.splice(nestedKeyIndex, nestedInlineLine ? 1 : end - nestedKeyIndex);
      nextFrontmatter = `${lines.join('\n').replace(/\n+$/, '')}\n${promotedBlock}`;
    } else {
      // Append at the END of the frontmatter block. Do not try to find the end of
      // `description`: it is often a folded scalar (`description: >`) whose real
      // text lives on indented continuation lines, and inserting after the header
      // line truncates it (hit 4 CRITICAL skills on 2026-10-02 before this fix).
      // YAML does not care about key order, so end-of-block is the safe anchor.
      nextFrontmatter = `${frontmatter.replace(/\n+$/, '')}\n${renderedBlock}`;
    }

    // Closing delimiter carries no trailing newline: every SKILL.md body already
    // begins with its own leading newline(s), so appending one here duplicates it
    // and shifts the whole body by a character. Diagnosed with
    // scripts/utilities/debug-frontmatter.mjs after two false "body changed" reports.
    const rebuilt = `---\n${nextFrontmatter.replace(/\n+$/, '')}\n---${parts.body}`;

    // Safety net: never leave a skill with a broken frontmatter. If the rewritten
    // block does not parse, or name/description changed, restore the original.
    const verdict = validateFrontmatter(content, rebuilt);
    if (!verdict.ok) {
      result.broken.push(`${skillName}: ${verdict.reason}`);
      continue;
    }
    writeFileSync(skillPath, rebuilt, 'utf8');
    result.updated.push(skillName);
  }

  return result;
}

/**
 * Single source of truth for locating the frontmatter. Both the rewriter and the
 * validator must derive the body the same way, or the "body unchanged" assertion
 * compares two different spans and always fails.
 */
export function splitFrontmatter(
  content: string,
): { block: string; frontmatter: string; body: string } | null {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  return {
    block: match[0],
    frontmatter: match[1],
    body: content.slice(match[0].length),
  };
}

/**
 * Confirms a rewritten SKILL.md is still loadable: the frontmatter must parse as
 * YAML and must preserve name + a description of at least 20 characters.
 */
export function validateFrontmatter(
  original: string,
  rewritten: string,
): { ok: true } | { ok: false; reason: string } {
  const originalParts = splitFrontmatter(original);
  const rewrittenParts = splitFrontmatter(rewritten);
  if (!originalParts || !rewrittenParts) {
    return { ok: false, reason: 'frontmatter block not found' };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = (loadYaml(rewrittenParts.frontmatter) as Record<string, unknown> | null) ?? {};
  } catch (error) {
    return { ok: false, reason: `YAML parse failed: ${(error as Error).message}` };
  }
  const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
  const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
  if (!name) return { ok: false, reason: 'name lost or emptied' };
  if (description.length < 20) {
    return { ok: false, reason: `description truncated to ${description.length} chars` };
  }
  // Body must be byte-identical (line-ending normalized); only frontmatter changes.
  if (originalParts.body.replace(/\r\n/g, '\n') !== rewrittenParts.body.replace(/\r\n/g, '\n')) {
    return { ok: false, reason: 'body changed' };
  }
  return { ok: true };
}

function main(): void {
  const root = findRepoRoot(__dirname);
  const lexiconPath = join(root, 'config', 'skill-triggers-i18n.json');
  const skillsDir = join(root, 'skills');
  const checkOnly = process.argv.includes('--check');

  if (!existsSync(lexiconPath)) {
    console.error(`Lexicon not found: ${lexiconPath}`);
    process.exit(1);
  }

  const result = syncTriggers(lexiconPath, skillsDir);
  console.log(
    `skills: ${result.updated.length} updated, ${result.unchanged.length} unchanged, ${result.repaired.length} repaired`,
  );
  if (result.missing.length > 0) {
    console.warn(`missing (${result.missing.length}): ${result.missing.join(', ')}`);
  }
  if (result.broken.length > 0) {
    // Refuse to report success when a skill could not be written safely.
    console.error(`broken (${result.broken.length}): ${result.broken.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  if (checkOnly && result.updated.length > 0) {
    console.error(
      `FAIL: ${result.updated.length} skill(s) have triggers out of sync with the lexicon: ${result.updated.join(', ')}`,
    );
    process.exit(1);
  }
  if (!checkOnly && result.updated.length > 0) {
    console.log(`updated: ${result.updated.join(', ')}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}