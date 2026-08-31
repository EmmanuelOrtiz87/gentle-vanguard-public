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

// These files are migration inventories/repair tooling. Their strings are
// data describing historical paths, not executable runtime dependencies.
const MIGRATION_INVENTORIES = new Set([
  'src/tools/auto-ps1-fixer.ts',
  'src/tools/auto-ps1-fixer-configs.ts',
  'src/tools/fix-skill-references.ts',
  'config/ps1-ts-migration.json',
]);

// Historical fallback strings are retained only for migration diagnostics;
// the native TS path is selected first (or the entry is documentation/data).
const LEGACY_FALLBACK_FILES = new Set([
  'src/tools/digest-generator.ts',
  'src/hooks/pre-commit.ts',
  'src/hooks/validate-readme-hook.ts',
  'src/knowledge/knowledge-base-autoinit.ts',
  'src/knowledge/knowledge-base-init.ts',
  'src/tokens/token-usage-notifier.ts',
  'src/web/witr-wrapper.ts',
  'src/infrastructure/normative-audit-pipeline.ts',
  'src/orchestration/karpathy-enforcer.ts',
  'src/orchestration/orchestrate-auto-fix.ts',
  'src/ops/setup-complete.ts',
  'src/infrastructure/sync-to-public.ts',
  'src/tools/validate-readme.ts',
  'config/structure-policy.json',
  'config/tool-profiles/CLAUDE.compressed.md',
  'scripts/.session/claude-settings.baseline.json',
  'scripts/.session/cline-config.baseline.json',
  'scripts/utilities/CONFIG/session-autostart.config.json',
  'scripts/utilities/docs/json-to-doc-converter.README.md',
  'scripts/utilities/workflow/WORKFLOW-ORCHESTRATION/hook-registry.json',
]);

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
let legacyFallbackRefs = 0;
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
  const relativeFile = path.relative(ROOT, path.resolve(file)).replace(/\\/g, '/');
  if (MIGRATION_INVENTORIES.has(relativeFile)) return;
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
      } else if (LEGACY_FALLBACK_FILES.has(path.relative(ROOT, file).replace(/\\/g, '/'))) {
        legacyFallbackRefs++;
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
console.log(`Legacy fallback/inventory refs: ${legacyFallbackRefs}`);
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
