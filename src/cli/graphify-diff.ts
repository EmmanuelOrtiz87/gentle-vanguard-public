/**
 * graphify-diff — núcleo PURO de diff-impact para graphify (absorbido de la idea
 * `/understand-diff` de Egonex-AI/Understand-Anything, 2026-11-18).
 *
 * Dado el grafo AST de graphify y una lista de archivos cambiados (git), calcula
 * el impacto pre-commit: qué símbolos del grafo toca cada archivo y qué símbolos
 * externos llaman a los cambiados (riesgo de regresión) o son llamados por ellos
 * (dependencias del cambio).
 *
 * Es puro a propósito: es el sujeto del pilot de mutation testing (Stryker,
 * `npm run test:mutation`) — la regla de oráculo independiente de
 * NORMATIVAS-TESTING.md §7 exige lógica de contrato con tests que maten mutantes.
 */

export interface GraphNode {
  id: string;
  label?: string;
  norm_label?: string;
  source_file?: string;
  source_location?: string;
  file_type?: string;
  community?: number;
  kind?: string;
  [key: string]: unknown;
}

export interface GraphEdge {
  source: string;
  target: string;
  key?: string;
  type?: string;
  label?: string;
  [key: string]: unknown;
}

export interface Graph {
  nodes: GraphNode[];
  links?: GraphEdge[];
  edges?: GraphEdge[];
}

export interface TouchedFile {
  file: string;
  matchedSymbols: Array<{ id: string; label?: string; kind?: string; source_location?: string }>;
  fileNodes: string[];
}

export interface ImpactedSymbol {
  id: string;
  label?: string;
  source_file?: string;
  source_location?: string;
  calls: number;
}

export interface DiffImpactReport {
  files: TouchedFile[];
  impact: { callers: ImpactedSymbol[]; callees: ImpactedSymbol[] };
  notInGraph: string[];
}

const toPosix = (value: string): string => value.replace(/\\/g, '/').replace(/^\.\//, '');

/** Cambios de un archivo afectan a su propio path exacto (formato del grafo: ruta relativa POSIX). */
function nodesForFile(graph: Graph, file: string): GraphNode[] {
  const target = toPosix(file);
  return graph.nodes.filter((node) => toPosix(node.source_file ?? '') === target);
}

export function computeDiffImpact(
  graph: Graph,
  changedFiles: string[],
  max = 25,
): DiffImpactReport {
  const edges = graph.links ?? graph.edges ?? [];
  const files: TouchedFile[] = [];
  const notInGraph: string[] = [];
  const changedSymbolIds = new Set<string>();

  for (const file of changedFiles) {
    const matched = nodesForFile(graph, file);
    if (matched.length === 0) {
      notInGraph.push(file);
      continue;
    }
    const fileNodes: string[] = [];
    for (const node of matched) {
      if (node.kind === 'file') fileNodes.push(node.id);
      else changedSymbolIds.add(node.id);
    }
    files.push({
      file,
      fileNodes,
      matchedSymbols: matched
        .filter((node) => node.kind !== 'file')
        .slice(0, max)
        .map((node) => ({
          id: node.id,
          label: node.label,
          kind: node.kind,
          source_location: node.source_location,
        })),
    });
  }

  // Impacto = relaciones `calls` con símbolos cambiados.
  // callers: símbolos externos que LLAMAN a código cambiado → riesgo de regresión.
  // callees: símbolos que el código cambiado LLAMA → dependencias que heredan el cambio.
  const callers = new Map<string, ImpactedSymbol>();
  const callees = new Map<string, ImpactedSymbol>();
  const self = new Set<string>();
  for (const node of graph.nodes) {
    if (changedSymbolIds.has(node.id)) self.add(node.id);
  }
  const isChangedFileNode = (id: string): boolean =>
    files.some((touched) => touched.fileNodes.includes(id));

  for (const edge of edges) {
    if (edge.type !== 'calls') continue;
    if (
      changedSymbolIds.has(edge.target) &&
      !changedSymbolIds.has(edge.source) &&
      !isChangedFileNode(edge.source)
    ) {
      const node = graph.nodes.find((candidate) => candidate.id === edge.source);
      const entry = callers.get(edge.source) ?? {
        id: edge.source,
        label: node?.label,
        source_file: node?.source_file,
        source_location: node?.source_location,
        calls: 0,
      };
      entry.calls += 1;
      callers.set(edge.source, entry);
    }
    if (
      changedSymbolIds.has(edge.source) &&
      !changedSymbolIds.has(edge.target) &&
      !isChangedFileNode(edge.target)
    ) {
      const node = graph.nodes.find((candidate) => candidate.id === edge.target);
      const entry = callees.get(edge.target) ?? {
        id: edge.target,
        label: node?.label,
        source_file: node?.source_file,
        source_location: node?.source_location,
        calls: 0,
      };
      entry.calls += 1;
      callees.set(edge.target, entry);
    }
  }

  const rank = (entries: Map<string, ImpactedSymbol>): ImpactedSymbol[] =>
    [...entries.values()]
      .sort((a, b) => b.calls - a.calls || a.id.localeCompare(b.id))
      .slice(0, max);

  return { files, impact: { callers: rank(callers), callees: rank(callees) }, notInGraph };
}
