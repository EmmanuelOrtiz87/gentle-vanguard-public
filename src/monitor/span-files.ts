/**
 * span-files.ts — seleccion del span `session-start` realmente abierto.
 *
 * Los spans se escriben por dia (`spans-YYYY-MM-DD.jsonl`) y un cierre agrega
 * una linea con el mismo spanId y `endTimeUnixNano`. Dos cierres del stack
 * tomaban `readdirSync(...)[0]` sin ordenar: cerraban el span del dia mas
 * antiguo y dejaban el de la sesion actual abierto para siempre. Un solo
 * helper evita que la seleccion vuelva a divergir.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SpanRecord {
  name?: string;
  traceId?: string;
  spanId?: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  [key: string]: unknown;
}

/** Archivos de span de mas nuevo a mas viejo (el nombre lleva la fecha). */
export function listSpanFilesNewestFirst(spanDir: string): string[] {
  if (!existsSync(spanDir)) return [];
  return readdirSync(spanDir)
    .filter((name) => name.startsWith('spans-') && name.endsWith('.jsonl'))
    .sort()
    .reverse()
    .map((name) => join(spanDir, name));
}

function readRecords(file: string): SpanRecord[] {
  const records: SpanRecord[] = [];
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as SpanRecord;
      if (parsed && typeof parsed === 'object') records.push(parsed);
    } catch {
      /* linea malformada: se ignora */
    }
  }
  return records;
}

/**
 * Ultimo span `spanName` sin cierre, ignorando los que ya tienen un registro
 * de fin (en el mismo archivo o en otro: una sesion puede cruzar medianoche).
 * `maxAgeMs` descarta spans viejos que nunca se cerraron: no son la sesion de
 * hoy y cerrarlos le pondrian un cierre falso.
 */
export function findOpenSpan(
  spanDir: string,
  spanName = 'session-start',
  maxAgeMs = 48 * 60 * 60 * 1000,
): SpanRecord | null {
  const files = listSpanFilesNewestFirst(spanDir);
  if (files.length === 0) return null;

  const closed = new Set<string>();
  const parsed = files.map((file) => {
    const records = readRecords(file);
    for (const record of records) {
      if (record.endTimeUnixNano && record.spanId) closed.add(record.spanId);
    }
    return { file, records };
  });

  for (const { records } of parsed) {
    for (let i = records.length - 1; i >= 0; i--) {
      const record = records[i];
      if (record.name !== spanName) continue;
      if (!record.traceId || !record.spanId) continue;
      if (record.endTimeUnixNano || closed.has(record.spanId)) continue;
      const startedNs = Number(record.startTimeUnixNano);
      if (Number.isFinite(startedNs) && startedNs > 0) {
        const ageMs = Date.now() - startedNs / 1e6;
        if (ageMs > maxAgeMs) return null;
      }
      return record;
    }
  }
  return null;
}
