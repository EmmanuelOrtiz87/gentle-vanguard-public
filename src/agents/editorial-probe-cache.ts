/**
 * Cache de la sonda editorial (`editorial-operability.ts`).
 *
 * El probe gasta 1 llamada al proveedor cada 24 h; dentro de la ventana reporta
 * el veredicto guardado. Ese reporte NO debe reescribir el registro: la version
 * anterior guardaba su propio resumen (`state: 'recent'`), el veredicto original
 * desaparecia y el step fallaba en cada arranque de sesion (medido 2026-11-24).
 */

export const PROBE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface CachedVerdict {
  state: 'operable' | 'broken';
  hoursAgo: number;
}

/**
 * Veredicto cacheado utilizable, o `null` si hay que correr la sonda real:
 * registro ausente/ilegible, vencido (>24 h) o `recent` (registro auto-pisado
 * por una version anterior — se ignora para que la sonda se auto-cure).
 */
export function cachedVerdict(last: unknown, now: number): CachedVerdict | null {
  if (!last || typeof last !== 'object') return null;
  const rec = last as { at?: unknown; state?: unknown };
  if (typeof rec.at !== 'string') return null;
  if (rec.state !== 'operable' && rec.state !== 'broken') return null;
  const at = new Date(rec.at).getTime();
  if (!Number.isFinite(at)) return null;
  const age = now - at;
  if (age >= PROBE_MAX_AGE_MS) return null;
  return { state: rec.state, hoursAgo: +(age / 3_600_000).toFixed(1) };
}
