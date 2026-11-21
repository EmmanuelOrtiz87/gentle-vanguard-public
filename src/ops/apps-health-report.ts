/**
 * apps-health-report — salud PASIVA de las apps registradas en
 * config/apps.registry.json.
 *
 * BL-2026-11-16 (caso censor): el server quedó caído con PID stale y el
 * owner descubrió el fetch_failed al usar la app — nada lo avisaba. El
 * keepalive del stack es fail-safe POR DECISIÓN DEL OWNER (2026-09-26:
 * ningún proceso se auto-arranca sin acción explícita), así que este paso
 * INFORMA y nunca revive: el arranque explícito sigue siendo
 * `npm run cc:start` / CC UI / start.sh de la app.
 *
 * Estados por app:
 *  - ok      → al menos un puerto registrado en escucha.
 *  - down    → sin puertos en escucha (y sin PID vivo si declara pidfile).
 *  - zombie  → pidfile existe y el PID está vivo, pero el puerto NO responde
 *              (server colgado: el caso exacto del incidente censor).
 *  - no-ports→ la app no declara puertos en el registry (se omite).
 *
 * Uso:
 *   npx tsx src/ops/apps-health-report.ts           # reporte (exit 0 siempre)
 *   npx tsx src/ops/apps-health-report.ts --json    # salida máquina
 */
import { connect } from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REGISTRY_PATH = join(ROOT, 'config', 'apps.registry.json');
const STATE_PATH = join(ROOT, '.runtime', 'apps-health-last.json');
const PROBE_TIMEOUT_MS = 400;

export type AppHealth = 'ok' | 'down' | 'zombie' | 'no-ports';

export interface AppStatus {
  id: string;
  name: string;
  url?: string;
  ports: number[];
  /** true si algún puerto registrado respondió. */
  up: boolean;
  /** PID leído del pidfile .runtime/<id>.pid (si existe). */
  pid: number | null;
  /** PID vivo según kill(pid, 0). */
  pidAlive: boolean;
  status: AppHealth;
}

/** TCP probe con timeout corto: true si el puerto acepta conexión. */
export function probePort(
  port: number,
  host = '127.0.0.1',
  timeout = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const socket = connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolveProbe(ok);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/** ¿El PID corresponde a un proceso vivo? (kill(pid,0) — sin señalizar). */
export function isPidAlive(pid: number | null): boolean {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    return e.code === 'EPERM'; // existe pero sin permiso → vivo
  }
}

export function classifyApp(input: {
  portsUp: boolean;
  hasPidfile: boolean;
  pidAlive: boolean;
  hasPorts: boolean;
}): AppHealth {
  if (!input.hasPorts) return 'no-ports';
  if (input.portsUp) return 'ok';
  if (input.hasPidfile && input.pidAlive) return 'zombie';
  return 'down';
}

interface RegistryApp {
  id?: string;
  name?: string;
  url?: string;
  ports?: number[];
  enabled?: boolean;
}

function readPidfile(id: string): number | null {
  const pidPath = join(ROOT, '.runtime', `${id}.pid`);
  if (!existsSync(pidPath)) return null;
  const raw = readFileSync(pidPath, 'utf8').trim();
  const pid = Number(raw);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

export async function collectStatuses(registryPath = REGISTRY_PATH): Promise<AppStatus[]> {
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  const apps: RegistryApp[] = Array.isArray(registry) ? registry : (registry.apps ?? []);
  const out: AppStatus[] = [];
  for (const app of apps) {
    const id = String(app.id ?? '');
    if (!id) continue;
    const ports = Array.isArray(app.ports) ? app.ports.filter((p) => Number.isFinite(p)) : [];
    if (!ports.length) {
      out.push({
        id,
        name: app.name ?? id,
        url: app.url,
        ports: [],
        up: false,
        pid: null,
        pidAlive: false,
        status: 'no-ports',
      });
      continue;
    }
    const probes = await Promise.all(ports.map((p) => probePort(p)));
    const portsUp = probes.some(Boolean);
    const pid = readPidfile(id);
    const pidAlive = isPidAlive(pid);
    out.push({
      id,
      name: app.name ?? id,
      url: app.url,
      ports,
      up: portsUp,
      pid,
      pidAlive,
      status: classifyApp({ portsUp, hasPidfile: pid !== null, pidAlive, hasPorts: true }),
    });
  }
  return out;
}

async function main(): Promise<void> {
  const asJson = process.argv.includes('--json');
  const statuses = await collectStatuses();
  const relevant = statuses.filter((s) => s.status !== 'no-ports');
  const down = relevant.filter((s) => s.status !== 'ok');
  const evidence = {
    generatedAt: new Date().toISOString(),
    apps: statuses.map(({ id, name, ports, up, pid, pidAlive, status }) => ({
      id,
      name,
      ports,
      up,
      pid,
      pidAlive,
      status,
    })),
    down: down.map((s) => s.id),
  };
  try {
    mkdirSync(join(ROOT, '.runtime'), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  } catch {
    // best-effort: el estado es evidencia, no requisito
  }
  if (asJson) {
    console.log(JSON.stringify(evidence, null, 2));
    return;
  }
  console.log(
    `[APPS-HEALTH] ${relevant.length} apps con puertos registrados — ${relevant.length - down.length} ok, ${down.length} caídas`,
  );
  for (const s of relevant) {
    const label = `${s.name} (${s.id})`;
    if (s.status === 'ok') {
      console.log(`[APPS-HEALTH] ok     · ${label} :${s.ports.join(',')}`);
    } else if (s.status === 'zombie') {
      console.log(
        `[APPS-HEALTH] zombie · ${label} — PID ${s.pid} vivo pero puerto ${s.ports.join(',')} sin respuesta (server colgado)`,
      );
    } else {
      console.log(
        `[APPS-HEALTH] down   · ${label} — puerto ${s.ports.join(',')} sin respuesta${s.pid ? ` (pidfile stale: ${s.pid})` : ''}`,
      );
    }
  }
  if (down.length) {
    // PASIVO por decisión del owner (keepalive fail-safe 2026-09-26): solo informar.
    console.log(
      `[APPS-HEALTH] Arranque explícito disponible: npm run cc:start · CC UI · start.sh de cada app`,
    );
  }
  process.exit(0);
}

// Ejecutar solo como CLI (los tests importan las funciones puras)
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('[APPS-HEALTH] error:', error);
    process.exit(0); // skipOnFailure: nunca bloquea la sesión
  });
}
