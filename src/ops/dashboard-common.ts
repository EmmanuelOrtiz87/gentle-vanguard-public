#!/usr/bin/env node
/**
 * Dashboard Common — port allocation and state persistence utilities.
 * TS migration of scripts/utilities/dashboard/dashboard-common.ps1
 */

import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { spawn, spawnSync } from 'child_process';
import { runSync } from '../../adapters/command-runner.js';
import { pathToFileURL } from 'url';
import { watchdogIsAlive } from './dashboard-watchdog-policy';

const RUNTIME_DIR = path.resolve(process.cwd(), '.runtime');
const PORTS_FILE = path.join(RUNTIME_DIR, 'dashboard-ports.json');

/**
 * Mata al proceso REGISTRADO del dashboard (el del PID file).
 *
 * POR QUE EXISTE (2026-11-03)
 * Un daemon WEDGED (puerto abierto, event loop bloqueado) NO muere con
 * `process.kill(pid, 'SIGKILL')` en Windows: el proceso no puede atender la
 * senal. Hay que usar `taskkill /F /T` (tree kill), que lo termina por
 * fuera del proceso. Ya se habia visto en el incidente del dashboard: el
 * `Stop-Process -Force` fallaba en silencio y `taskkill /F /PID` si
 * funcionaba.
 *
 * El tree kill tambien se lleva a los hijos (skill-server, etc.), que si no
 * quedan huerfanos ocupando recursos.
 *
 * Solo se mata lo que el propio stack registro: un proceso ajeno que
 * escuche en el puerto NO se toca.
 */
export function killRecordedWsProcess(pidFile: string): boolean {
  try {
    if (!fs.existsSync(pidFile)) return false;
    const pid = Number(fs.readFileSync(pidFile, 'utf-8').trim());
    if (!Number.isInteger(pid) || pid <= 0) return false;
    if (pid === process.pid) return false;

    if (process.platform === 'win32') {
      const r = spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
        stdio: 'ignore',
        windowsHide: true,
      });
      if (r.status !== 0) return false;
    } else {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        return false;
      }
    }
    try {
      fs.unlinkSync(pidFile);
    } catch {
      /* non-fatal */
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Asegura que exista un watchdog externo VIVO para el dashboard.
 *
 * POR QUE (2026-11-03)
 * Un dashboard sin watchdog es un dashboard sin supervisor: si el server se
 * cuelga, nadie lo reinicia. El autoheal del watchtower lanza el SERVER, no
 * el watchdog — y el watchdog podia SUICIDARSE al agotar su presupuesto de
 * reinicios, dejando el dashboard sin nadie que lo cuidara, de forma
 * permanente y silenciosa.
 *
 * Invariante que se cierra aca: **por la via que se arranque el dashboard,
 * hay un watchdog_threads.** El launcher es la via canonica del autoheal,
 * asi que es el lugar donde se garantiza.
 *
 * El watchdog arranca con `--watch`: si el server ya esta sano (lo acaba de
 * lanzar el propio launcher), lo ADOPTA y se limita a vigilarlo. No hay
 * conflicto: el guard de instancia unica vive en el propio autostart.
 */
export function ensureWatchdog(port: number): { spawned: boolean; reason: string } {
  const watchdogPidFile = path.join(RUNTIME_DIR, 'dashboard-ws-watchdog.pid');

  // 1) Ya hay un watchdog registrado y vivo -> nada que hacer.
  const alive = watchdogIsAlive(
    watchdogPidFile,
    (pid) => {
      process.kill(pid, 0); // lanza si el proceso no existe
      return true;
    },
    (p) => {
      try {
        return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
      } catch {
        return null;
      }
    },
  );
  if (alive) {
    let pid = 0;
    try {
      pid = Number(fs.readFileSync(watchdogPidFile, 'utf-8').trim());
    } catch {
      /* noop */
    }
    return { spawned: false, reason: `watchdog ya vivo (PID=${pid})` };
  }

  // 2) No hay watchdog (o el registrado esta muerto) -> lo arrancamos.
  const autostartScript = path.resolve(process.cwd(), 'src', 'ops', 'dashboard-ws-autostart.ts');
  if (!fs.existsSync(autostartScript)) {
    return { spawned: false, reason: `no existe ${autostartScript}` };
  }

  const child = spawn(
    process.execPath,
    ['--import', 'tsx', autostartScript, '--watch', '--port', String(port)],
    {
      cwd: process.cwd(),
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
      shell: false,
    },
  );
  child.unref();
  return { spawned: true, reason: `watchdog arrancado (PID=${child.pid})` };
}

/**
 * Timeout del probe de liveness del dashboard WS.
 *
 * UN SOLO VALOR PARA TODO EL STACK (2026-11-03).
 *
 * El server calcula las metricas de forma SINCRONA en su event loop
 * (lectura de la base, git, caches): hay ventanas de varios segundos en las
 * que esta VIVO pero tarda en responder. Con un probe corto, esa ventana se
 * confunde con "colgado":
 *
 *   - el watchdog externo mataba y relanzaba un server sano (228 reinicios);
 *   - el health check del stack reportaba FAIL con el server funcionando;
 *   - el proxy de Vite se caia por lo mismo.
 *
 * 15s diferencia "vivo y ocupado" de "colgado": un daemon realmente wedged
 * (event loop bloqueado para siempre) tampoco responde en 15s, asi que el
 * umbral sigue distinguiendo los dos casos.
 */
export const DASHBOARD_PROBE_TIMEOUT_MS = 15_000;

interface DashboardPorts {
  wsPort?: number;
  vitePort?: number;
  updated?: string;
}

export function isDashboardHtml(html: string): boolean {
  return (
    /<title>\s*GentleVanguard Dashboard\s*<\/title>/i.test(html) &&
    /<div id=["']root["']><\/div>/i.test(html)
  );
}

/**
 * Find a free TCP port starting from preferred.
 * Tries to bind a TCP listener — cleanest cross-platform port check.
 */
export async function getFreePort(preferred = 8080, maxAttempts = 100): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = preferred + i;
    const free = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port, '127.0.0.1');
    });
    if (free) return port;
  }
  return preferred;
}

/** Persist dashboard port assignments to .runtime/dashboard-ports.json */
export function saveDashboardPorts(wsPort: number, vitePort: number): void {
  ensureRuntimeDir();
  const data: DashboardPorts = {
    wsPort,
    vitePort,
    updated: new Date().toISOString(),
  };
  fs.writeFileSync(PORTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/** Read persisted dashboard port assignments */
export function readDashboardPorts(): DashboardPorts | null {
  try {
    if (fs.existsSync(PORTS_FILE)) {
      return JSON.parse(fs.readFileSync(PORTS_FILE, 'utf-8')) as DashboardPorts;
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

/** Remove the dashboard ports file */
export function clearDashboardPorts(): void {
  try {
    if (fs.existsSync(PORTS_FILE)) fs.unlinkSync(PORTS_FILE);
  } catch {
    // ignore
  }
}

/** Get process ID listening on a given TCP port (Windows via netstat, cross-platform via ss/lsof) */
export async function getProcessIdByPort(port: number): Promise<number | null> {
  try {
    if (process.platform === 'win32') {
      const r = runSync('netstat', ['-ano', '-p', 'TCP'], { timeout: 5000 });
      const output = (r.stdout ?? '').toString();
      for (const line of output.trim().split('\n')) {
        if (line.includes('LISTENING') && line.includes(`:${port} `)) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (/^\d+$/.test(pid)) return parseInt(pid, 10);
        }
      }
    } else {
      const r = runSync('lsof', ['-ti', `:${port}`], { timeout: 5000 });
      if (r.status === 0) {
        const line = (r.stdout ?? '').toString().trim().split('\n')[0];
        if (/^\d+$/.test(line)) return parseInt(line, 10);
      } else {
        const r2 = runSync('ss', ['-tlnp', `sport = :${port}`], { timeout: 5000 });
        const output = (r2.stdout ?? '').toString();
        for (const line of output.trim().split('\n')) {
          const pidMatch = line.match(/pid=(\d+)/i);
          if (pidMatch) return parseInt(pidMatch[1], 10);
        }
      }
    }
  } catch {
    // not found or error
  }
  return null;
}

/** Check if a process with given PID is alive */
export function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    if (process.platform === 'win32') {
      // NOTE: tasklist /FI returns exit code 0 even when the PID does NOT exist
      // (it prints "INFO: No tasks are running..."). We must parse the output
      // instead of relying on the exit code — otherwise stale PID files are
      // never cleaned and the watchdog falsely believes processes are alive.
      const r = runSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], {
        timeout: 3000,
      });
      const output = (r.stdout ?? '').toString();
      // CSV row looks like: "node.exe","26316","Console","1","12,345 K"
      return output.includes(`"${pid}"`);
    }
    // Unix: kill -0 checks if process exists
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill a process by PID.
 *
 * `tree` mata tambien a los hijos (taskkill /T). Es lo correcto para los
 * daemons del stack: el WS server deja hijos (skill-server) que, si quedan
 * vivos, siguen ocupando memoria y puertos. Y es la UNICA via contra un
 * daemon wedged: `process.kill(pid, 'SIGKILL')` no lo detiene (su event loop
 * esta bloqueado y no atiende la senal).
 */
export function killProcess(pid: number, tree = false): void {
  try {
    if (process.platform === 'win32') {
      runSync('taskkill', ['/F', ...(tree ? ['/T'] : []), '/PID', String(pid)], { timeout: 5000 });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    // ignore
  }
}

/** Read a PID from a file and kill the process, then remove the file */
export function stopByPidFile(pidFile: string, tree = false): void {
  try {
    if (fs.existsSync(pidFile)) {
      const content = fs.readFileSync(pidFile, 'utf-8').trim();
      if (/^\d+$/.test(content)) {
        killProcess(parseInt(content, 10), tree);
      }
      fs.unlinkSync(pidFile);
    }
  } catch {
    // ignore
  }
}

/** Kill any process listening on a port */
export async function stopByPort(port: number): Promise<void> {
  const pid = await getProcessIdByPort(port);
  if (pid) killProcess(pid);
}

/** Append a line to the dashboard log file */
export function logToFile(message: string): void {
  ensureRuntimeDir();
  const logFile = path.join(RUNTIME_DIR, 'dashboard-ws.log');
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logFile, `${timestamp} | ${message}\n`, 'utf-8');
}

/** Open a durable stderr destination for a detached dashboard WS server. */
export function openDashboardServerStderr(): number {
  ensureRuntimeDir();
  return fs.openSync(path.join(RUNTIME_DIR, 'dashboard-ws-server.stderr.log'), 'a');
}

/** Remove a file if it exists (silent) */
export function removeFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

function ensureRuntimeDir(): void {
  if (!fs.existsSync(RUNTIME_DIR)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  }
}

// CLI entry point (ESM pattern)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'get-free-port': {
      const preferred = parseInt(process.argv[3] || '8080', 10);
      void getFreePort(preferred).then((port) => console.log(port));
      break;
    }
    case 'get-pid-by-port': {
      const port = parseInt(process.argv[3] || '0', 10);
      void getProcessIdByPort(port).then((pid) => console.log(pid ?? ''));
      break;
    }
    case 'read-ports':
      console.log(JSON.stringify(readDashboardPorts()));
      break;
    case 'clear-ports':
      clearDashboardPorts();
      break;
    default:
      console.log('Usage: npx tsx src/dashboard-common.ts <cmd>');
      console.log(
        'Commands: get-free-port [preferred], get-pid-by-port <port>, read-ports, clear-ports',
      );
  }
}
