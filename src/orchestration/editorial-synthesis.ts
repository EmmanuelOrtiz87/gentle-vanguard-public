export interface EditorialSource {
  id: string;
  name: string;
  text: string;
}

/** Extrae el primer objeto JSON balanceado del render de un proveedor: los CLI pueden
 * envolver el JSON en prosa o texto de control; JSON.parse estricto los rechaza.
 * Respeta strings y escapes; falla con mensaje claro si no hay objeto o está cortado. */
export function extractJsonObject(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
  let first: unknown;
  let start = text.indexOf('{');
  while (start >= 0) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = !inString;
      if (inString) continue;
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          const candidate = JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>;
          if (!first) first = candidate;
          if (Object.keys(candidate).length > 0) return candidate;
          break;
        }
      }
    }
    start = text.indexOf('{', start + 1);
  }
  if (first) return first;
  throw new Error('Sin objeto JSON en la salida.');
}

/** Normaliza los hallazgos de la revisión a cadenas: los modelos pueden devolver
 * objetos {fragment, discrepancy} aunque el contrato pida strings; el contenido del
 * hallazgo se conserva, nunca se descarta. */
export function normalizeFindings(items: unknown[]): string[] {
  return items.map((item) => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      const parts = Object.values(item as Record<string, unknown>).filter(
        (value): value is string => typeof value === 'string' && value.trim().length > 0,
      );
      if (parts.length) return parts.join(' — ');
      return JSON.stringify(item);
    }
    return String(item);
  });
}

export function readSynthesisSources(context: string): EditorialSource[] {
  const sources: unknown = JSON.parse(context);
  if (
    !Array.isArray(sources) ||
    sources.length < 2 ||
    !sources.every(
      (source, index) =>
        source &&
        source.id === `F${index + 1}` &&
        typeof source.name === 'string' &&
        source.name.trim() &&
        typeof source.text === 'string' &&
        source.text.trim(),
    )
  )
    throw new Error('La síntesis requiere al menos dos fuentes identificadas y legibles.');
  return sources;
}

export function checkEvidence(sources: EditorialSource[], evidence: unknown): string[] {
  if (!Array.isArray(evidence)) return ['Falta la evidencia textual por fuente.'];
  const findings: string[] = [];
  const covered = new Set<string>();
  for (const item of evidence) {
    const source = sources.find(({ id }) => id === item?.sourceId);
    if (
      !source ||
      typeof item.quote !== 'string' ||
      !item.quote.trim() ||
      !source.text.includes(item.quote)
    ) {
      findings.push('Hay una cita que no coincide literalmente con la fuente indicada.');
    } else {
      covered.add(source.id);
    }
  }
  for (const { id } of sources) {
    if (!covered.has(id)) findings.push(`Falta evidencia literal de ${id}.`);
  }
  return findings;
}
