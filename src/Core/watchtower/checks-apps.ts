// Command Center apps registry check (apps-registry component).
// Vigila las 10 apps del stack a través de CC: presencia en el registro,
// contratos de ciclo de vida (start.sh/stop.sh) y coherencia de estado
// (proceso vivo sin pid = proceso adoptado/zombie — ver
// docs/apps/APPS-INDEPENDENCE-AUDIT-2026-09-12.md).

import { existsSync } from 'fs';
import { join } from 'path';
import { runNpxTsxSync } from '../run-command';
import { RUNTIME_DIR, ROOT, addResult, quiet } from './context';
import { fileExists, readJson } from './helpers';
import { log } from '../../utils/logger.js';

const logger = log('CORE-WATCHTOWER-CHECKS-APPS');

/** Registro canónico de apps (fuente: APPS_REGISTRY de apps/command-center/server.ts). */
const EXPECTED_APPS: Array<{ id: string; uiPort: number }> = [
  { id: 'dashboard', uiPort: 5173 },
  { id: 'analytics', uiPort: 5174 },
  { id: 'cms', uiPort: 5175 },
  { id: 'academy', uiPort: 4173 },
  { id: 'prompts', uiPort: 5176 },
  { id: 'archify', uiPort: 5179 },
  { id: 'design-hub', uiPort: 8095 },
  { id: 'academy-crm', uiPort: 4791 },
  { id: 'academy-landing', uiPort: 4174 },
  { id: 'academy-portal', uiPort: 4793 },
  { id: 'gv-music', uiPort: 1420 },
];

/** Directorio de la app para ids cuyo directorio no coincide con el id de CC. */
function appDir(id: string): string {
  const dir =
    id === 'dashboard'
      ? 'web-dashboard'
      : id === 'gv-music'
        ? 'gv-music'
      : id === 'academy'
        ? 'academy-web'
        : id === 'prompts'
          ? 'prompt-studio'
          : id === 'cms'
            ? 'content-cms'
            : id === 'analytics'
              ? 'gv-analytics'
              : id;
  return join(ROOT, 'apps', dir);
}

interface CcApp {
  id: string;
  status: string;
  processes: Array<{ name: string; pid: number | null; port: number; alive: boolean }>;
}

async function ccPort(): Promise<number> {
  const portsFile = join(RUNTIME_DIR, 'command-center-ports.json');
  if (fileExists(portsFile)) {
    try {
      const data = readJson(portsFile);
      if (typeof data.ccPort === 'number') return data.ccPort;
    } catch {
      /* fallback abajo */
    }
  }
  return 8090;
}

export async function checkAppsRegistry() {
  if (!quiet) logger.info('  [Apps Registry] Checking via Command Center...');

  const port = await ccPort();
  // Retry idempotente (patrón upstream gentle-ai): dentro del run largo el
  // fetch a CC puede colgar (pool de undici + event loop bloqueado por checks
  // sync previos) o fallar instantáneo — 3 intentos cortos lo absorben.
  let apps: CcApp[] | null = null;
  for (let attempt = 1; attempt <= 3 && !apps; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/apps`, {
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) apps = (await res.json()) as CcApp[];
    } catch {
      apps = null;
    }
    if (!apps && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }

  if (!apps) {
    addResult(
      'apps-registry',
      `command-center API (:${port})`,
      'FAIL',
      'No responde — CC es daemon persistente: npm run cc:start (PowerShell) o apps/command-center/start.sh (Git Bash)',
      'restart',
    );
    return;
  }
  addResult(
    'apps-registry',
    `command-center API (:${port})`,
    'PASS',
    `${apps.length} apps registradas`,
    'ok',
  );

  const byId = new Map(apps.map((a) => [a.id, a]));
  for (const expected of EXPECTED_APPS) {
    const app = byId.get(expected.id);
    if (!app) {
      addResult(
        'apps-registry',
        `registro: ${expected.id}`,
        'FAIL',
        'Falta en APPS_REGISTRY de CC',
        'verify',
      );
      continue;
    }
    addResult('apps-registry', `registro: ${expected.id}`, 'PASS', `status=${app.status}`, 'ok');

    // Contrato de ciclo de vida: start.sh + stop.sh en el directorio de la app.
    const dir = appDir(expected.id);
    for (const script of ['start.sh', 'stop.sh']) {
      if (existsSync(join(dir, script))) {
        addResult('apps-registry', `${expected.id}:${script}`, 'PASS', 'presente', 'ok');
      } else {
        addResult(
          'apps-registry',
          `${expected.id}:${script}`,
          'FAIL',
          'falta el script nativo',
          'verify',
        );
      }
    }

    // Coherencia: proceso con puerto vivo pero pid desconocido = adoptado/zombie.
    for (const proc of app.processes ?? []) {
      if (proc.alive && proc.pid === null) {
        addResult(
          'apps-registry',
          `${expected.id}:${proc.name} (:${proc.port})`,
          'WARN',
          'puerto vivo sin pid conocido — proceso adoptado o pidfile stale; verificar dueño real del puerto',
          'verify',
        );
      }
    }
  }
}

/**
 * Vigila la salud de las 14 apps via el per-app audit (Layer 5 stack-verify).
 *
 * Corre `npx tsx src/ops/stack-audit-apps.ts --json --plan` (NO ejecuta npm run
 * typecheck/test — eso dura ~3min y el watchtower ya tiene un check 'typecheck'
 * global). El audit en modo plan reporta que apps existen + que scripts
 * tienen, suficiente para detectar:
 *  - app removida o renombrada (desaparecio del discoverApps)
 *  - app nueva sin scripts typecheck/test (deberia ser PASS con scripts)
 *  - app existente que perdio sus scripts (regresion)
 *
 * Si el audit falla o retorna apps sin scripts (WARN), lo refleja en el
 * resultado del watchtower para que el operador lo vea en `npm run
 * watchtower:health`.
 *
 * Timeout 30s (solo discovery + lectura de package.json, no npm run).
 */
export async function checkAppsAudit() {
  if (!quiet) logger.info('  [Apps Audit] Layer 5 (plan mode)...');

  let stdout = '';
  try {
    const r = runNpxTsxSync('src/ops/stack-audit-apps.ts', ['--json', '--plan'], {
      cwd: ROOT,
      timeout: 30_000,
    });
    if (r.status !== 0) {
      addResult(
        'apps-audit',
        'stack-audit-apps --json --plan',
        'FAIL',
        `exit=${r.status}: ${(r.stderr || r.stdout || '').slice(0, 200)}`,
        'verify',
      );
      return;
    }
    stdout = r.stdout || '';
  } catch (err) {
    addResult(
      'apps-audit',
      'stack-audit-apps --json --plan',
      'FAIL',
      `excepcion: ${(err as Error).message.slice(0, 200)}`,
      'verify',
    );
    return;
  }

  let parsed: { audits: Array<{ app: string; status: string; checks: Array<{ kind: string; status: string }> }> };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    addResult(
      'apps-audit',
      'JSON parse',
      'FAIL',
      `stdout no es JSON: ${stdout.slice(0, 200)}`,
      'verify',
    );
    return;
  }

  const apps = parsed.audits || [];
  const pass = apps.filter((a) => a.status === 'PASS').length;
  const warn = apps.filter((a) => a.status === 'WARN').length;
  const fail = apps.filter((a) => a.status === 'FAIL').length;

  // En plan mode (--plan) el audit NO ejecuta npm run, todos los checks son
  // SKIP. Solo emitimos el resumen (cantidad de apps descubiertas). Las
  // advertencias de 'apps sin scripts' solo se emiten cuando el audit REAL
  // ejecuto y detecto que la app no tiene scripts definidos.
  const executed = apps.some((a) => a.checks.some((c) => c.status !== 'SKIP'));

  if (executed) {
    const orphans = apps.filter(
      (a) => a.checks.length === 0 || a.checks.every((c) => c.status === 'SKIP'),
    );
    for (const a of orphans) {
      addResult(
        'apps-audit',
        `audit:${a.app}`,
        'WARN',
        'app sin scripts typecheck/test/lint — no auditable; agregar scripts o documentar exclusion',
        'verify',
      );
    }
  }

  // Resumen agregado.
  if (fail > 0) {
    addResult(
      'apps-audit',
      'resumen',
      'FAIL',
      `${apps.length} apps: ${pass} PASS / ${warn} WARN / ${fail} FAIL`,
      'rebuild',
    );
  } else if (!executed) {
    // Plan mode only discovers apps and scripts; it intentionally does not
    // execute checks. SKIP here is an informational state, not a defect.
    addResult(
      'apps-audit',
      'resumen',
      'PASS',
      `${apps.length} apps descubiertas; ejecución de checks diferida (plan mode)`,
      'ok',
    );
  } else if (warn > 0) {
    addResult(
      'apps-audit',
      'resumen',
      'WARN',
      `${apps.length} apps: ${pass} PASS / ${warn} WARN${executed ? ' (apps sin scripts auditables)' : ' (plan mode)'}`,
      'ok',
    );
  } else {
    addResult(
      'apps-audit',
      'resumen',
      'PASS',
      `${apps.length} apps con scripts auditables`,
      'ok',
    );
  }
}
