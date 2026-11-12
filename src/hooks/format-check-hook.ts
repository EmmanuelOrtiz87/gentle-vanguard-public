#!/usr/bin/env node

/**
 * format-check-hook.ts — pre-commit: nointroducir deuda de formato.
 *
 * POR QUÉ ES UNA REGLA DE NO-REGRESIÓN (2026-11-11)
 * -------------------------------------------------------------------------
 * `config/quality-gates.json` declaraba `pre-commit-format` con
 * `enforced: true` desde hacía meses y NADIE lo ejecutaba: el catálogo era
 * aspiracional. Al cablearlo de verdad apareció el problema de fondo: el repo
 * tiene `.prettierrc` (singleQuote, printWidth 100, semi) pero CIENTOS de
 * archivos no lo cumplen. Un gate que exige "todo el repo formateado" no
 * puede ser bloqueante: bloquearía todos los commits del owner.
 *
 * La regla que sí es honesta y sí es útil:
 *
 *   · Un archivo que YA estaba formateado no puede dejar de estarlo.
 *   · Un archivo NUEVO tiene que salir formateado.
 *   · Un archivo que ya estaba fuera de formato (deuda heredada) no bloquea:
 *     se reporta, pero no se le exige al owner que reformatee el repo entero
 *     en un commit ajeno.
 *
 * Eso convierte un guardrail de mentira en un guardrail real: el contador de
 * archivos fuera de formato sólo puede BAJAR, nunca subir.
 *
 * USO (lo invoca lefthook)
 *   node --import tsx src/hooks/format-check-hook.ts
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');

/** Extensiones que prettier sabe formatear (subset del glob de `format:check`). */
const PRETTIER_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.html',
  '.css',
]);

export interface StagedFile {
  path: string;
  /** Contenido en el índice (lo que se va a commitear). */
  staged: string;
  /** Contenido en HEAD (null si el archivo es nuevo). */
  head: string | null;
}

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function stagedFiles(): StagedFile[] {
  const names = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const out: StagedFile[] = [];
  for (const name of names) {
    const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
    if (!PRETTIER_EXT.has(ext)) continue;
    const abs = resolve(ROOT, name);
    if (!existsSync(abs)) continue;
    let staged = '';
    try {
      staged = git(['show', `:${name}`]);
    } catch {
      continue;
    }
    let head: string | null = null;
    try {
      head = git(['show', `HEAD:${name}`]);
    } catch {
      head = null;
    }
    out.push({ path: name, staged, head });
  }
  return out;
}

export type FormatStatus = 'ok' | 'ignored' | 'legacy' | 'violation';

export interface FormatVerdict {
  path: string;
  status: FormatStatus;
  reason?: string;
}

/**
 * La decisión, separada del `git` para que sea testeable sin repo.
 *
 * REGLAS
 *  · `ignored`   → prettier lo ignora (.prettierignore): no se le exige nada.
 *  · `ok`        → el contenido staged está formateado.
 *  · `legacy`    → ya estaba fuera de formato en HEAD: se informa, no bloquea.
 *  · `violation` → archivo nuevo sin formatear, o uno que estaba formateado y
 *                   dejó de estarlo: BLOQUEA.
 */
export async function evaluateFile(
  file: StagedFile,
  prettier: typeof import('prettier'),
  root: string = ROOT,
): Promise<FormatVerdict> {
  const abs = resolve(root, file.path);
  try {
    const info = await prettier.getFileInfo(abs, { ignorePath: join(root, '.prettierignore') });
    if (info.ignored) return { path: file.path, status: 'ignored' };
  } catch {
    /* sin .prettierignore: se sigue con la comprobación normal */
  }
  // La config se resuelve EXPLICITAMENTE: con sólo `filepath`, esta versión
  // de prettier no carga el .prettierrc del repo y el gate mediría con la
  // config por defecto (comillas dobles) → todo el repo "no formateado".
  const resolved = (await prettier.resolveConfig(abs)) ?? {};
  const options = { ...resolved, filepath: abs };
  if (await prettier.check(file.staged, options)) return { path: file.path, status: 'ok' };
  if (file.head === null) {
    return {
      path: file.path,
      status: 'violation',
      reason: 'archivo nuevo: tiene que salir formateado',
    };
  }
  if (await prettier.check(file.head, options)) {
    return {
      path: file.path,
      status: 'violation',
      reason: 'estaba formateado y dejó de estarlo',
    };
  }
  return { path: file.path, status: 'legacy' };
}

async function main(): Promise<number> {
  let prettier: typeof import('prettier');
  try {
    const mod = (await import('prettier')) as typeof import('prettier');
    // prettier es un módulo con default export: sin tomar el default, las
    // funciones (getFileInfo, resolveConfig) no están y el gate mediría mal.
    prettier = ((mod as unknown as { default?: typeof import('prettier') }).default ??
      mod) as typeof import('prettier');
  } catch {
    console.log('[format-check] prettier no está instalado: gate omitido (no silencioso).');
    return 0;
  }

  let files: StagedFile[];
  try {
    files = stagedFiles();
  } catch (err) {
    console.log(`[format-check] no se pudo leer el índice: ${(err as Error).message}`);
    return 0;
  }
  if (files.length === 0) {
    console.log('[OK] Nada staged para formatear.');
    return 0;
  }

  const verdicts: FormatVerdict[] = [];
  for (const file of files) verdicts.push(await evaluateFile(file, prettier));

  const violations = verdicts.filter((v) => v.status === 'violation');
  const legacy = verdicts.filter((v) => v.status === 'legacy');
  const ignored = verdicts.filter((v) => v.status === 'ignored');

  for (const v of legacy) {
    console.log(`[info] ${v.path} ya estaba fuera de formato (deuda heredada): no bloquea.`);
  }
  for (const v of ignored) {
    console.log(`[info] ${v.path} está en .prettierignore: el formato no se gobierna acá.`);
  }

  if (violations.length === 0) {
    console.log(`[OK] ${files.length} archivo(s) staged: sin regresión de formato.`);
    return 0;
  }

  console.log('[FAIL] Formato:');
  for (const v of violations) console.log(`  · ${v.path} — ${v.reason}`);
  console.log('  Arreglo: npm run format:fix   (o: npx prettier --write <archivo>)');
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(
    (code) => {
      process.exit(code);
    },
    (err) => {
      console.error(`[format-check] FATAL: ${(err as Error).message}`);
      process.exit(2);
    },
  );
}
