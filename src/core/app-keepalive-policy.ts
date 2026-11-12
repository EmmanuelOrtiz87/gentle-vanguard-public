/**
 * app-keepalive-policy.ts — fuente única de la política de auto-arranque.
 *
 * Decisión del owner (2026-09-26, ratificada 2026-10-21): NINGÚN proceso se
 * auto-arranca tras reboot/wake sin acción explícita. El estado por defecto es
 * `on-demand`; una app solo se auto-revive si su clave vale `always` en
 * `config/apps-keepalive.json`.
 *
 * Por qué existe este módulo: los chequeos de salud interpretaban "no está
 * escuchando" como fallo. Para un servicio `on-demand` eso es el estado
 * correcto, no una avería — reportarlo como FAIL generaba una alerta
 * permanente (29 fallos consecutivos medidos en el dashboard WS) que tapaba
 * fallos reales.
 *
 * Fail-safe: si la config no se puede leer, se asume `on-demand`. Nunca se
 * auto-arranca nada por un error de lectura.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type KeepalivePolicy = 'always' | 'on-demand';

interface KeepaliveConfig {
  default?: string;
  apps?: Record<string, string>;
}

/**
 * Devuelve la política vigente para una app.
 *
 * @param appKey clave en `apps` (ej. `dashboard`, `analytics`)
 * @param root raíz del repo (default: cwd)
 */
export function readAppKeepalivePolicy(appKey: string, root: string = process.cwd()): KeepalivePolicy {
  try {
    const raw = readFileSync(join(root, 'config', 'apps-keepalive.json'), 'utf-8');
    const config = JSON.parse(raw) as KeepaliveConfig;
    const value = config.apps?.[appKey] ?? config.default;
    return value === 'always' ? 'always' : 'on-demand';
  } catch {
    return 'on-demand';
  }
}

/**
 * `true` cuando el servicio puede estar legitimamente detenido.
 * Es la pregunta que hacen los chequeos de salud antes de marcar un fallo.
 */
export function isOnDemand(appKey: string, root: string = process.cwd()): boolean {
  return readAppKeepalivePolicy(appKey, root) === 'on-demand';
}
