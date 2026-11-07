/**
 * ollama-serve — levanta el servidor de Ollama con el runtime optimizado
 * medido para esta maquina (bitacora §4.16/§4.17):
 *
 *   OLLAMA_IGPU_ENABLE=1          — sin esto corre en CPU (8x mas lento)
 *   OLLAMA_MAX_LOADED_MODELS=2    — 7b y 14b calientes sin recargarse
 *   OLLAMA_KEEP_ALIVE=2h          — no descarga modelos entre llamadas
 *
 * Idempotente: si el servidor ya responde, no toca nada. Procesos-ocultos:
 * spawn directo del binario con windowsHide + detached + unref (cero ventanas).
 *
 *   npm run ollama:serve
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { killProcess, runSystem } from '../core/platform-utils.js';

const OLLAMA_URL = 'http://127.0.0.1:11434';
const PID_FILE = join(process.cwd(), '.runtime', 'ollama.pid');

/**
 * El runner `llama-server.exe` es hijo del server: matar solo `ollama.exe`
 * deja el runner huérfano con el modelo cargado (~7 GB medidos el 2026-11-06).
 * killProcess usa `taskkill /pid /t /f` — baja el árbol completo, la única
 * forma limpia en Windows. Todo vía runSystem/killProcess de platform-utils
 * (el ratchet de deadcode cuenta binarios spawn directos por archivo).
 */
function killTree(pid: number): boolean {
  return killProcess(pid);
}

/** Lista PIDs de un proceso por imagen (PowerShell Get-Process). */
function findPidsByImage(image: string): number[] {
  const base = image.replace(/\.exe$/i, '');
  const r = runSystem(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Get-Process -Name '${base}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`,
    ],
    { timeoutMs: 15000 },
  );
  if (r.status !== 0 || !r.stdout) return [];
  return r.stdout
    .split(/\r?\n/)
    .map((l) => Number(l.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * PIDs de procesos `ollama.exe serve` (el server) por línea de comando —
 * distingue al server de los clientes `ollama run/ps` (que no deben morir).
 * netstat queda descartado: el socket LISTEN de ollama no siempre aparece
 * (medido 2026-11-07: /api/tags responde y netstat no lista el LISTENING).
 */
function findServerPids(): number[] {
  const r = runSystem(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='ollama.exe'\" | Where-Object { $_.CommandLine -match '\\bserve\\b' } | Select-Object -ExpandProperty ProcessId",
    ],
    { timeoutMs: 15000 },
  );
  if (r.status !== 0 || !r.stdout) return [];
  return r.stdout
    .split(/\r?\n/)
    .map((l) => Number(l.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Cierra el server rastreando el árbol: pid del pidfile + cualquier runner
 * `llama-server.exe` (solo el server lo produce; el CLI `ollama run` no toca
 * esta imagen, así que una sesión interactiva del usuario no se corta).
 */
export function stopOllama(): { stopped: boolean; killedPids: number[] } {
  const killedPids: number[] = [];
  let serverPid: number | null = null;
  if (existsSync(PID_FILE)) {
    try {
      const pid = Number(readFileSync(PID_FILE, 'utf-8').trim());
      if (Number.isFinite(pid) && pid > 0) serverPid = pid;
    } catch {
      /* pidfile corrupto: cae a detección por puerto */
    }
    try {
      unlinkSync(PID_FILE);
    } catch {
      /* best-effort */
    }
  }
  // Server arrancado fuera de este script (sin pidfile): detectar por cmdline
  // `serve` — el cliente `ollama run` no matchea y no se corta.
  if (serverPid === null) {
    for (const pid of findServerPids()) {
      if (killTree(pid)) killedPids.push(pid);
    }
  } else if (killTree(serverPid)) {
    killedPids.push(serverPid);
  }
  // Runners supervivientes: matarlos libera la VRAM/RAM sin tocar clientes.
  for (const pid of findPidsByImage('llama-server.exe')) {
    if (killTree(pid)) killedPids.push(pid);
  }
  return { stopped: killedPids.length > 0, killedPids };
}

/**
 * Janitor de arranque: si el server NO responde, cualquier `llama-server.exe`
 * vivo es huérfano (nada lo está sirviendo) — matarlo libera ~7 GB antes de
 * levantar un server nuevo. Si el server responde, no toca nada.
 */
function reapOrphanRunners(): number[] {
  const killed: number[] = [];
  for (const pid of findPidsByImage('llama-server.exe')) {
    if (killTree(pid)) killed.push(pid);
  }
  return killed;
}

async function serverUp(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function findOllamaExe(): string {
  const candidates = [
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'),
    process.env.USERPROFILE && join(process.env.USERPROFILE, 'scoop', 'shims', 'ollama.exe'),
  ].filter((p): p is string => Boolean(p && existsSync(p)));
  if (candidates.length === 0) return '';
  return candidates[0];
}

/**
 * Idempotente: si el servidor ya responde, no toca nada; si no, lo levanta
 * oculto con el runtime optimizado y espera hasta 30s. Devuelve el estado.
 */
export async function ensureOllamaUp(): Promise<{ up: boolean; started: boolean }> {
  if (await serverUp()) return { up: true, started: false };
  const reaped = reapOrphanRunners();
  if (reaped.length > 0) {
    process.stdout.write(
      `ollama-serve: ${reaped.length} runner(s) huerfano(s) liberados (llama-server).\n`
    );
  }
  const exe = findOllamaExe();
  if (!exe) return { up: false, started: false };
  const child = spawn(exe, ['serve'], {
    env: {
      ...process.env,
      OLLAMA_IGPU_ENABLE: '1',
      OLLAMA_MAX_LOADED_MODELS: '2',
      OLLAMA_KEEP_ALIVE: '2h',
    },
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
  });
  child.unref();
  try {
    writeFileSync(PID_FILE, String(child.pid), 'utf-8');
  } catch {
    /* best-effort: sin pidfile, el stop cae al barrido de runners */
  }
  for (let i = 0; i < 30; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await serverUp()) return { up: true, started: true };
  }
  return { up: false, started: true };
}

async function main(): Promise<number> {
  if (process.argv.includes('--stop')) {
    const { stopped, killedPids } = stopOllama();
    process.stdout.write(
      stopped
        ? `ollama-serve: servidor detenido (PIDs: ${killedPids.join(', ')}).\n`
        : 'ollama-serve: no habia servidor (ni runners) que detener.\n'
    );
    return 0;
  }
  const { up, started } = await ensureOllamaUp();
  if (up) {
    process.stdout.write(
      started
        ? 'ollama-serve: servidor arriba con IGPU + 2 modelos calientes + keep-alive 2h.\n'
        : 'ollama-serve: el servidor ya responde en 127.0.0.1:11434 (nada que hacer).\n'
    );
    return 0;
  }
  process.stderr.write('ollama-serve: el servidor no respondio en 30s.\n');
  return 1;
}

// Solo como CLI directo: al importarlo (harness-weekly), no arranca el server
// ni mata el proceso.
const invoked = ['ollama-serve.ts', 'ollama-serve.js'].includes(process.argv[1]?.split(/[\\/]/).pop() ?? '');
if (invoked) {
  process.exit(await main());
}
