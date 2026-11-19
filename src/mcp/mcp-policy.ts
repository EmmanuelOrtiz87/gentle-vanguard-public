/**
 * mcp-policy.ts — lectura unica de la politica de ciclo de vida MCP.
 *
 * POR QUE (2026-11-18)
 * -------------------------------------------------------------------------
 * La politica vivia dentro de `src/tools/mcp-lifecycle.ts`, que es una
 * herramienta de censo: pesada, con lectura de transcripts, y usada sobre todo
 * para diagnóstico. Eso impedia que los consumidores EN RUNTIME la consultaran,
 * y el resultado fue que cada consumidor decidia por su cuenta:
 *
 *   - `src/mcp/mcp-gateway.ts` arrancaba TODOS los servidores con
 *     `enabled: true`, ignorando `autoStart` y la politica.
 *   - `src/core/watchtower/checks-infra.ts` reportaba FAIL de codegraph
 *     despues de apagado por decision.
 *   - `src/core/maintenance-watchtower.ts` resucitaba la capacidad apagada.
 *
 * Regla derivada: **la politica se lee desde un modulo chico, sin efectos
 * secundarios, que todos los consumidores pueden importar.** Si un consumidor
 * decide por su cuenta, la decision no es de nadie.
 *
 * Este modulo no lee transcripts, no lanza procesos y no escribe nada.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type Activation =
  | 'always-on'
  | 'warm-when-developing'
  | 'warm-when-using-skills'
  | 'on-demand'
  | 'disabled-by-policy';

export interface PolicyEntry {
  role?: string;
  criticality?: string;
  activation?: Activation;
  management?: string;
  verification?: string;
  surfaces?: Record<string, Activation>;
  notes?: string;
}

export interface Policy {
  servers: Record<string, PolicyEntry>;
}

export interface RegistryEntry {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  type?: string;
  enabled?: boolean;
  autoStart?: boolean;
  description?: string;
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(path, 'utf-8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** La politica canonica. Fuente de verdad unica del ciclo de vida MCP. */
export function loadPolicy(root = resolve(process.cwd())): Policy {
  const raw = readJson(join(root, 'config', 'mcp-lifecycle-policy.json'));
  return { servers: (raw?.servers as Record<string, PolicyEntry>) ?? {} };
}

/** El registro del stack: inventario de servidores disponibles (no de arranque). */
export function loadRegistry(root = resolve(process.cwd())): RegistryEntry[] {
  const raw = readJson(join(root, 'config', 'mcp-registry.json'));
  return Array.isArray(raw?.servers) ? (raw.servers as RegistryEntry[]) : [];
}

/**
 * Normaliza un nombre para comparar aliases: `engram-mcp` y `engram` son el
 * mismo componente, `skill-server` y `gentle-vanguard-skills` tambien.
 */
export function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[-_](mcp|server|svc)$/, '');
}

/**
 * Resuelve el nombre canonico de un servidor en la POLITICA.
 *
 * La identidad de un componente es su FIRMA, no su nombre: el registro dice
 * `engram-mcp` y la politica dice `engram`. Sin esta resolucion, el consumidor
 * no encuentra la invariante y decide por su cuenta.
 */
export function resolvePolicyKey(policy: Policy, name: string): string | undefined {
  if (policy.servers[name]) return name;
  const normalized = normalizeName(name);
  const exact = Object.keys(policy.servers).find((key) => normalizeName(key) === normalized);
  if (exact) return exact;
  // Prefijo comun: `skill-server` ~ `gentle-vanguard-skills`.
  const fuzzy = Object.keys(policy.servers).find((key) => {
    const a = normalizeName(key);
    const b = normalized;
    return a.includes(b) || b.includes(a);
  });
  return fuzzy;
}

/**
 * Activacion efectiva de un servidor en una superficie concreta.
 * `undefined` = la politica no declara invariante para ese servidor.
 */
export function activationFor(
  policy: Policy,
  name: string,
  surfaceId = 'repo',
): Activation | undefined {
  const key = resolvePolicyKey(policy, name);
  if (!key) return undefined;
  const entry = policy.servers[key];
  const perSurface = entry.surfaces?.[surfaceId];
  if (perSurface) return perSurface;
  return entry.activation;
}

/**
 * Un servidor puede auto-arrancarse solo si la politica lo permite.
 *
 * Regla del owner: lo pesado a demanda, lo indispensable siempre.
 * `on-demand` y `disabled-by-policy` NUNCA se auto-arrancan.
 */
export function mayAutoStart(policy: Policy, name: string, surfaceId = 'repo'): boolean {
  const activation = activationFor(policy, name, surfaceId);
  if (!activation) return true; // sin invariante: decide el registro
  return activation === 'always-on' || activation.startsWith('warm-when');
}

/** Razon legible de por que un servidor no puede auto-arrancarse. */
export function autoStartReason(policy: Policy, name: string, surfaceId = 'repo'): string | null {
  const activation = activationFor(policy, name, surfaceId);
  if (!activation) return null;
  if (activation === 'always-on' || activation.startsWith('warm-when')) return null;
  return `politica: ${activation}`;
}
