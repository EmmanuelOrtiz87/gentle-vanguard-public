#!/usr/bin/env node
/** Validate local Markdown links without requiring network access. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const IGNORED = new Set([
  '.git',
  'node_modules',
  '.runtime',
  '.session',
  '.archive',
  '.backups',
  '.agents',
  '.antigravity',
  '.opencode',
  '.kilo',
  '.windsurf',
  'build',
  'graphify-out',
  'knowledge-base',
  'scripts',
  'dist',
  'coverage',
  'public',
  'skills',
]);
const LINK_RE = /!?\[[^\]]*\]\(([^)]+)\)/g;

function markdownFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(path));
    else if (/\.md$/i.test(entry.name)) files.push(path);
  }
  return files;
}

function isCanonical(file: string): boolean {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  return (
    !rel.includes('/') ||
    rel.startsWith('docs/architecture/') ||
    rel === 'docs/stack-manual-modules.md' ||
    rel === 'docs/stack-manual-full.md' ||
    /^docs\/adr\/ADR-00(35|36|37)-/.test(rel)
  );
}

function localTarget(source: string, raw: string): string | null {
  const target = raw.trim().replace(/^<|>$/g, '');
  if (!target || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) return null;
  const pathPart = target.split('#', 1)[0].split('?', 1)[0];
  if (!pathPart) return null;
  return resolve(join(source, pathPart));
}

const allFiles = markdownFiles(ROOT);
const files = allFiles.filter(isCanonical);
const broken: Array<{ file: string; target: string }> = [];
for (const file of files) {
  const sourceDir = resolve(file, '..');
  // Links inside fenced examples are prose/code samples, not repository
  // references. Generated/public mirrors and historical snapshots are also
  // intentionally outside this canonical documentation gate.
  const content = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const match of content.matchAll(LINK_RE)) {
    const target = localTarget(sourceDir, match[1]);
    if (!target) continue;
    if (!target.startsWith(ROOT) || !existsSync(target)) {
      broken.push({ file: relative(ROOT, file), target: match[1] });
    }
  }
}

if (broken.length) {
  for (const item of broken) console.error(`[BROKEN] ${item.file} -> ${item.target}`);
  console.error(`Found ${broken.length} broken local Markdown link(s).`);
  process.exitCode = 1;
} else {
  console.log(`[DOCS] PASS — ${files.length}/${allFiles.length} canonical Markdown files, no broken local links.`);
}
