#!/usr/bin/env node
/**
 * pidfile-reaper — .runtime/*.pid que apuntan a procesos muertos.
 *
 * POR QUÉ EXISTE (2026-11-18)
 * -------------------------------------------------------------------------
 * El stack escribe `.runtime/<id>.pid` al arrancar y lo lee para parar
 * (start.sh/stop.sh, health, watchtower). 25 pidfiles quedaron apuntando a
 * procesos que ya no existen: `stop.sh` de una app caída falla o mata un PID
 * REUSADO por otro proceso, y el health reporta "pidfile stale" para siempre.
 * Nadie los recolectaba porque no rompen nada visible — hasta que rompen.
 *
 * Semántica:
 *  - live   → kill(pid, 0) responde: el pidfile se conserva (jamás se toca el
 *             proceso; el reaper solo administra archivos).
 *  - stale  → el proceso no existe: candidato a eliminar.
 *  - corrupt→ no contiene un PID válido: candidato a eliminar.
 *
 * PASIVO por default (el stack es fail-safe: nada se auto-borra sin acción
 * explícita). `--apply` elimina SOLO los stale/corrupt; los live nunca.
 *
 * Uso:
 *   npm run apps:pidfiles            # reporte (exit 0 siempre)
 *   npm run apps:pidfiles -- --json
 *   npm run apps:pidfiles -- --apply # elimina stale/corrupt (corre guard:snapshot antes)
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export type PidfileState = 'live' | 'stale' | 'corrupt';

export interface PidfileStatus {
  file: string;
  pid: number | null;
  state: PidfileState;
}

export function isPidAlive(pid: number | null): boolean {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'; // existe sin permiso
  }
}

export function classifyPidfile(content: string): { pid: number | null; state: PidfileState } {
  const pid = Number(content.trim());
  if (!Number.isFinite(pid) || pid <= 0) return { pid: null, state: 'corrupt' };
  return { pid, state: isPidAlive(pid) ? 'live' : 'stale' };
}

export function scanPidfiles(runtimeDir = join(ROOT, '.runtime')): PidfileStatus[] {
  if (!existsSync(runtimeDir)) return [];
  return readdirSync(runtimeDir)
    .filter((name) => name.endsWith('.pid'))
    .sort()
    .map((name) => {
      const file = join(runtimeDir, name);
      let content = '';
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        return { file: name, pid: null, state: 'corrupt' as PidfileState };
      }
      return { file: name, ...classifyPidfile(content) };
    });
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const statuses = scanPidfiles();
  const live = statuses.filter((s) => s.state === 'live');
  const removable = statuses.filter((s) => s.state !== 'live');

  if (process.argv.includes('--json')) {
    console.log(
      JSON.stringify(
        { total: statuses.length, live: live.length, removable: removable.length, statuses },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `[PIDFILES] ${statuses.length} pidfiles — ${live.length} live, ${removable.length} stale/corrupt`,
    );
    for (const s of statuses) {
      console.log(`  ${s.state.padEnd(7)} ${s.file}${s.pid ? ` (pid ${s.pid})` : ''}`);
    }
    if (removable.length && !apply) {
      console.log('[PIDFILES] PASIVO: usar --apply para eliminar los stale/corrupt (live nunca)');
    }
  }

  if (!apply) return;
  // Reversible: los pidfiles eliminados se archivan antes de borrarse, para
  // que la limpieza nunca sea una pérdida silenciosa de estado.
  const archive = join(ROOT, '.runtime', 'backups', `pidfiles-${Date.now()}`);
  let removed = 0;
  for (const s of removable) {
    try {
      mkdirSync(archive, { recursive: true });
      copyFileSync(join(ROOT, '.runtime', s.file), join(archive, s.file));
      unlinkSync(join(ROOT, '.runtime', s.file));
      removed += 1;
    } catch (error) {
      console.error(`[PIDFILES] no se pudo eliminar ${s.file}: ${(error as Error).message}`);
    }
  }
  console.log(
    `[PIDFILES] eliminados ${removed} pidfiles stale/corrupt (live preservados; archivo: ${archive})`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
