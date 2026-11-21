#!/usr/bin/env node
/**
 * session-expiry.ts — la politica de expiracion de sesiones, con un consumidor real.
 *
 * POR QUÉ (2026-11-18)
 * -------------------------------------------------------------------------
 * `config/session-autostart.config.json` declara `sessionExpiryHours: 8`, pero la clave
 * no la consumia NADA: era una promesa muda. La regla del stack es explicita — una
 * declaracion sin consumidor es un defecto, no un detalle — y el consumidor natural
 * existe: el sweeper de sesiones, que decide cuando una sesion deja de estar `active`.
 *
 * ANTES: el sweeper usaba 24 h fijos (constante en el codigo) y el config declaraba 8.
 * DESPUES: el sweeper usa `sessionExpiryHours` del config (fallback: su constante),
 * y el flag `--stale-hours` sigue mandando por encima del config.
 *
 * Reglas:
 * - El valor explicito (CLI) gana; el config es el default; la constante es el ultimo
 *   fallback (si el config no existe o esta corrupto).
 * - Un valor <= 0 se ignora: no hay "expiracion inmediata".
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SESSION_CONFIG_REL = join('config', 'session-autostart.config.json');

/** Ultimo fallback cuando el config no dice nada (24 h, el valor historico). */
const FALLBACK_EXPIRY_HOURS = 24;

/** Lee `sessionExpiryHours` del config de autostart. 0 si no hay valor usable. */
function readSessionExpiryHours(root: string): number {
  const path = resolve(root, SESSION_CONFIG_REL);
  if (!existsSync(path)) return 0;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    const value = Number(raw.sessionExpiryHours);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * Horas de expiracion efectivas: `explicit` (CLI) > config > fallback.
 * Un valor explicito <= 0 se descarta (no se puede "no expirar" por error).
 *
 * Esta es la API PUBLICA del modulo: el sweeper y el watchtower consumen esta
 * funcion. Los helpers internos no se exportan (exportar para que un test los
 * use los convierte en deadcode para el ratchet).
 */
export function resolveSessionExpiryHours(root: string, explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) return explicit;
  const configured = readSessionExpiryHours(root);
  if (configured > 0) return configured;
  return FALLBACK_EXPIRY_HOURS;
}
