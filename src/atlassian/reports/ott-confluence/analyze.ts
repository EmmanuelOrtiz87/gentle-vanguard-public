import type { PageLite } from './types.js';

const DAY = 86_400_000;

export interface SpaceSummary {
  total: number;
  d30: number;
  staleOverYear: number;
  read: string;
}

/** Frescura de un espacio a partir de metadatos de página (sin leer cuerpos). */
export function summarizeSpace(pages: PageLite[], nowMs: number): SpaceSummary {
  const ages = pages.map((p) =>
    p.lastModified ? (nowMs - Date.parse(p.lastModified)) / DAY : Number.POSITIVE_INFINITY,
  );
  const total = pages.length;
  const d30 = ages.filter((x) => x <= 30).length;
  const staleOverYear = ages.filter((x) => x > 365).length;
  const read =
    total === 0
      ? 'Espacio vacío'
      : d30 === 0
        ? 'Sin actividad reciente'
        : staleOverYear / total > 0.6
          ? 'Activo sobre base envejecida'
          : 'Activo';
  return { total, d30, staleOverYear, read };
}
