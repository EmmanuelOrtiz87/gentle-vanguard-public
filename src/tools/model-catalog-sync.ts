export interface ModelEntry {
  name?: string;
  [key: string]: unknown;
}

/**
 * Ollama publica `name:latest` para los modelos sin tag explicito; los demas
 * catalogs OpenAI-compatibles devuelven el id exacto (nunca `:latest`).
 * Comparar sin normalizar inventa deriva y poda configs que funcionan: el
 * 2026-11-14 el doctor ya lo corrigio, pero `models-sync` seguia comparando
 * a pelo yacia borrar `qwen3-14b-32k` (instalado, con `tools`, medido).
 *
 * Definicion unica: la reexporta tambien el doctor para que no haya dos reglas.
 */
export function normalizeModelId(id: string): string {
  return id.replace(/:latest$/, '');
}

/** Custom providers need explicit models; an unreachable catalog never justifies pruning. */
export function syncProviderModels(
  provider: { models?: Record<string, ModelEntry> },
  report: { catalogOK?: boolean; upstreamCatalog?: string[] },
  addMissing: boolean,
): { removed: number; added: number } {
  if (!report.catalogOK) return { removed: 0, added: 0 };
  const models = provider.models ?? (provider.models = {});
  const upstream = new Set((report.upstreamCatalog ?? []).map(normalizeModelId));
  let removed = 0,
    added = 0;
  for (const id of Object.keys(models)) {
    if (!upstream.has(normalizeModelId(id))) {
      delete models[id];
      removed++;
    }
  }
  if (addMissing) {
    for (const id of report.upstreamCatalog ?? []) {
      if (
        !Object.hasOwn(models, id) &&
        ![...Object.keys(models)].some((m) => normalizeModelId(m) === normalizeModelId(id))
      ) {
        models[id] = { name: id };
        added++;
      }
    }
  }
  return { removed, added };
}
