#!/usr/bin/env tsx
/**
 * Session Claims — control plane v1 para sesiones de IA concurrentes.
 *
 * Problema que resuelve (evidencia 2026-11-02): varias sesiones (zcode, codex,
 * minimax, ...) trabajan el MISMO repo en paralelo y se pisan — TREE-FENCE del
 * prepush-gate abortó dos pushes por ediciones fuera de banda, y una sesión
 * pusheó encima del trabajo de otra. Este módulo da un registro de claims
 * ("estoy trabajando X") con TTL y validación de PID, para que una sesión
 * declare su intención ANTES de tocar y las demás la respeten.
 *
 * Diferencia con ProcessLock (process-lock-manager.ts): ese es un mutex de
 * proceso único para daemons; esto es un registro de intenciones multi-recurso
 * y multi-sesión, consultable por humanos y agentes (`list`), con expiración
 * automática (TTL) para que un crash no bloquee el recurso para siempre.
 *
 * USO (CLI):
 *   node --import tsx src/core/session-claims.ts claim apps/command-center --note "fix stop"
 *   node --import tsx src/core/session-claims.ts renew apps/command-center
 *   node --import tsx src/core/session-claims.ts release apps/command-center
 *   node --import tsx src/core/session-claims.ts list
 *
 * USO (API):
 *   import { claim, release, renew, listClaims } from '../core/session-claims.js';
 *
 * Contrato:
 *  - claim() falla si otro claim ACTIVO (PID vivo, no expirado) cubre el recurso.
 *  - Un claim del propio session id es idempotente (renueva y actualiza nota).
 *  - list() poda expirados y claims con PID muerto (stale) antes de reportar.
 *  - Identidad de sesión: env GV_SESSION_ID, o "pid-<pid>@<host>".
 *
 * @version 1.0.0
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { hostname } from 'os';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

const CLAIMS_FILE = join(resolve(process.cwd()), '.runtime', 'session-claims.json');
const DEFAULT_TTL_MIN = 30;

export interface SessionClaim {
  resource: string;
  session: string;
  pid: number;
  note?: string;
  acquiredAt: string;
  expiresAt: string;
}

interface ClaimsRegistry {
  version: 1;
  claims: SessionClaim[];
}

export interface ClaimResult {
  ok: boolean;
  claim?: SessionClaim;
  conflict?: SessionClaim;
  reason?: 'active-conflict' | 'invalid-resource';
}

function registryFilePath(): string {
  // Override para tests y para operar el registro de otro root sin cambiar cwd.
  return process.env.GV_CLAIMS_FILE || CLAIMS_FILE;
}

export function sessionId(): string {
  return process.env.GV_SESSION_ID || `pid-${process.pid}@${hostname()}`;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Un claim expira por TTL siempre; la validación de PID solo aplica a la
 * identidad implícita "pid-<pid>@<host>" (proceso largo: muerto → stale).
 * Las sesiones declaradas (GV_SESSION_ID) son efímeras en el registro: el
 * proceso que hizo el claim CLI ya salió, pero el claim sigue siendo suyo
 * hasta que venza el TTL o haga release.
 */
function isStale(c: SessionClaim, now: number): boolean {
  if (Date.parse(c.expiresAt) <= now) return true;
  if (c.session.startsWith('pid-')) return !isAlive(c.pid);
  return false;
}

function readRegistry(): ClaimsRegistry {
  try {
    if (!existsSync(registryFilePath())) return { version: 1, claims: [] };
    const parsed = JSON.parse(readFileSync(registryFilePath(), 'utf-8'));
    if (parsed?.version === 1 && Array.isArray(parsed.claims)) return parsed;
    return { version: 1, claims: [] };
  } catch {
    // Registro corrupto → se reinicia; es estado derivable, nunca fuente de verdad.
    return { version: 1, claims: [] };
  }
}

function writeRegistry(reg: ClaimsRegistry): void {
  mkdirSync(join(registryFilePath(), '..'), { recursive: true });
  writeFileSync(registryFilePath(), `${JSON.stringify(reg, null, 2)}\n`);
}

/** Poda claims expirados o con PID muerto. Escribe el registro si algo se podó. */
export function pruneStale(now = Date.now()): SessionClaim[] {
  const reg = readRegistry();
  const kept = reg.claims.filter((c) => !isStale(c, now));
  if (kept.length !== reg.claims.length) writeRegistry({ version: 1, claims: kept });
  return kept;
}

export function claim(
  resource: string,
  opts: { note?: string; ttlMin?: number; session?: string } = {},
): ClaimResult {
  if (!resource || resource.includes('..')) return { ok: false, reason: 'invalid-resource' };
  const session = opts.session ?? sessionId();
  const ttlMs = (opts.ttlMin ?? DEFAULT_TTL_MIN) * 60_000;
  const active = pruneStale();
  const conflict = active.find((c) => c.resource === resource && c.session !== session);
  if (conflict) return { ok: false, conflict, reason: 'active-conflict' };

  const now = new Date();
  const entry: SessionClaim = {
    resource,
    session,
    pid: process.pid,
    note: opts.note,
    acquiredAt: active.find((c) => c.resource === resource)?.acquiredAt ?? now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
  const rest = active.filter((c) => c.resource !== resource);
  writeRegistry({ version: 1, claims: [...rest, entry] });
  return { ok: true, claim: entry };
}

export function release(resource: string, session = sessionId()): boolean {
  const active = pruneStale();
  const target = active.find((c) => c.resource === resource && c.session === session);
  if (!target) return false;
  writeRegistry({
    version: 1,
    claims: active.filter((c) => c !== target),
  });
  return true;
}

export function renew(resource: string, ttlMin = DEFAULT_TTL_MIN, session = sessionId()): boolean {
  const active = pruneStale();
  const target = active.find((c) => c.resource === resource && c.session === session);
  if (!target) return false;
  target.expiresAt = new Date(Date.now() + ttlMin * 60_000).toISOString();
  writeRegistry({ version: 1, claims: active });
  return true;
}

export function listClaims(): SessionClaim[] {
  return pruneStale();
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
function main(): number {
  const [cmd, resource, ...rest] = process.argv.slice(2);
  const noteFlag = rest.indexOf('--note');
  const note = noteFlag >= 0 ? rest[noteFlag + 1] : undefined;
  const ttlFlag = rest.indexOf('--ttl');
  const ttlMin = ttlFlag >= 0 ? Number(rest[ttlFlag + 1]) : undefined;

  switch (cmd) {
    case 'claim': {
      if (!resource) {
        console.error('Uso: claim <resource> [--note "texto"] [--ttl minutos]');
        return 2;
      }
      const res = claim(resource, { note, ttlMin });
      if (res.ok) {
        console.log(`[CLAIM OK] ${resource} → ${res.claim?.session} (expira ${res.claim?.expiresAt})`);
        return 0;
      }
      if (res.reason === 'active-conflict') {
        console.error(
          `[CLAIM CONFLICT] ${resource} lo tiene ${res.conflict?.session} (PID ${res.conflict?.pid}, expira ${res.conflict?.expiresAt})${res.conflict?.note ? ` — "${res.conflict.note}"` : ''}`,
        );
        return 1;
      }
      console.error(`[CLAIM FAIL] recurso inválido: ${resource}`);
      return 2;
    }
    case 'release': {
      console.log(release(resource ?? '') ? `[RELEASE OK] ${resource}` : `[RELEASE SKIP] sin claim propio sobre ${resource}`);
      return 0;
    }
    case 'renew': {
      console.log(
        renew(resource ?? '', ttlMin) ? `[RENEW OK] ${resource}` : `[RENEW SKIP] sin claim propio sobre ${resource}`,
      );
      return 0;
    }
    case 'list': {
      const claims = listClaims();
      if (claims.length === 0) {
        console.log('Sin claims activos.');
        return 0;
      }
      for (const c of claims) {
        console.log(
          `${c.resource.padEnd(40)} ${c.session.padEnd(28)} expira ${c.expiresAt}${c.note ? ` — ${c.note}` : ''}`,
        );
      }
      return 0;
    }
    default:
      console.error('Uso: session-claims.ts <claim|release|renew|list> [resource] [--note t] [--ttl min]');
      return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main());
}
