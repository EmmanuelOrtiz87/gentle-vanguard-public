#!/usr/bin/env tsx
/**
 * apps-keepalive — auto-reparación de las apps del stack (Fase apps N1).
 *
 * Tarea programada (Gentle-Vanguard-Apps-KeepAlive, cada 15 min): consulta el
 * Command Center y reinicia las apps caídas SEGÚN POLÍTICA
 * (config/apps-keepalive.json): solo las apps `always` se reviven. Las
 * `on-demand` (dashboard, gv-music) NUNCA se auto-arrancan — se levantan con
 * acción explícita (CC UI/API o start.sh nativo). Complementa al watchtower:
 * este cura las APPS; el autoheal cura los DAEMONS del stack.
 *
 * Fail-safe: sin política válida no se arranca NADA (las apps no deben
 * levantarse por sorpresa — ver el incidente "ejecuté CC y se levantó music").
 * Silent-exit si el CC no responde en este intento (el siguiente ciclo
 * reintenta; el CC en sí lo revive este script vía start.ts --no-browser).
 *
 * Exit codes: 0 — ciclo completado · 1 — error inesperado.
 */

import { readFileSync, appendFileSync, existsSync } from 'fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)), '..');
const LOG = join(ROOT, '.runtime', 'apps-keepalive.log');
const PORTS_FILE = join(ROOT, '.runtime', 'command-center-ports.json');
const POLICY_FILE = join(ROOT, 'config', 'apps-keepalive.json');
/**
 * Session-close guard (added 2026-09-16 — ventanas fantasma fix).
 *
 * If the session-close orchestrator is running, it creates this marker BEFORE
 * it kills any daemon. apps-keepalive bails out immediately when present,
 * so it doesn't revive apps that the orchestrator is in the middle of stopping.
 *
 * Cleared by session-autostart when a new session starts.
 */
const CLOSING_MARKER = join(ROOT, '.session', '.closing');

export type KeepalivePolicyValue = 'always' | 'on-demand';

export interface KeepalivePolicy {
  default: KeepalivePolicyValue;
  apps: Record<string, KeepalivePolicyValue>;
}

export type LoadPolicyResult =
  | { ok: true; policy: KeepalivePolicy }
  | { ok: false; reason: string };

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

/**
 * Carga y valida config/apps-keepalive.json. `path` es inyectable para tests.
 * Cualquier defecto (falta, JSON inválido, valor fuera de dominio) → ok:false:
 * el caller NO debe arrancar apps sin política válida.
 */
export function loadKeepalivePolicy(path: string = POLICY_FILE): LoadPolicyResult {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return { ok: false, reason: `no se pudo leer ${path}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: `JSON inválido: ${String(err).slice(0, 80)}` };
  }
  const obj = parsed as { default?: unknown; apps?: unknown };
  const fallbackDefault: KeepalivePolicyValue = 'on-demand';
  const def =
    obj.default === 'always' || obj.default === 'on-demand' ? obj.default : fallbackDefault;
  const apps: Record<string, KeepalivePolicyValue> = {};
  if (obj.apps && typeof obj.apps === 'object') {
    for (const [id, value] of Object.entries(obj.apps as Record<string, unknown>)) {
      if (value === 'always' || value === 'on-demand') apps[id] = value;
    }
  }
  return { ok: true, policy: { default: def, apps } };
}

/**
 * Filtra las apps caídas según política: solo las `always` se reinician.
 * Pure function — testeable sin CC ni red.
 */
export function selectAppsToStart(
  apps: Array<{ id: string; status: string }>,
  policy: KeepalivePolicy,
): { toStart: Array<{ id: string; status: string }>; skippedOnDemand: string[] } {
  const policyFor = (id: string): KeepalivePolicyValue => policy.apps[id] ?? policy.default;
  const stopped = apps.filter((a) => a.status !== 'running');
  return {
    toStart: stopped.filter((a) => policyFor(a.id) === 'always'),
    skippedOnDemand: stopped.filter((a) => policyFor(a.id) === 'on-demand').map((a) => a.id),
  };
}

async function main(): Promise<number> {
  // Guard de cierre: si la sesión está cerrando, no revivir nada. Evita
  // race con session-close-orchestrator (que ya está matando los daemons).
  if (existsSync(CLOSING_MARKER)) {
    log('[GUARD] Sesión cerrando (.session/.closing presente) — saliendo sin tocar');
    return 0;
  }

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

  // Fail-safe de política: sin política válida no se arranca nada.
  const policyResult = loadKeepalivePolicy();
  if (!policyResult.ok) {
    log(`[GUARD] Política inválida (${policyResult.reason}) — no se arranca nada`);
    return 0;
  }

  const res = await fetch(`http://127.0.0.1:${port}/api/apps`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    log(`[WARN] /api/apps respondió ${res.status}`);
    return 0;
  }
  const apps = (await res.json()) as Array<{ id: string; status: string }>;
  const { toStart, skippedOnDemand } = selectAppsToStart(apps, policyResult.policy);

  if (toStart.length === 0) {
    const skipped =
      skippedOnDemand.length > 0 ? ` (on-demand intactas: ${skippedOnDemand.join(', ')})` : '';
    log(`[OK] nada que reparar entre las apps 'always'${skipped}`);
    return 0;
  }

  for (const app of toStart) {
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
  if (skippedOnDemand.length > 0)
    log(`[SKIP] on-demand no tocadas: ${skippedOnDemand.join(', ')}`);
  return 0;
}

const isMainModule =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!);
if (isMainModule) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      log(`[ERROR] ${err instanceof Error ? err.stack : String(err)}`);
      process.exitCode = 1;
    });
}
