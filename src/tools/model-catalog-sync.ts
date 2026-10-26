export interface ModelEntry {
  name?: string;
  [key: string]: unknown;
}

/** Custom providers need explicit models; an unreachable catalog never justifies pruning. */
export function syncProviderModels(
  provider: {models?: Record<string, ModelEntry>},
  report: {catalogOK?: boolean; upstreamCatalog?: string[]},
  addMissing: boolean,
): {removed: number; added: number} {
  if (!report.catalogOK) return {removed:0, added:0};
  const models=provider.models ?? (provider.models={});
  const upstream=new Set(report.upstreamCatalog ?? []);
  let removed=0, added=0;
  for (const id of Object.keys(models)) {
    if (!upstream.has(id)) {delete models[id]; removed++;}
  }
  if (addMissing) {
    for (const id of upstream) {
      if (!Object.hasOwn(models,id)) {models[id]={name:id}; added++;}
    }
  }
  return {removed, added};
}
