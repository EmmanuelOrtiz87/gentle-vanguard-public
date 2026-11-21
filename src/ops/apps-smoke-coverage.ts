/**
 * apps-smoke-coverage — línea de base de la campaña de smokes e2e (P3,
 * Next Steps de la meta-auditoría 2026-11-20).
 *
 * Mide, para cada app del catálogo, si tiene verificación e2e real declarada
 * en ALGUNA de las superficies canónicas:
 *   1. script `test:e2e` / `test:smoke` en apps/<app>/package.json
 *   2. archivo de smoke/visual DENTRO de la app (smoke*, visual*, tests/*e2e*)
 *   3. smoke a nivel repo en tests/smoke/<app>* (patrón gv-music,
 *      command-center, design-gallery)
 *   4. contrato `safeLocalTestScripts` con test:e2e en
 *      config/app-validation-contracts.json
 *
 * Es REPORT, no gate: la campaña es incremental. El valor está en la cifra
 * honesta (X/28 con e2e real) y en la lista nominal de la deuda. Sin este
 * reporte, "campaña de smokes" era una frase sin línea de base.
 *
 * Uso: npm run apps:smoke:coverage  [-- --json]
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { discoverApps } from './stack-audit-apps.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const APPS_DIR = join(ROOT, 'apps');

interface AppSmokeStatus {
  app: string;
  covered: boolean;
  sources: string[];
}

/** Archivos de smoke/visual dentro de la app (excluye node_modules/dist). */
function smokeFilesInApp(app: string): string[] {
  const hits: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 4) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (/smoke|visual|e2e/i.test(entry.name) && /\.(?:mjs|cjs|ts|js)$/.test(entry.name)) {
        hits.push(full.slice(APPS_DIR.length + 1).replaceAll('\\', '/'));
      }
    }
  };
  walk(join(APPS_DIR, app), 0);
  return hits;
}

/** Smoke a nivel repo: tests/smoke/<app>* (gv-music, command-center, ...). */
function repoSmoke(app: string): string[] {
  const dir = join(ROOT, 'tests', 'smoke');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.toLowerCase().includes(app.toLowerCase()));
}

export function smokeCoverage(): { rows: AppSmokeStatus[]; withE2E: number; total: number } {
  const contractsPath = join(ROOT, 'config', 'app-validation-contracts.json');
  let contracts: Record<string, Record<string, unknown>> = {};
  try {
    const raw = JSON.parse(readFileSync(contractsPath, 'utf8')) as {
      safeLocalTestScripts?: Record<string, Record<string, unknown>>;
    };
    contracts = raw.safeLocalTestScripts ?? {};
  } catch {
    /* contrato ausente = sin fuente 4; el reporte no muere por eso */
  }

  const rows: AppSmokeStatus[] = [];
  for (const app of discoverApps()) {
    const sources: string[] = [];
    const scriptsPath = join(APPS_DIR, app, 'package.json');
    if (existsSync(scriptsPath)) {
      try {
        const pkg = JSON.parse(readFileSync(scriptsPath, 'utf8')) as {
          scripts?: Record<string, string>;
        };
        const scripts = Object.keys(pkg.scripts ?? {});
        if (scripts.some((s) => /e2e/.test(s.toLowerCase()))) sources.push('test:e2e');
        if (scripts.some((s) => /smoke/.test(s.toLowerCase()))) sources.push('test:smoke');
      } catch {
        /* package.json ilegible: no fabrica cobertura */
      }
    }
    const inApp = smokeFilesInApp(app);
    if (inApp.length > 0) sources.push(`file:${inApp[0]}`);
    const repo = repoSmoke(app);
    if (repo.length > 0) sources.push(`tests/smoke:${repo[0]}`);
    const contractScripts = Object.keys(contracts[app] ?? {});
    if (contractScripts.some((s) => /e2e|smoke/i.test(s))) {
      sources.push('safeLocalTestScripts');
    }
    rows.push({ app, covered: sources.length > 0, sources });
  }
  return {
    rows,
    withE2E: rows.filter((r) => r.covered).length,
    total: rows.length,
  };
}

function main(): void {
  const { rows, withE2E, total } = smokeCoverage();
  const json = process.argv.includes('--json');
  if (json) {
    console.log(
      JSON.stringify(
        { withE2E, total, missing: rows.filter((r) => !r.covered).map((r) => r.app), rows },
        null,
        2,
      ),
    );
    return;
  }
  console.log(`[smoke-coverage] apps con verificación e2e real: ${withE2E}/${total}`);
  console.log('');
  for (const r of rows) {
    console.log(
      `  ${r.covered ? '✓' : '·'} ${r.app.padEnd(28)} ${r.sources.join(', ') || 'SIN SMOKE (deuda de la campaña)'}`,
    );
  }
  const missing = rows.filter((r) => !r.covered).map((r) => r.app);
  if (missing.length > 0) {
    console.log(`\n[smoke-coverage] deuda nominal (${missing.length}): ${missing.join(', ')}`);
    console.log(
      '[smoke-coverage] contrato del smoke mínimo: server efímero + click-through funcional + cleanup en finally (incidente 2026-11-14, censor).',
    );
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'))) {
  main();
}
