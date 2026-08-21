#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'fs';
import { resolve } from 'path';

interface GraphNode {
  id: string;
  label?: string;
  norm_label?: string;
  source_file?: string;
  source_location?: string;
  file_type?: string;
  community?: number;
  [key: string]: unknown;
}

interface GraphEdge {
  source: string;
  target: string;
  key?: string;
  type?: string;
  label?: string;
  [key: string]: unknown;
}

interface Graph {
  nodes: GraphNode[];
  links?: GraphEdge[];
  edges?: GraphEdge[];
}

const ROOT = resolve(process.cwd());
const GRAPH_PATH = resolve(ROOT, 'graphify-out', 'graph.json');

function usage(): never {
  console.log(`Usage:
  graphify query "<text>" [--max N] [--json]
  graphify explain "<node_id>" [--json]
  graphify affected "<node_id-or-file>" [--max N] [--json]
  graphify path "<from_node>" "<to_node>" [--json]
  graphify update .
  graphify status [--json]`);
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'status';
  let max = 20;
  let json = false;
  const positional: string[] = [];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--max' || arg === '--max-results') {
      max = Number.parseInt(args[++i] ?? '', 10) || max;
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, max, json };
}

function loadGraph(): Graph {
  if (!existsSync(GRAPH_PATH)) {
    throw new Error(`graphify graph not found: ${GRAPH_PATH}`);
  }
  return JSON.parse(readFileSync(GRAPH_PATH, 'utf-8')) as Graph;
}

function edgesOf(graph: Graph): GraphEdge[] {
  return graph.links ?? graph.edges ?? [];
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_.:/\\-]+/g, ' ')
    .trim();
}

function scoreNode(node: GraphNode, terms: string[]): number {
  const haystack = normalize(
    [
      node.id,
      node.label,
      node.norm_label,
      node.source_file,
      node.source_location,
      node.file_type,
      node.community?.toString(),
    ]
      .filter(Boolean)
      .join(' '),
  );

  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += term.length;
  }
  if (node.label && terms.some((term) => normalize(node.label ?? '') === term)) score += 20;
  if (terms.some((term) => normalize(node.id) === term)) score += 30;
  return score;
}

function print(data: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      if ('id' in item) {
        const node = item as GraphNode & { score?: number };
        console.log(
          `${node.id}  ${node.label ?? ''}  ${node.source_file ?? ''}${node.source_location ? `:${node.source_location}` : ''}`,
        );
      } else {
        console.log(JSON.stringify(item));
      }
    }
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}

function status(json: boolean): void {
  const stat = existsSync(GRAPH_PATH) ? statSync(GRAPH_PATH) : null;
  const graph = stat ? loadGraph() : { nodes: [] };
  const result = {
    graph: GRAPH_PATH,
    exists: Boolean(stat),
    sizeBytes: stat?.size ?? 0,
    updatedAt: stat?.mtime.toISOString() ?? null,
    nodes: graph.nodes?.length ?? 0,
    edges: edgesOf(graph).length,
  };
  print(result, json);
}

function query(text: string, max: number, json: boolean): void {
  if (!text) usage();
  const graph = loadGraph();
  const terms = normalize(text)
    .split(/\s+/)
    .filter((term) => term.length > 1);
  const matches = graph.nodes
    .map((node) => ({ ...node, score: scoreNode(node, terms) }))
    .filter((node) => node.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
  print(matches, json);
}

function explain(id: string, json: boolean): void {
  if (!id) usage();
  const graph = loadGraph();
  const node = graph.nodes.find((candidate) => candidate.id === id);
  if (!node) {
    throw new Error(`node not found: ${id}`);
  }
  const related = edgesOf(graph)
    .filter((edge) => edge.source === id || edge.target === id)
    .slice(0, 50);
  print({ node, relatedEdges: related }, json);
}

function affected(idOrFile: string, max: number, json: boolean): void {
  if (!idOrFile) usage();
  const graph = loadGraph();
  const nodes = graph.nodes.filter(
    (node) =>
      node.id === idOrFile || node.source_file === idOrFile || node.source_file?.includes(idOrFile),
  );
  const ids = new Set(nodes.map((node) => node.id));
  const relatedIds = new Set<string>();
  for (const edge of edgesOf(graph)) {
    if (ids.has(edge.source)) relatedIds.add(edge.target);
    if (ids.has(edge.target)) relatedIds.add(edge.source);
  }
  const relatedNodes = graph.nodes.filter((node) => relatedIds.has(node.id)).slice(0, max);
  print({ input: idOrFile, matchedNodes: nodes.slice(0, max), affected: relatedNodes }, json);
}

function pathBetween(from: string, to: string, json: boolean): void {
  if (!from || !to) usage();
  const graph = loadGraph();
  const edges = edgesOf(graph);
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    adjacency.get(edge.source)?.push(edge.target);
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, []);
    adjacency.get(edge.target)?.push(edge.source);
  }

  const queue: string[][] = [[from]];
  const seen = new Set<string>([from]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const last = current[current.length - 1];
    if (last === to) {
      print({ found: true, path: current }, json);
      return;
    }
    if (current.length > 12) continue;
    for (const next of adjacency.get(last) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push([...current, next]);
      }
    }
  }
  print({ found: false, path: [] }, json);
}

function update(target: string, json: boolean): void {
  if (target !== '.' && target !== ROOT) usage();
  status(json);
  if (!json) {
    console.log(
      'Graphify update uses the existing graphify-out/graph.json snapshot in this environment.',
    );
    console.log('CodeGraph freshness is handled separately by src/codegraph-sync-autostart.ts.');
  }
}

function main(): void {
  const { command, positional, max, json } = parseArgs();
  try {
    switch (command) {
      case 'status':
        status(json);
        break;
      case 'query':
        query(positional.join(' '), max, json);
        break;
      case 'explain':
        explain(positional[0] ?? '', json);
        break;
      case 'affected':
        affected(positional[0] ?? '', max, json);
        break;
      case 'path':
        pathBetween(positional[0] ?? '', positional[1] ?? '', json);
        break;
      case 'update':
        update(positional[0] ?? '', json);
        break;
      default:
        usage();
    }
  } catch (error) {
    console.error(`[graphify] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
