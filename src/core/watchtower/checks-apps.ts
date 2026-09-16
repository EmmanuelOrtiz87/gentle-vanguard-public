// Command Center apps registry check (apps-registry component).
// Vigila las 9 apps del stack a través de CC: presencia en el registro,
// contratos de ciclo de vida (start.sh/stop.sh) y coherencia de estado
// (proceso vivo sin pid = proceso adoptado/zombie — ver
// docs/apps/APPS-INDEPENDENCE-AUDIT-2026-09-12.md).

import { existsSync } from 'fs';
import { join } from 'path';
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
];

/** Directorio de la app para ids cuyo directorio no coincide con el id de CC. */
function appDir(id: string): string {
  const dir =
    id === 'dashboard'
      ? 'web-dashboard'
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
  let apps: CcApp[] | null = null;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/apps`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) apps = (await res.json()) as CcApp[];
  } catch {
    apps = null;
  }

  if (!apps) {
    addResult(
      'apps-registry',
      `command-center API (:${port})`,
      'FAIL',
      'No responde — CC es daemon persistente, arrancar con apps/command-center/start.sh',
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
