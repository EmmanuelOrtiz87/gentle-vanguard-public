#!/usr/bin/env node
/**
 * run-e2e-smoke.ts — Runner del gate `e2e-real-smoke` (NORM-E2E-001).
 *
 * Un push puede tocar 1 app o 14; correr TODOS los smokes E2E en cada push
 * (server vivo + journey de navegador con Playwright) convertiria el gate en
 * ruido de 10 minutos. El scope correcto: correr el smoke SOLO de las apps
 * cuyo arbol cambio en el rango que se esta pusheando.
 *
 * SELECCION
 *   1. Rango de push: `git diff --name-only @{push}...HEAD` (merge-base),
 *      fallback `origin/main...HEAD`; sin referencia remota conocida se corren
 *      todos (conservador).
 *   2. Selecciona apps/<app>/ con archivos cambiados bajo apps/<app>/ y que
 *      tengan tests/e2e-smoke.ts|/mjs. Sin cambios relevantes: exit 0 rapido.
 *
 * Ejecucion: cada smoke es autocontenido (levanta su server en puerto
 * aislado, limpia su tmp) — se corre secuencial con `node --import tsx`
 * (runNpxTsxSync: procesos ocultos, sin nietos, NORM-TS-001/procesos-ocultos).
 *
 * Uso:
 *   node --import tsx src/git/run-e2e-smoke.ts           # scope por rango de push
 *   node --import tsx src/git/run-e2e-smoke.ts --all     # forzar todos
 *   node --import tsx src/git/run-e2e-smoke.ts --app voice-studio
 *
 * Exit: 0 = todos los smokes seleccionados pasaron (o ninguno aplico),
 *       1 = al menos un smoke fallo.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runNpxTsxSync, runSync } from '../core/run-command.js';

const ROOT = join(import.meta.dirname, '..', '..');
const APPS = join(ROOT, 'apps');
const SMOKE_TIMEOUT_MS = 420_000; // playwright + browser boot tolera cold start

interface SmokeApp {
  app: string;
  script: string; // relativo a ROOT, con / para compat cross-platform
}

function discoverSmokeApps(): SmokeApp[] {
  const out: SmokeApp[] = [];
  for (const entry of readdirSync(APPS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const ext of ['ts', 'mjs']) {
      const rel = `apps/${entry.name}/tests/e2e-smoke.${ext}`;
      if (existsSync(join(ROOT, rel))) {
        out.push({ app: entry.name, script: rel });
        break;
      }
    }
  }
  return out.sort((a, b) => a.app.localeCompare(b.app));
}

/** Archivos cambiados en el rango de push; null si no hay referencia confiable. */
function pushedFiles(): string[] | null {
  for (const ref of ['@{push}', 'origin/main']) {
    const result = runSync('git', ['diff', '--name-only', `${ref}...HEAD`], {
      cwd: ROOT,
      timeout: 30_000,
    });
    if (result.status === 0) return result.stdout.split('\n').filter(Boolean);
  }
  return null;
}

function appsToRun(all: SmokeApp[], changed: string[] | null, forceAll: boolean, only?: string): SmokeApp[] {
  if (only) return all.filter((s) => s.app === only);
  if (forceAll || changed === null) return all;
  const selected = all.filter((s) =>
    changed.some((file) => file.startsWith(`apps/${s.app}/`) || file.startsWith(`apps\\${s.app}\\`)),
  );
  return selected;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const forceAll = argv.includes('--all');
  const onlyIdx = argv.indexOf('--app');
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : undefined;

  const all = discoverSmokeApps();
  if (all.length === 0) {
    console.log('[e2e-smoke] ninguna app tiene tests/e2e-smoke.* — nada que verificar');
    return 0;
  }
  const changed = pushedFiles();
  const selected = appsToRun(all, changed, forceAll, only);

  if (selected.length === 0) {
    console.log(
      `[e2e-smoke] 0/${all.length} apps con smoke cambian en el push — gate e2e-real-smoke sin alcance, exit 0`,
    );
    return 0;
  }

  console.log(`[e2e-smoke] corriendo ${selected.length}/${all.length} smokes: ${selected.map((s) => s.app).join(', ')}`);
  const failures: string[] = [];
  for (const smoke of selected) {
    const started = Date.now();
    const result = runNpxTsxSync(smoke.script, [], {
      cwd: ROOT,
      timeout: SMOKE_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
    const elapsedSec = Math.round((Date.now() - started) / 1000);
    const ok = result.status === 0;
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${smoke.app} (${elapsedSec}s) -> ${smoke.script}`);
    if (!ok) {
      failures.push(smoke.app);
      const tail = `${result.stderr}\n${result.stdout}`.trim().split('\n').slice(-15).join('\n');
      console.error(tail);
    }
  }

  if (failures.length > 0) {
    console.error(`[e2e-smoke] FAIL: ${failures.join(', ')} (NORM-E2E-001: sin 0 FAIL no se declara homologada/cerrada)`);
    return 1;
  }
  console.log(`[e2e-smoke] OK ${selected.length}/${selected.length} smokes pasaron`);
  return 0;
}

const invokedDirectly =
  process.argv[1]?.split(/[\\/]/).pop() === 'run-e2e-smoke.ts';
if (invokedDirectly) {
  process.exitCode = await main();
}
