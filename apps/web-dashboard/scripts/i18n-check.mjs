#!/usr/bin/env node
/**
 * i18n gate — verifies every tt('ui.*') literal used in dashboard components
 * exists in src/hooks/useLocale.ts across ALL language sections.
 *
 * Native stack capability (no external deps). Run: npm run i18n:check
 * Exit codes: 0 = OK, 1 = missing keys found.
 */
import { readdirSync, statSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const localeFile = join(srcDir, 'hooks', 'useLocale.ts');

function walk(dir, exts, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, exts, acc);
    else if (exts.some((e) => entry.endsWith(e))) acc.push(full);
  }
  return acc;
}

// 1. Collect tt('ui.*') literals from all TSX/TS sources (excluding useLocale itself)
const sourceFiles = walk(srcDir, ['.tsx', '.ts']).filter((f) => !f.endsWith('useLocale.ts'));
const used = new Map(); // key -> [file:line]
const LITERAL = /\btt\('(ui\.[a-z0-9_]+)'\)/g;
for (const file of sourceFiles) {
  const content = readFileSync(file, 'utf8');
  const rel = file.slice(root.length + 1);
  let m;
  while ((m = LITERAL.exec(content)) !== null) {
    const line = content.slice(0, m.index).split('\n').length;
    if (!used.has(m[1])) used.set(m[1], []);
    used.get(m[1]).push(`${rel}:${line}`);
  }
}

// 2. Collect defined keys from useLocale.ts
const localeContent = readFileSync(localeFile, 'utf8');
const defined = new Set();
const DEF = /'(ui\.[a-z0-9_]+)':/g;
let d;
while ((d = DEF.exec(localeContent)) !== null) defined.add(d[1]);

// 3. Missing = used but never defined
const missing = [...used.keys()].filter((k) => !defined.has(k)).sort();

if (missing.length === 0) {
  console.log(`i18n:check OK — ${used.size} keys used across ${sourceFiles.length} files, all defined in useLocale.ts`);
  process.exit(0);
}

console.error(`i18n:check FAILED — ${missing.length} key(s) used but NOT defined in useLocale.ts:\n`);
for (const k of missing) {
  console.error(`  ${k}`);
  for (const loc of used.get(k)) console.error(`    at ${loc}`);
}
console.error(`\nAdd these keys to ALL language sections (en/es/pt-BR) in src/hooks/useLocale.ts.`);
process.exit(1);
