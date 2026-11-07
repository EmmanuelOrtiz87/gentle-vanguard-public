#!/usr/bin/env node
/**
 * start-spike-guard-daemon.ts — asegurar que el Token Spike Guard daemon corra.
 *
 * Idempotente: si el pidfile está vivo, sale 0 sin tocar nada. Si está muerto
 * (o huérfano de pidfile), spawnea el daemon detached + windowsHide con su
 * salida en un archivo de log durable (nunca PIPE: el hijo moriría con EPIPE
 * cuando el launcher desaparece — canon process-hygiene, ver
 * start-monitor-daemon.ts donde se documentó el caso).
 *
 * GB-20261105-b: el agendamiento (schtasks cada 15 min vía bootstrap) llama
 * este script; el daemon mismo también se deduplica contra el pidfile, así
 * que autostart + tarea programada no generan instancias múltiples.
 *
 * Uso: node --import tsx src/tokens/start-spike-guard-daemon.ts
 */

import { existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { runNpxTsx } from '../core/run-command.js';

const ROOT = resolve(process.cwd());
const PID_FILE = join(ROOT, '.runtime', 'spike-guard.pid');
const LOG_FILE = join(ROOT, '.runtime', 'spike-guard-daemon.log');

function readAlivePid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    process.kill(pid, 0); // señal 0: solo verifica existencia
    return pid;
  } catch {
    // pid muerto o pidfile corrupto → limpiar y reportar ausente
    try {
      rmSync(PID_FILE, { force: true });
    } catch {
      /* best-effort */
    }
    return null;
  }
}

const alive = readAlivePid();
if (alive !== null) {
  console.log(`[spike-guard-ensure] ya corriendo (PID ${alive}); nada que hacer`);
  process.exit(0);
}

mkdirSync(dirname(LOG_FILE), { recursive: true });
const logFd = openSync(LOG_FILE, 'a');
const child = runNpxTsx('src/tokens/token-spike-guard-daemon.ts', [], {
  cwd: ROOT,
  detached: true,
  stdio: ['ignore', logFd, logFd],
  windowsHide: true,
});

child.on('error', (err: Error) => {
  console.error('[spike-guard-ensure] spawn error:', err.message);
  process.exit(1);
});

setTimeout(() => {
  if (!child.pid || child.killed) {
    console.error('[spike-guard-ensure] el proceso no arrancó');
    process.exit(1);
  }
  child.unref();
  console.log(`[spike-guard-ensure] daemon iniciado (PID ${child.pid}, log ${LOG_FILE})`);
  process.exit(0);
}, 500);
