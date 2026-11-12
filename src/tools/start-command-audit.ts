#!/usr/bin/env node

/**
 * start-command-audit.ts — todo comando de arranque tiene que apuntar a un
 * archivo que EXISTE.
 *
 * POR QUÉ EXISTE (2026-11-11)
 * -------------------------------------------------------------------------
 * El `start.sh` de `sandbox-gv` llamaba a `src/cli/gv.ts`, un módulo que no
 * existía: la app no arrancaba y nadie lo notó, porque el Command Center la
 * arrancaba por su cuenta (por el panel "funcionaba"). Dos caminos para
 * prender la misma app pueden divergir en silencio, y el que falla es el que
 * nadie mira.
 *
 * Este gate es el detector de esa clase:
 *
 *   · Escanea los scripts de arranque del stack (`start.sh`, `start.ts`,
 *     `run.ts`, `serve*`) y el registro del Command Center.
 *   · Ignora COMENTARIOS (un ejemplo en la cabecera no es un comando).
 *   · Acepta que un `.js` tenga un hermano `.ts` (se compila en runtime).
 *   · Ignora rutas generadas en runtime (`node_modules/`, `.runtime/`).
 *   · Falla cuando la referencia no resuelve a ningún archivo.
 *
 * USO
 *   node --import tsx src/tools/start-command-audit.ts
 *   node --import tsx src/tools/start-command-audit.ts --json
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');

/** Nombres de archivo que son scripts de arranque/parada. */
const LAUNCHER_NAME = /^(start|stop|run|serve|launch|dev)[.-]/;

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.runtime']);

export interface BrokenReference {
  file: string;
  reference: string;
  line: number;
  tried: string[];
}

/** Quita comentarios: en shell (#) y en TS/JS (// y de bloque). */
export function stripComments(text: string, extension: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end >= 0) {
        inBlock = false;
        out.push(line.slice(end + 2));
      } else {
        out.push('');
      }
      continue;
    }
    if (extension === '.sh' || extension === '.ps1') {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) {
        out.push('');
        continue;
      }
      out.push(line);
      continue;
    }
    const blockStart = line.indexOf('/*');
    const blockEnd = line.indexOf('*/');
    if (blockStart >= 0 && blockEnd > blockStart) {
      out.push(line.slice(0, blockStart));
      continue;
    }
    if (blockStart >= 0) {
      inBlock = true;
      out.push(line.slice(0, blockStart));
      continue;
    }
    out.push(line.replace(/\/\/.*$/, ''));
  }
  return out.join('\n');
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as never;
  } catch {
    return out;
  }
  for (const entry of entries as unknown as Array<{ name: string; isDirectory(): boolean }>) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!LAUNCHER_NAME.test(entry.name)) continue;
    if (!/\.(sh|ts|mts|mjs|js|ps1)$/i.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

/** ¿Existe el archivo, o un hermano con otra extensión (.js ← .ts)? */
function resolvesToFile(candidate: string): boolean {
  if (existsSync(candidate) && statSync(candidate).isFile()) return true;
  const dot = candidate.lastIndexOf('.');
  if (dot < 0) return false;
  const stem = candidate.slice(0, dot);
  for (const ext of ['.ts', '.mts', '.mjs', '.js', '.cjs']) {
    if (existsSync(`${stem}${ext}`) && statSync(`${stem}${ext}`).isFile()) return true;
  }
  return false;
}

export function auditStartCommands(root = ROOT): {
  broken: BrokenReference[];
  ambiguous: BrokenReference[];
  buildArtifacts: BrokenReference[];
} {
  const broken: BrokenReference[] = [];
  const ambiguous: BrokenReference[] = [];
  const buildArtifacts: BrokenReference[] = [];
  const appsDir = join(root, 'apps');
  const files = walk(appsDir);

  // El registro del Command Center vive en `apps/command-center/server.ts`:
  // sus campos `server:`/`client:` son comandos de arranque y tienen que
  // resolver igual que los de un start.sh. Sus rutas son relativas al
  // directorio de CADA app (que el registro no declara: por eso se resuelven
  // contra todas las apps y se acepta la que exista).
  const ccRegistry = join(appsDir, 'command-center', 'server.ts');
  if (existsSync(ccRegistry)) files.push(ccRegistry);
  const appDirs: string[] = [];
  try {
    for (const entry of readdirSync(appsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name))
        appDirs.push(join(appsDir, entry.name));
    }
  } catch {
    /* best effort */
  }

  const pathToken = /(?:^|[\s'"`=])([A-Za-z0-9_][\w./-]*\.(?:ts|mts|mjs|js|cjs|sh))/g;

  for (const file of files) {
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const ext = file.slice(file.lastIndexOf('.'));
    const code = stripComments(raw, ext);
    const dir = file.slice(
      0,
      file.lastIndexOf('\\') === -1 ? file.lastIndexOf('/') : file.lastIndexOf('\\'),
    );
    const appDir = dir.slice(0, Math.max(dir.lastIndexOf('/'), dir.lastIndexOf('\\')));
    const rel = relative(root, file).replace(/\\/g, '/');

    code.split('\n').forEach((line, index) => {
      for (const match of line.matchAll(pathToken)) {
        const ref = match[1];
        if (ref.startsWith('node_modules/') || ref.startsWith('.runtime/')) continue;
        if (!ref.includes('/') && !ref.startsWith('.')) continue;
        // Artefactos de BUILD: no son código fuente (existen sólo después de
        // compilar). Se reportan aparte: son el caso "la app necesita build".
        if (/(^|\/)dist\//.test(ref)) {
          buildArtifacts.push({ file: rel, reference: ref, line: index + 1, tried: [] });
          continue;
        }
        const candidates = [resolve(dir, ref), resolve(appDir, ref)];
        // Una ruta que empieza por apps/, tools/, scripts/ es relativa a la
        // RAÍZ del repo: se resuelve contra la raíz.
        const repoPrefixed = /^(apps|tools|scripts)\//.test(ref);
        if (rel.endsWith('command-center/server.ts')) {
          // Ruta relativa a la APP que registra: se resuelve dentro de las
          // apps. Si resuelve SÓLO en la raíz del repo, es ambigua: el error
          // se esconde (el `src/cli/gv.ts` de sandbox-gv resolvía contra el
          // CLI de la raíz y nadie lo veía).
          for (const candidate of appDirs) {
            candidates.push(
              resolve(candidate, ref),
              resolve(candidate, 'src', ref.replace(/^(\.\/)?src\//, '')),
            );
          }
          const inApp = candidates.slice(2).some(resolvesToFile);
          if (inApp) continue;
          const atRoot = resolvesToFile(resolve(root, ref));
          if (atRoot && repoPrefixed) continue;
          if (atRoot) {
            ambiguous.push({
              file: rel,
              reference: ref,
              line: index + 1,
              tried: [relative(root, resolve(root, ref)).replace(/\\/g, '/')],
            });
            continue;
          }
        } else {
          candidates.push(
            resolve(appDir, 'src', ref.replace(/^(\.\/)?src\//, '')),
            resolve(root, ref),
          );
          if (candidates.some(resolvesToFile)) continue;
        }
        if (candidates.some(resolvesToFile)) {
          if (process.env['GV_DEBUG_START']) {
            console.error(
              `[debug] ${rel} ref=${ref} resuelto por: ${candidates.filter(resolvesToFile).join(' | ')}`,
            );
          }
          continue;
        }
        broken.push({
          file: rel,
          reference: ref,
          line: index + 1,
          tried: candidates.map((c) => relative(root, c).replace(/\\/g, '/')),
        });
      }
    });
  }
  return { broken, ambiguous, buildArtifacts };
}

function main(): void {
  const asJson = process.argv.includes('--json');
  const { broken, ambiguous, buildArtifacts } = auditStartCommands();
  if (asJson) {
    console.log(
      JSON.stringify({ ok: broken.length === 0, broken, ambiguous, buildArtifacts }, null, 2),
    );
    process.exit(broken.length === 0 ? 0 : 1);
  }
  console.log(`[start-command-audit] referencias rotas: ${broken.length}`);
  for (const b of broken) {
    console.log(`  · ${b.file}:${b.line} → ${b.reference}`);
    console.log(`      probó: ${b.tried.join(' | ')}`);
  }
  for (const a of ambiguous) {
    console.log(`  AMBIGUA: ${a.file}:${a.line} → ${a.reference}`);
    console.log(
      `      resuelve sólo en la raíz del repo (${a.tried.join(' | ')}): no apunta a la app que la registra`,
    );
  }
  if (buildArtifacts.length > 0) {
    console.log(
      `  (${buildArtifacts.length} comando(s) arrancan un artefacto de build: existen sólo después de compilar)`,
    );
    for (const b of buildArtifacts) console.log(`    · ${b.file}:${b.line} → ${b.reference}`);
  }
  if (broken.length === 0) console.log('  OK: todo comando de arranque apunta a un archivo real');
  process.exit(broken.length === 0 ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
