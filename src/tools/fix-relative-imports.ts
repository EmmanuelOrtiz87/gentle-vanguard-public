#!/usr/bin/env node
/**
 * fix-relative-imports.ts — normaliza los imports relativos a la extension `.js`.
 *
 * POR QUE (2026-11-18)
 * -------------------------------------------------------------------------
 * El stack compila a ESM (`tsc --rewriteRelativeImportExtensions`), pero esa
 * flag solo reescribe los imports que YA usaban extension `.ts`. Los imports
 * relativos SIN extension (`from './repo-root'`) salen tal cual en el JS
 * emitido, y Node ESM no resuelve specs sin extension: el artefacto muere con
 * ERR_MODULE_NOT_FOUND al arrancar.
 *
 * Medido: 263 imports sin extension en 120 archivos. El MCP de skills estaba
 * declarado en tres superficies apuntando a `dist/scripts/mcp/skill-server.js`
 * y MORIA al arrancar en las tres.
 *
 * La convencion que ya usa la MAYORIA del stack (y la que el build exige) es
 * `from './x.js'`: TypeScript resuelve `./x.js` -> `x.ts` y, al compilar,
 * emite `./x.js` tal cual. tsx tambien lo resuelve. Un solo estilo para todo.
 *
 * QUE HACE
 *   - Reescribe cada spec relativo sin extension al que exista en disco:
 *       `<dir>/x.ts`        -> `./x.js`
 *       `<dir>/x/index.ts`  -> `./x/index.js`
 *       `<dir>/x.json`      -> `./x.json`
 *   - NO toca: imports de paquete (bare), builtins (node:*), y specs que no
 *     resuelven a ningun archivo (los reporta: son deuda manual, no se
 *     inventan destinos).
 *
 * USO
 *   node --import tsx src/tools/fix-relative-imports.ts            # dry-run (reporta)
 *   node --import tsx src/tools/fix-relative-imports.ts --apply    # reescribe
 *   node --import tsx src/tools/fix-relative-imports.ts --check    # exit 1 si queda alguno
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export interface ImportFix {
  file: string;
  from: string;
  to: string;
  resolved: string;
}

export interface UnresolvedImport {
  file: string;
  spec: string;
}

const SPEC_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.[^'"]*)\2/g;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Resuelve un spec relativo sin extension al destino real en disco. */
export function resolveRelative(
  fileDir: string,
  spec: string,
  exists: (path: string) => boolean = existsSync,
): { suffix: string; resolved: string } | null {
  const abs = resolve(fileDir, spec);
  if (exists(`${abs}.ts`)) return { suffix: '.js', resolved: `${abs}.ts` };
  if (exists(`${abs}.tsx`)) return { suffix: '.js', resolved: `${abs}.tsx` };
  if (exists(`${abs}.json`)) return { suffix: '.json', resolved: `${abs}.json` };
  if (exists(join(abs, 'index.ts')))
    return { suffix: '/index.js', resolved: join(abs, 'index.ts') };
  if (exists(abs) && statSync(abs).isDirectory()) {
    // Directorio con package.json: es un paquete, se deja como esta.
    return null;
  }
  return null;
}

/** Calcula los cambios de un archivo sin escribirlo. */
export function planFile(
  file: string,
  content: string,
  exists: (path: string) => boolean = existsSync,
): { fixes: ImportFix[]; unresolved: UnresolvedImport[]; next: string } {
  const dir = dirname(file);
  const fixes: ImportFix[] = [];
  const unresolved: UnresolvedImport[] = [];
  const next = content.replace(
    SPEC_RE,
    (match, keyword: string, quote: string, spec: string, offset: number) => {
      if (/\.(js|mjs|cjs|json|ts|tsx)$/.test(spec)) return match;
      // Los ejemplos de los doc-comments (`import { X } from './x'`) no son codigo:
      // reescribirlos ensucia la documentacion y crea specs que no existen.
      const lineStart = content.lastIndexOf('\n', Math.max(offset - 1, 0)) + 1;
      const lineText = content.slice(lineStart, offset).trim();
      if (lineText.startsWith('*') || lineText.startsWith('//') || lineText.startsWith('/*')) {
        return match;
      }
      const resolved = resolveRelative(dir, spec, exists);
      if (!resolved) {
        unresolved.push({ file, spec });
        return match;
      }
      const to = `${spec}${resolved.suffix}`;
      fixes.push({ file, from: spec, to, resolved: relative(process.cwd(), resolved.resolved) });
      return `${keyword}${quote}${to}${quote}`;
    },
  );
  return { fixes, unresolved, next };
}

function collectFiles(root: string): string[] {
  const dirs = [
    'src',
    'scripts',
    'adapters',
    'packages/shared/src',
    'packages/gv-shorts-core/src',
    'apps/command-center',
  ];
  const files: string[] = [];
  for (const dir of dirs) {
    const full = join(root, dir);
    if (existsSync(full)) walk(full, files);
  }
  for (const dir of readdirSync(join(root, 'apps'), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const server = join(root, 'apps', dir.name, 'server');
    if (existsSync(server)) walk(server, files);
  }
  for (const dir of readdirSync(join(root, 'skills'), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const scripts = join(root, 'skills', dir.name, 'scripts');
    if (existsSync(scripts)) walk(scripts, files);
  }
  return files;
}

function main(): void {
  const root = resolve(process.cwd());
  const apply = process.argv.includes('--apply');
  const check = process.argv.includes('--check');
  const files = collectFiles(root);
  const allFixes: ImportFix[] = [];
  const allUnresolved: UnresolvedImport[] = [];
  let changedFiles = 0;

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const { fixes, unresolved, next } = planFile(file, content);
    allFixes.push(...fixes);
    allUnresolved.push(...unresolved);
    if (next !== content) {
      changedFiles++;
      if (apply) writeFileSync(file, next, 'utf-8');
    }
  }

  console.log(
    `[fix-relative-imports] ${apply ? 'APLICADO' : check ? 'CHECK' : 'dry-run'}: ` +
      `${files.length} archivos · ${allFixes.length} imports a corregir en ${changedFiles} archivos · ` +
      `${allUnresolved.length} sin resolver`,
  );
  for (const fix of allFixes.slice(0, check || apply ? allFixes.length : 20)) {
    console.log(`  ${relative(root, fix.file)}: ${fix.from} -> ${fix.to}`);
  }
  if (allUnresolved.length > 0) {
    console.log('  sin resolver (deuda manual):');
    for (const item of allUnresolved.slice(0, 20)) {
      console.log(`    ${relative(root, item.file)}: ${item.spec}`);
    }
  }
  if (check) process.exit(allFixes.length > 0 ? 1 : 0);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main();
}
