#!/usr/bin/env tsx
/**
 * apps-keepalive — auto-reparación de las apps del stack (Fase apps N1).
 *
 * Tarea programada (Gentle-Vanguard-Apps-KeepAlive, cada 15 min): consulta el
 * Command Center y reinicia cualquier app que no esté `running`. Complementa al
 * watchtower: este cura DAEMONS del stack; el keepalive cura las APPS.
 *
 * Silent-exit si el CC no responde en este intento (el siguiente ciclo reintenta;
 * el CC en sí lo revive el siguiente ciclo vía apps/command-center/start.ts).
 *
 * Exit codes: 0 — ciclo completado · 1 — error inesperado.
 */

import { readFileSync, appendFileSync } from 'fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)), '..');
const LOG = join(ROOT, '.runtime', 'apps-keepalive.log');
const PORTS_FILE = join(ROOT, '.runtime', 'command-center-ports.json');

function log(msg: string): void {
  const ts = new Date().toISOString().slice(0, 19);
  try {
    appendFileSync(LOG, `[${ts}] ${msg}\n`);
  } catch {
    /* best-effort */
  }
}

function ccPort(): number {
  try {
    const data = JSON.parse(readFileSync(PORTS_FILE, 'utf-8')) as { ccPort?: number };
    if (typeof data.ccPort === 'number') return data.ccPort;
  } catch {
    /* fallback abajo */
  }
  return 8090;
}

function startCcDetached(): void {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', join(ROOT, 'apps', 'command-center', 'start.ts'), '--no-browser'],
    { cwd: ROOT, detached: true, windowsHide: true, stdio: 'ignore' },
  );
  child.unref();
}

async function main(): Promise<number> {
  const port = ccPort();

  // CC vivo? Si no, revivirlo (daemon persistente) y salir — las apps se
  // atienden en el próximo ciclo cuando el CC ya responda.
  try {
    const health = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!health.ok) throw new Error(`status ${health.status}`);
  } catch {
    log(`CC no responde en :${port} — reviviendo command-center`);
    startCcDetached();
    return 0;
  }

  // Apps caídas → reiniciarlas vía CC (idempotente: solo arranca lo que falta)
  const res = await fetch(`http://127.0.0.1:${port}/api/apps`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    log(`[WARN] /api/apps respondió ${res.status}`);
    return 0;
  }
  const apps = (await res.json()) as Array<{ id: string; status: string }>;
  const stopped = apps.filter((a) => a.status !== 'running');

  if (stopped.length === 0) {
    log(`[OK] ${apps.length}/${apps.length} apps running — nada que hacer`);
    return 0;
  }

  for (const app of stopped) {
    try {
      const start = await fetch(`http://127.0.0.1:${port}/api/apps/${app.id}/start`, {
        method: 'POST',
        signal: AbortSignal.timeout(90000),
      });
      const body = (await start.json()) as { status?: string };
      log(`[FIX] ${app.id}: ${app.status} → ${body.status ?? start.status}`);
    } catch (err) {
      log(`[WARN] ${app.id}: no se pudo reiniciar (${String(err).slice(0, 80)})`);
    }
  }
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    log(`[ERROR] ${err instanceof Error ? err.stack : String(err)}`);
    process.exitCode = 1;
  });
