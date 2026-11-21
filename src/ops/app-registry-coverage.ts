#!/usr/bin/env node
/**
 * apps-registry-coverage — toda carpeta de `apps/` está registrada o excluida
 * con motivo. Cierra el drift "31 directorios vs 28 registrados": antes una
 * app nueva se agregaba al repo y nadie se enteraba de que faltaba en el
 * registro único (`config/apps.registry.json`).
 *
 * Uso:
 *   npm run apps:registry:check          # tabla + exit 1 si hay drift
 *   npm run apps:registry:check -- --json
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface ExclusionsFile {
  excluded?: Array<{ dir: string; kind?: string; reason?: string }>;
}

export interface CoverageReport {
  registered: number;
  excluded: number;
  uncovered: string[];
  missingDirs: string[];
  overlaps: string[];
  staleExclusions: string[];
}

const norm = (dir: string): string => dir.replace(/\\/g, '/').replace(/\/+$/, '');

export function checkCoverage(root: string): CoverageReport {
  const registry = JSON.parse(readFileSync(join(root, 'config', 'apps.registry.json'), 'utf8')) as {
    apps?: Array<{ dir?: string }>;
  };
  const exclusionsPath = join(root, 'config', 'apps.registry-exclusions.json');
  const exclusions: ExclusionsFile = existsSync(exclusionsPath)
    ? (JSON.parse(readFileSync(exclusionsPath, 'utf8')) as ExclusionsFile)
    : {};

  const registered = new Set((registry.apps ?? []).map((a) => norm(a.dir ?? '')).filter(Boolean));
  const excluded = new Set((exclusions.excluded ?? []).map((e) => norm(e.dir)).filter(Boolean));
  const dirs = readdirSync(join(root, 'apps'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => `apps/${e.name}`);

  const uncovered = dirs.filter((d) => !registered.has(d) && !excluded.has(d));
  const missingDirs = [...registered, ...excluded].filter((d) => !existsSync(join(root, d)));
  const overlaps = [...registered].filter((d) => excluded.has(d));
  const staleExclusions = [...excluded].filter((d) => registered.has(d));

  return {
    registered: registered.size,
    excluded: excluded.size,
    uncovered,
    missingDirs,
    overlaps,
    staleExclusions,
  };
}

function main(): void {
  const root = resolve(process.cwd());
  const report = checkCoverage(root);
  const ok =
    report.uncovered.length === 0 &&
    report.missingDirs.length === 0 &&
    report.overlaps.length === 0;
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ok, ...report }, null, 2));
  } else {
    console.log(
      `[apps-registry] ${report.registered} registradas · ${report.excluded} excluidas con motivo`,
    );
    for (const dir of report.uncovered)
      console.log(
        `  ERROR: ${dir} no está registrada ni excluida (agregar al registro o a exclusions)`,
      );
    for (const dir of report.missingDirs) console.log(`  ERROR: ${dir} declarada pero no existe`);
    for (const dir of report.overlaps)
      console.log(`  ERROR: ${dir} registrada Y excluida a la vez`);
    for (const dir of report.staleExclusions)
      console.log(`  WARN: ${dir} figura como exclusión obsoleta (ya está registrada)`);
    if (ok) console.log('  OK: cobertura completa');
  }
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
