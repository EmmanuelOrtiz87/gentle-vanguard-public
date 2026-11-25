/**
 * Asegura el Command Center (puerto 8090 / `command-center-ports.json`) vivo.
 *
 * Lo usa el autoheal del watchtower: sin CC, el check `apps-registry` no puede
 * afirmar nada sobre el registro de apps nativas. Medido 2026-11-25: CC murió
 * durante la noche y el gate quedó rojo hasta que alguien lo levantó a mano —
 * el autoheal solo tenía handler para dashboard-ws y codegraph.
 *
 * Se usa el launcher canónico (`apps/command-center/start.ts --no-browser`,
 * idempotente: si ya está vivo no re-ejecuta) y se confirma por /api/health real
 * (`app === 'command-center'`), no por exit code.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runNpxTsx } from '../core/run-command.js';

const ROOT = process.cwd();
const RUNTIME_DIR = join(ROOT, '.runtime');

export interface CommandCenterHealResult {
  up: boolean;
  /** Puertos sondeados (archivo de puerto real + preferido). */
  ports: number[];
  /** Presente solo cuando el launcher no pudo ni arrancar. */
  launcherError?: string;
}

export function commandCenterPorts(): number[] {
  const ports = new Set<number>();
  try {
    const raw = JSON.parse(
      readFileSync(join(RUNTIME_DIR, 'command-center-ports.json'), 'utf-8'),
    ) as { ccPort?: number };
    if (typeof raw.ccPort === 'number') ports.add(raw.ccPort);
  } catch {
    /* fallback abajo */
  }
  ports.add(Number(process.env.CC_PORT ?? 8090) || 8090);
  return [...ports];
}

async function isHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { app?: string };
    return body.app === 'command-center';
  } catch {
    return false;
  }
}

export async function healCommandCenter(timeoutMs = 15_000): Promise<CommandCenterHealResult> {
  const ports = commandCenterPorts();
  for (const port of ports) {
    if (await isHealthy(port)) return { up: true, ports };
  }
  try {
    runNpxTsx(join(ROOT, 'apps', 'command-center', 'start.ts'), ['--no-browser'], {
      cwd: ROOT,
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    }).unref();
  } catch (e: unknown) {
    return {
      up: false,
      ports,
      launcherError: e instanceof Error ? e.message : String(e),
    };
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    for (const port of ports) {
      if (await isHealthy(port)) return { up: true, ports };
    }
  }
  return { up: false, ports };
}
