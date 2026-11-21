/**
 * orphan-module-gate.ts — Los módulos sin consumidores no deberían existir.
 *
 * Mandato del owner (2026-11-18): "no podemos tener cosas obsoletas, temporales,
 * ni que ocupan espacio sin sentido". Este gate detecta módulos TS de src/ que
 * NADIE importa ni referencia (cero importers en src/, scripts/, tests/,
 * config/ y package.json). El caso medido: src/core/session-orchestrator.ts
 * (188 líneas muertas, eliminado en e888a95f6).
 *
 * USO:
 *   npm run orphans:check            # advisory: reporta, exit 0 siempre
 *   npm run orphans:check -- --strict # exit 1 si hay huérfanos (para CI/futuro)
 *
 * Reglas de exclusión (entry points legítimos sin importers):
 *   - *.test.ts / *.d.ts
 *   - archivos src/cli/ y src/session/session-autostart*.ts (entry points)
 *   - basenames referenciados en package.json, config/*.json vivo, .lefthook.yml,
 *     hosts de herramientas, CI y READMEs de src/ y apps/
 *   - los aceptados explícitamente en ORPHAN_ALLOWLIST (con razón declarada)
 *
 * Afinado 2026-11-20 (GB-20261120, aprobación owner): los CONFIGS DE REGISTRO
 * HISTÓRICO (HISTORICAL_CONFIG_PATTERNS) dejan de contar como consumidores.
 * Caso medido: 5 wrappers muertos de src/orchestration sobrevivieron meses porque
 * el tracker ps1→TS (config/ps1-ts-migration.json) los nombraba en sus olas
 * completadas — mencionar un módulo en un log de migración NO es consumirlo.
 * docs/ NUNCA contó (el comentario de esta cabecera lo afirmaba y era falso);
 * este comentario ahora dice la verdad del código.
 *
 * Es advisory por defecto: promoverlo a gate enforced es decisión del owner
 * (no se cambian guardrails sin aprobación explícita).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();

/** Huérfanos aceptados con razón declarada — cada entrada necesita justificación.
 *  (vacía por diseño: si agregás uno, declará por qué el módulo vive sin uso.
 *  pre-process-input-cached.ts estuvo acá hasta que la medición decidió su
 *  eliminación: 6 consumidores del base, todos one-shot de baja frecuencia —
 *  una capa de caché sin hit-rate medido es especulación, no capacidad.) */
const ORPHAN_ALLOWLIST: ReadonlyArray<{ module: string; reason: string }> = [];

/** Configs cuyo contenido es registro histórico: nombrar un módulo en un log de
 *  olas completadas NO es consumirlo. Cada patrón lleva su razón. */
const HISTORICAL_CONFIG_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /ps1-ts-migration\.json$/,
    reason: 'tracker de olas ps1→TS (audit-ps1-refs lo lee para .ps1, no para módulos TS)',
  },
];

function listTsFiles(current: string, out: string[] = []): string[] {
  return listTsFiltered(current, out, false);
}

/** all=true incluye *.test.ts (para el índice de CONSUMIDORES: un test que
 *  importa el módulo es un consumidor real). all=false lista candidatos. */
function listTsFiltered(current: string, out: string[], all: boolean): string[] {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) listTsFiltered(path, out, all);
    else if (
      entry.isFile() &&
      extname(entry.name) === '.ts' &&
      !entry.name.endsWith('.d.ts') &&
      (all || !entry.name.endsWith('.test.ts'))
    ) {
      out.push(path);
    }
  }
  return out;
}

/** Índice de "menciones de importación": contenido concatenado de los consumidores. */
function consumerIndex(root: string): string {
  const consumers: string[] = [];
  for (const dir of ['src', 'scripts', 'tests']) {
    const abs = join(root, dir);
    if (existsSync(abs)) consumers.push(...listTsFiltered(abs, [], true));
  }
  const configDir = join(root, 'config');
  const configFiles = existsSync(configDir)
    ? readdirSync(configDir)
        .filter((f) => f.endsWith('.json'))
        // Los registros históricos no son consumidores (GB-20261120).
        .filter((f) => !HISTORICAL_CONFIG_PATTERNS.some((h) => h.pattern.test(f)))
        .map((f) => join(configDir, f))
    : [];
  // Configs fuera de config/: hooks y hosts que invocan módulos por nombre.
  const dotConfigs = ['.lefthook.yml', '.opencode', '.zcode', '.claude', '.agents'].flatMap((d) => {
    const abs = join(root, d);
    if (!existsSync(abs)) return [];
    if (statSync(abs).isFile()) return [abs];
    return readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => join(abs, e.name));
  });
  // CI (.github/workflows) y READMEs (CLIs manuales documentados) también son consumidores.
  const ciDir = join(root, '.github', 'workflows');
  const ciFiles = existsSync(ciDir)
    ? readdirSync(ciDir)
        .filter((f) => /\.(yml|yaml)$/.test(f))
        .map((f) => join(ciDir, f))
    : [];
  const appsDir = join(root, 'apps');
  const readmes = [
    ...listTsFiles(join(root, 'src')).map((f) => join(dirname(f), 'README.md')),
    ...(existsSync(appsDir)
      ? readdirSync(appsDir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => join(appsDir, e.name, 'README.md'))
      : []),
  ];
  const extras = [
    join(root, 'package.json'),
    ...configFiles,
    ...dotConfigs,
    ...ciFiles,
    ...new Set(readmes.filter(existsSync)),
  ];
  // Un archivo nombrado después del módulo (p. ej. tests/unit/foo.test.ts para
  // src/tools/foo.ts) es un consumidor real aunque no lo importe en su contenido.
  // Solo paths de consumidores que NUNCA son candidatos (tests/scripts/CI/configs):
  // indexar paths de src/ haría que cada módulo se auto-sume por su propia ruta.
  const neverCandidates = [
    ...consumers.filter((f) => !f.includes(`${join(root, 'src')}`)),
    ...ciFiles,
    ...extras.filter(existsSync),
  ];
  return [
    ...consumers.map((f) => readFileSync(f, 'utf8')),
    ...neverCandidates,
    ...extras.filter(existsSync).map((f) => readFileSync(f, 'utf8')),
  ].join('\n');
}

export function findOrphans(root: string = ROOT): Array<{ module: string; ageDays: number }> {
  const srcDir = join(root, 'src');
  if (!existsSync(srcDir)) return [];
  const index = consumerIndex(root).replace(/\\/g, '/');
  const orphans: Array<{ module: string; ageDays: number }> = [];

  for (const file of listTsFiles(srcDir)) {
    const rel = file.slice(root.length + 1).replace(/\\/g, '/');
    const name = basename(file, '.ts');
    // Entry points: CLIs y el autostart se invocan, no se importan.
    if (rel.startsWith('src/cli/') || /src\/session\/session-autostart/.test(rel)) continue;
    if (ORPHAN_ALLOWLIST.some((a) => a.module === rel)) continue;
    // La mención del basename en el índice de consumidores (import, require,
    // spawn de CLI, referencia de config). El path completo aparece en el propio
    // archivo, por eso se busca el basename fuera de él.
    const mentions = index.split(name).length - 1;
    if (mentions === 0) {
      const ageDays = Math.floor((Date.now() - statSync(file).mtimeMs) / 86_400_000);
      orphans.push({ module: rel, ageDays });
    }
  }
  return orphans.sort((a, b) => b.ageDays - a.ageDays);
}

function main(): void {
  const strict = process.argv.slice(2).includes('--strict');
  const orphans = findOrphans();
  if (orphans.length === 0) {
    console.log('[orphan-module-gate] 0 huérfanos — src/ sin módulos muertos');
    return;
  }
  console.log(`[orphan-module-gate] ${orphans.length} módulo(s) sin consumidores:`);
  for (const o of orphans) {
    console.log(`  - ${o.module} (${o.ageDays} días sin tocar)`);
  }
  console.log('  Acción: eliminar (git-recuperable) o declarar en ORPHAN_ALLOWLIST con razón.');
  if (strict) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
