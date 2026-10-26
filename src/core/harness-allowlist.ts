/**
 * harness-allowlist.ts — Exenciones auditables al tripwire anti-contaminación.
 *
 * El tripwire sirve para que un veredicto de evaluador no entre al contexto de
 * otra tarea. Pero hay una diferencia real entre "un veredicto medido" y
 * "documentación que explica cómo escribir un veredicto".
 *
 * La excepción se declara por archivo **y** por marcador concreto: un
 * marcador nuevo en el mismo archivo vuelve a disparar, y un archivo sin
 * excepción nunca queda exento.
 *
 * **Por qué vive en un módulo propio:** el doctor y el bucle tienen que
 * aplicar la MISMA regla. Cuando cada uno tenía su propia copia, el doctor
 * daba 0 errores sobre una superficie limpia y el bucle abortaba en el
 * tripwire por los mismos tres archivos: dos oráculos para la misma regla, y
 * el que no knew de las exenciones era el que corría en producción.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Una exención: archivo concreto + marcadores concretos + por qué. */
export interface VerdictExemption {
  /** Ruta relativa a la raíz del repo. */
  path: string;
  /** Marcadores exentos en ese archivo. */
  markers: string[];
  /** Por qué se exime (se muestra en el reporte). */
  reason: string;
}

/** Allowlist indexada por path. */
export type VerdictExemptions = Map<string, VerdictExemption>;

/** Ruta de la allowlist dentro del repo. */
export const ALLOWLIST_REL_PATH = 'config/harness-doctor-allowlist.json';

/**
 * Carga la allowlist de exenciones.
 *
 * Si el archivo no existe o esta roto, devuelve una allowlist VACIA: el
 * tripwire se aplica sin exenciones (fail closed).
 */
export function loadVerdictExemptions(root: string): VerdictExemptions {
  const out: VerdictExemptions = new Map();
  const path = join(root, 'config', 'harness-doctor-allowlist.json');
  if (!existsSync(path)) return out;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
      verdictMarkers?: VerdictExemption[];
    };
    for (const entry of parsed.verdictMarkers ?? []) {
      if (entry?.path && Array.isArray(entry.markers)) out.set(entry.path, entry);
    }
  } catch {
    /* allowlist ilegible: se aplica el tripwire sin exenciones (fail closed) */
  }
  return out;
}

/**
 * ¿Este marcador concreto está exento en este archivo concreto?
 *
 * La exención es por (archivo, marcador): un marcador distinto en el mismo
 * archivo NO queda exento.
 */
export function isExempt(
  exemptions: VerdictExemptions | undefined,
  path: string,
  marker: string
): VerdictExemption | undefined {
  const entry = exemptions?.get(path);
  if (!entry) return undefined;
  return entry.markers.includes(marker) ? entry : undefined;
}
