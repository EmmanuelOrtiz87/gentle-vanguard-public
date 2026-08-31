#!/usr/bin/env node
/**
 * auto-url-fix.ts — Fix sistémico del guard de ejecución CLI en Windows.
 *
 * Problema: 32+ archivos usan `import.meta.url === \`file://${process.argv[1]}\``
 * que NO normaliza las rutas Windows (backslashes). En win32 process.argv[1]
 * llega como `C:\path\file.ts` pero import.meta.url es `file:///C:/path/file.ts`
 * (forward slashes + triple slash) → la comparación nunca coincide → main() NUNCA
 * se ejecuta → los CLIs son no-ops silenciosos.
 *
 * Fix: reemplazar por `process.argv[1] && import.meta.url ===
 * pathToFileURL(process.argv[1]).href` y añadir el import de pathToFileURL.
 *
 * Uso:
 *   npx tsx src/tools/auto-url-fix.ts --dry-run   # mostrar qué se arreglaría
 *   npx tsx src/tools/auto-url-fix.ts             # aplicar fixes
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, relative, resolve } from 'path';

const ROOT = resolve(process.cwd());
const SRC = join(ROOT, 'src');
const DRY_RUN = process.argv.includes('--dry-run');

// Patrones rotos a reemplazar (comparación directa de strings, sin normalizar)
const BROKEN_PATTERNS = [/import\.meta\.url === `file:\/\/\$\{process\.argv\[1\]\}`/g];

// Patrón correcto con guard
const FIX = `process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href`;

// Import de pathToFileURL: 'node:url' o 'url' (ambos válidos en ESM)
const IMPORT_RE = /^import\s+[^;]+from\s+'(node:)?url'/m;

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function needsFix(content: string): boolean {
  const hasBroken = BROKEN_PATTERNS.some((re) => re.test(content));
  // También: usa pathToFileURL sin haberlo importado (resultado de un fix previo sin import)
  const usesPathToFileURL = /pathToFileURL\(/.test(content);
  const missingImport = usesPathToFileURL && !hasPathToFileURLImport(content);
  return hasBroken || missingImport;
}

function hasPathToFileURLImport(content: string): boolean {
  // Solo mira la sección de imports (líneas que empiezan con 'import')
  const importSection = content
    .split('\n')
    .filter((l) => l.startsWith('import ') || l.startsWith('import{'))
    .join('\n');
  return /pathToFileURL/.test(importSection);
}

function hasAnyUrlImport(content: string): boolean {
  return IMPORT_RE.test(content) || /from 'url'/.test(content) || /from 'node:url'/.test(content);
}

function applyFix(content: string): string {
  let out = content;
  for (const re of BROKEN_PATTERNS) {
    out = out.replace(re, FIX);
  }
  // Añadir import de pathToFileURL si no existe
  if (!hasPathToFileURLImport(out)) {
    const importLine = "import { pathToFileURL } from 'url';";
    if (hasAnyUrlImport(out)) {
      // Ya hay un import de url — añadir pathToFileURL a la lista existente
      out = out.replace(IMPORT_RE, (m) => {
        if (m.includes('pathToFileURL')) return m;
        const braceIdx = m.indexOf('{');
        const closeIdx = m.indexOf('}');
        if (braceIdx !== -1 && closeIdx !== -1) {
          const inner = m.slice(braceIdx + 1, closeIdx).trim();
          return m.slice(0, braceIdx + 1) + ' ' + inner + ', pathToFileURL ' + m.slice(closeIdx);
        }
        return importLine + '\n' + m;
      });
    } else {
      // Insertar tras el primer import
      const lines = out.split('\n');
      let insertAt = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('import ')) {
          insertAt = i + 1;
          break;
        }
      }
      lines.splice(insertAt, 0, importLine);
      out = lines.join('\n');
    }
  }
  return out;
}

function main(): void {
  const files = collectTsFiles(SRC);
  let fixed = 0;

  console.log(
    `auto-url-fix ${DRY_RUN ? '(dry-run)' : '(apply)'} — scanning ${files.length} TS files`,
  );

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (!needsFix(content)) continue;

    const newContent = applyFix(content);
    const rel = relative(ROOT, file);

    if (DRY_RUN) {
      console.log(`  would fix: ${rel}`);
      fixed++;
      continue;
    }

    writeFileSync(file, newContent, 'utf8');
    console.log(`  fixed: ${rel}`);
    fixed++;
  }

  console.log(`\nDone: ${fixed} file(s) fixed`);
}

void main();
