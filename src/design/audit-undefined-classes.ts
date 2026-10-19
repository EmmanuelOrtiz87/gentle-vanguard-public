#!/usr/bin/env node
/**
 * audit-undefined-classes — Detecta clases CSS `gv-*` usadas en las apps que NO
 * están definidas en ningún CSS (ni en el paquete design-system ni en las apps).
 *
 * Motivo: la clase de bug de `.gv-badge` / `.gv-btn-danger` (clase usada sin
 * definición → sin estilo, silencioso). Este check lo detecta de forma sistemática.
 *
 * Uso:
 *   node --import tsx src/design/audit-undefined-classes.ts            # humano
 *   node --import tsx src/design/audit-undefined-classes.ts --json     # máquina
 *
 * Exit code: 0 si no hay faltantes reales; 1 si hay (apto para CI/gates).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();

const EXCLUDE =
  /node_modules|[\\/]dist[\\/]|[\\/]\.runtime[\\/]|[\\/]\.kilo[\\/]|[\\/]\.archive[\\/]|[\\/]\.local[\\/]|[\\/]\.session[\\/]|[\\/]build[\\/]/;

// Fragmentos que provienen de template literals dinámicos (no son clases reales).
const DYNAMIC_FRAGMENT = /^gv-[a-z0-9-]*-$/;

export interface UndefinedClassesResult {
  defined: number;
  used: number;
  missing: Array<{ cls: string; files: string[] }>;
}

function walk(dir: string, ext: RegExp, out: string[] = []): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const p = join(dir, name);
    if (EXCLUDE.test(p)) continue;
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, ext, out);
    else if (ext.test(name)) out.push(p);
  }
  return out;
}

function collectDefined(): Set<string> {
  const defined = new Set<string>();
  const cssFiles = [
    ...walk(join(ROOT, 'packages', 'gv-design-system', 'dist'), /\.css$/),
    ...walk(join(ROOT, 'apps'), /\.css$/),
  ];
  for (const f of cssFiles) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\.(gv-[a-z0-9-]+)/g)) defined.add(m[1]);
  }
  return defined;
}

function collectUsed(): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  const tsxFiles = walk(join(ROOT, 'apps'), /\.tsx$/);
  for (const f of tsxFiles) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
      const raw = m[1] ?? m[2] ?? '';
      for (const cls of raw.split(/[\s${}()?:'"`]+/)) {
        if (/^gv-[a-z0-9-]+$/.test(cls)) {
          let set = used.get(cls);
          if (!set) {
            set = new Set<string>();
            used.set(cls, set);
          }
          set.add(relative(ROOT, f));
        }
      }
    }
  }
  return used;
}

/** Devuelve las clases gv-* usadas en apps que no están definidas en ningún CSS. */
export function auditUndefinedClasses(): UndefinedClassesResult {
  const defined = collectDefined();
  const used = collectUsed();
  const missing = [...used.entries()]
    .filter(([cls]) => !defined.has(cls) && !DYNAMIC_FRAGMENT.test(cls))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cls, files]) => ({ cls, files: [...files] }));
  return { defined: defined.size, used: used.size, missing };
}

function main(): void {
  const jsonMode = process.argv.includes('--json');
  const result = auditUndefinedClasses();

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `[audit-undefined-classes] definidas: ${result.defined} | usadas: ${result.used} | faltantes: ${result.missing.length}`,
    );
    for (const { cls, files } of result.missing) {
      console.log(`  ✗ ${cls}  (${files.join(', ')})`);
    }
    if (result.missing.length === 0) console.log('  ✅ Todas las clases gv-* usadas están definidas');
  }

  process.exit(result.missing.length > 0 ? 1 : 0);
}

// Ejecutar sólo si se invoca directamente (no al importar desde el watchtower).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
