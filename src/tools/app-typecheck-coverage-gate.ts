#!/usr/bin/env node

/**
 * app-typecheck-coverage-gate.ts — El typecheck de una app debe cubrir TODO
 * su codigo, no solo una parte.
 *
 * POR QUE EXISTE (2026-11-03)
 * `apps/wpp-bot` era la UNICA app del stack cuyo script `typecheck` usaba
 * `tsconfig.build.json` (que excluye `tests/` y `scripts/`). Las otras 12
 * usaban el `tsconfig.json` completo. Consecuencia: el codigo de tests y
 * scripts de wpp-bot no lo verificaba NADIE — el typecheck completo daba 21
 * errores que nadie veia, yendoyears mas tarde aparecio como "codigo roto"
 * en un script de exportacion.
 *
 * El bug es silencioso: `npm run typecheck` pasa (verde) mientras deja sin
 * verificar la mitad de la app. Eso es peor que un typecheck roto, porque
 * el verde da una confianza que no esta.
 *
 * QUE CHEQUEA
 *   Para cada app en `apps/*` con script `typecheck`:
 *     - si el comando no pasa `-p/--project`, usa el `tsconfig.json` de la
 *       app -> OK (cubre todo lo que el tsconfig de la app declare).
 *     - si pasa `-p <otro>`, ese tsconfig NO puede tener un `include` mas
 *       restrictivo que el `tsconfig.json` de la app -> si lo tiene, ERROR.
 *
 *   Solo se mira el `include`: es la parte que decide que archivos entran al
 *   programa de compilacion. El `exclude` se reporta aparte como AVISO,
 *   porque excluir tests a proposito es legitimo.
 *
 * USO
 *   node --import tsx src/tools/app-typecheck-coverage-gate.ts
 *   node --import tsx src/tools/app-typecheck-coverage-gate.ts --json
 *   node --import tsx src/tools/app-typecheck-coverage-gate.ts --root DIR
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type Severity = 'error' | 'warn';

export interface CoverageFinding {
  rule: string;
  severity: Severity;
  app: string;
  message: string;
  fix: string;
}

export interface CoverageReport {
  ok: boolean;
  errors: number;
  warnings: number;
  apps: number;
  findings: CoverageFinding[];
}

interface TsConfigLike {
  extends?: string;
  include?: string[];
  exclude?: string[];
}

/**
 * Excludes triviales: excluir node_modules/dist/coverage es el exclude de
 * siempre y no dice nada sobre cobertura de codigo.
 */
const TRIVIAL_EXCLUDES = new Set([
  'node_modules',
  'dist',
  'coverage',
  'build',
  'out',
  '.next',
  'target',
]);

/** Lee un tsconfig (sin resolver `extends`: alcanza para comparar includes). */
export function readTsConfig(path: string): TsConfigLike | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8')
      // Tolera comentarios JSONC y trailing commas (tsconfig lo permite).
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(raw) as TsConfigLike;
  } catch {
    return null;
  }
}

/**
 * El tsconfig que usa el comando `typecheck`, o null si usa el de la app.
 * Un comando sin `-p` usa el `tsconfig.json` del directorio actual.
 */
export function projectUsedBy(command: string): string | null {
  const m = /(?:^|\s)(?:-p|--project)(?:=|\s+)("[^"]+"|'[^']+'|[^\s]+)/.exec(command);
  if (!m) return null;
  const raw = m[1].replace(/^["']|["']$/g, '');
  if (!raw || raw.startsWith('-')) return null;
  return raw;
}

/**
 * Un `include` es mas restrictivo si declara menos directorios de codigo.
 *
 * Se comparan como CONJUNTOS DE DIRECTORIOS DE PRIMER NIVEL: un patron
 * "src" (o "src" seguido de globs) cubre el directorio "src"; un patron
 * "**" cubre todo. No hace falta un motor de glob: lo que importa es si el
 * directorio con codigo entra o no.
 */
export function coveredDirs(include: string[] | undefined): Set<string> {
  const dirs = new Set<string>();
  if (!include || include.length === 0) return dirs;
  for (const pattern of include) {
    const clean = pattern.replace(/^\.\//, '').replace(/\/+$/, '');
    if (clean === '**' || clean === '**/*') return new Set<string>(['*']);
    const head = clean.split('/')[0];
    if (head && head !== '**' && !head.includes('*')) dirs.add(head);
  }
  return dirs;
}

/** Directorios de primer nivel de la app que contienen codigo .ts. */
export function codeDirs(appDir: string): string[] {
  const SKIP = new Set(['node_modules', 'dist', 'coverage', 'data', '.runtime', '.next', 'build']);
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = readdirSync(appDir, { withFileTypes: true }) as never;
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries as unknown as Array<{ name: string; isDirectory(): boolean }>) {
    if (!entry.isDirectory() || SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
    if (hasTsFiles(join(appDir, entry.name))) out.push(entry.name);
  }
  return out.sort();
}

function hasTsFiles(dir: string, depth = 0): boolean {
  if (depth > 3) return false;
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as never;
  } catch {
    return false;
  }
  for (const entry of entries as unknown as Array<{ name: string; isDirectory(): boolean }>) {
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      if (hasTsFiles(join(dir, entry.name), depth + 1)) return true;
      continue;
    }
    if (/\.(ts|mts|cts)$/.test(entry.name)) return true;
  }
  return false;
}

export function defaultRoot(): string {
  return join(import.meta.dirname ?? '.', '..', '..');
}

/** Corre el gate sobre una raiz del repo. */
export function checkTypecheckCoverage(root: string): CoverageReport {
  const findings: CoverageFinding[] = [];
  const appsDir = join(root, 'apps');
  let appNames: string[] = [];
  try {
    appNames = readdirSync(appsDir, { withFileTypes: true })
      .filter((d: { isDirectory(): boolean; name: string }) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d: { name: string }) => d.name)
      .sort();
  } catch {
    return { ok: true, errors: 0, warnings: 0, apps: 0, findings };
  }

  for (const app of appNames) {
    const appDir = join(appsDir, app);
    const pkgPath = join(appDir, 'package.json');
    if (!existsSync(pkgPath)) continue;
    let scripts: Record<string, string> = {};
    try {
      scripts = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};
    } catch {
      continue;
    }
    const command = scripts['typecheck'];
    if (typeof command !== 'string' || !command.trim()) continue;

    const project = projectUsedBy(command);
    if (!project) continue; // usa el tsconfig.json de la app: cubre todo lo declarado

    const usedPath = resolve(appDir, project);
    const used = readTsConfig(usedPath);
    if (!used) {
      findings.push({
        rule: 'typecheck/missing-project',
        severity: 'error',
        app,
        message: `el typecheck apunta a un tsconfig que no existe: ${project}`,
        fix: 'corregir el script typecheck',
      });
      continue;
    }

    const rootCfg = readTsConfig(join(appDir, 'tsconfig.json'));
    const usedDirs = coveredDirs(used.include);
    const rootDirs = coveredDirs(rootCfg?.include);
    const dirs = codeDirs(appDir);

    // 1) Codigo que existe en disco y el tsconfig usado NO cubre.
    //    Es el hallazgo mas fuerte: hay .ts que nadie verifica.
    const uncovered = dirs.filter((d) => {
      if (usedDirs.has('*')) return false;
      if (usedDirs.has(d)) return false;
      // Hereda del tsconfig base (extends): entonces no lo restringe.
      if (used.extends && !used.include) return false;
      return true;
    });

    const reported = new Set<string>();

    for (const d of uncovered) {
      reported.add(d);
      findings.push({
        rule: 'typecheck/uncovered-code',
        severity: 'error',
        app,
        message: `el typecheck usa ${project} y no verifica el codigo de "${d}/"`,
        fix: `apuntar el typecheck al tsconfig.json de la app, o ampliar el include de ${project}`,
      });
    }

    // 2) El tsconfig usado declara menos directorios que el de la app.
    //    Aporta el caso en que el codigo todavia no existe pero el tsconfig
    //    ya dejo de cubrirlo: es la promesa de cobertura que se rompe.
    if (used.include && rootDirs.size > 0 && !usedDirs.has('*')) {
      const missingVsRoot = [...rootDirs].filter((d) => !usedDirs.has(d) && !reported.has(d));
      for (const d of missingVsRoot) {
        reported.add(d);
        findings.push({
          rule: 'typecheck/partial-coverage',
          severity: 'error',
          app,
          message:
            `el typecheck usa ${project} (include: ${used.include.join(', ')}) y deja sin verificar ` +
            `el codigo de "${d}/" que el tsconfig.json de la app si cubria`,
          fix: `apuntar el typecheck al tsconfig.json de la app, o ampliar el include de ${project}`,
        });
      }
    }

    // Aviso (no error): excluir tests a proposito es legitimo.
    // Solo interesa si el exclude toca codigo REAL de la app: excluir
    // node_modules/dist/coverage es el exclude de siempre y no dice nada.
    const meaningful = (used.exclude ?? []).filter((pattern) => {
      const head = pattern.replace(/^\.\//, '').split('/')[0];
      return !TRIVIAL_EXCLUDES.has(head);
    });
    if (meaningful.length > 0) {
      findings.push({
        rule: 'typecheck/excluded',
        severity: 'warn',
        app,
        message: `${project} excluye: ${meaningful.join(', ')}`,
        fix: 'revisar que lo excluido no tenga codigo sin verificar de otra forma',
      });
    }
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warn').length;
  return { ok: errors === 0, errors, warnings, apps: appNames.length, findings };
}

function main(): void {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 && argv[rootIdx + 1] ? argv[rootIdx + 1] : defaultRoot();

  const report = checkTypecheckCoverage(root);

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `app-typecheck-coverage-gate -> ${report.apps} apps, ${report.errors} errores, ${report.warnings} avisos`,
    );
    for (const f of report.findings) {
      console.log(`  ${f.severity === 'error' ? 'ERR ' : 'WARN'} ${f.rule} ${f.app}: ${f.message}`);
      console.log(`       fix: ${f.fix}`);
    }
    if (report.ok) console.log('  OK: el typecheck de cada app cubre todo su codigo');
  }

  if (!report.ok) {
    console.error(
      'app-typecheck-coverage-gate -> FAIL: alguna app verifica solo una parte de su codigo. ' +
        'El typecheck verde con codigo sin verificar es peor que un typecheck roto.',
    );
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
