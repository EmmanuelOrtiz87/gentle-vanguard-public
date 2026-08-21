#!/usr/bin/env node
/**
 * Audit broken .ps1 references across src/, config/, scripts/ and hooks/.
 * Finds string literals/paths referencing .ps1 files, checks whether the
 * target file exists, and classifies: COMMENT (doc only) vs FUNCTIONAL.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const EXT = /\.ps1['"]/;

function isCommentLine(line: string): boolean {
  const t = line.trim();
  return (
    t.startsWith('*') ||
    t.startsWith('//') ||
    t.startsWith('/*') ||
    t.startsWith('#') ||
    t.startsWith('<!--') ||
    /TS migration of/.test(t) ||
    /Migrated from/.test(t) ||
    /Replaces/.test(t) ||
    /replaces/.test(t) ||
    /replacement for/.test(t)
  );
}

function extractPs1Refs(line: string): string[] {
  const refs: string[] = [];
  const re = /["']([^"']*\.ps1)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) refs.push(m[1]);
  return refs;
}

let commentRefs = 0;
const functionalMissing: Array<{ file: string; line: number; ref: string }> = [];
const functionalExists: Array<{ file: string; line: number; ref: string }> = [];

function walk(dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        ['node_modules', '.git', 'dist', 'build', '.runtime', 'graphify-out'].includes(entry.name)
      )
        continue;
      walk(full);
    } else if (/\.(ts|js|json|yml|yaml|md|ps1)$/.test(entry.name)) {
      analyzeFile(full);
    }
  }
}

function analyzeFile(file: string): void {
  let content: string;
  try {
    content = fs.readFileSync(file, 'utf-8');
  } catch {
    return;
  }
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!EXT.test(lines[i])) continue;
    const refs = extractPs1Refs(lines[i]);
    if (refs.length === 0) continue;
    const isComment = isCommentLine(lines[i]);
    for (const ref of refs) {
      if (ref.startsWith('.')) continue; // .ps1 as extension only
      // Skip pure extension references
      if (ref === '.ps1' || ref === '.ps1"' || ref === ".ps1'") continue;
      // Resolve relative to ROOT (best effort) or config/skills dirs
      const candidates = [path.join(ROOT, ref.replace(/\\/g, '/'))];
      const exists = candidates.some((c) => fs.existsSync(c));
      const entry = { file, line: i + 1, ref };
      if (isComment) {
        commentRefs++;
      } else if (exists) {
        functionalExists.push(entry);
      } else {
        functionalMissing.push(entry);
      }
    }
  }
}

walk('src');
walk('config');
walk('hooks');
walk('scripts');
walk('.github');

console.log(`=== PS1 Reference Audit ===`);
console.log(`Comment/doc refs: ${commentRefs}`);
console.log(`Functional refs to EXISTING ps1: ${functionalExists.length}`);
console.log(`Functional refs to MISSING ps1 (BROKEN): ${functionalMissing.length}`);
console.log('');
if (functionalMissing.length) {
  console.log('--- BROKEN REFERENCES ---');
  for (const r of functionalMissing) {
    console.log(`${r.file}:${r.line}  ->  ${r.ref}`);
  }
}
console.log('');
if (functionalExists.length) {
  console.log('--- EXISTING ps1 (still referenced functionally) ---');
  for (const r of functionalExists) {
    console.log(`${r.file}:${r.line}  ->  ${r.ref}`);
  }
}
