/**
 * graphify-build.ts — native knowledge-graph builder for the stack.
 *
 * Replaces the external/historical process that produced graphify-out/graph.json
 * (never committed, no builder existed — see STACK-EVOLUTION-PLAN F0.6). Pure
 * TypeScript via the compiler API: no LLM, no network, deterministic.
 *
 * Graph model (consumed by src/cli/graphify.ts query/explain/path/affected):
 *   - file node per source file, symbol nodes for functions/classes/methods
 *   - `contains` edges: file → symbol, class → method
 *   - `calls` edges: symbol → symbol, resolved through the file's import map
 *     (identifier-level resolution only — no full type checker, keeps build <10s)
 *   - `community` on every node via label propagation over the undirected graph
 *
 * Usage:
 *   npx tsx src/cli/graphify.ts build            # rebuild graph.json + report
 *   npx tsx src/cli/graphify.ts update .          # same as build (kept for AGENTS.md)
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, relative, resolve, extname, dirname } from 'path';
import ts from 'typescript';

export interface BuildOptions {
  root?: string;
  /** Comma-separated dirs (relative to root) scanned for TypeScript sources */
  roots?: string[];
  /** Skip files larger than this (KB) — generated/vendored giants */
  maxFileKb?: number;
  quiet?: boolean;
}

interface GraphNode {
  id: string;
  label: string;
  norm_label: string;
  source_file: string;
  source_location: string;
  file_type: string;
  kind: 'file' | 'function' | 'class' | 'method';
  community: number;
}

interface GraphEdge {
  source: string;
  target: string;
  key: string;
  type: 'contains' | 'calls';
}

interface SymbolInfo {
  id: string;
  name: string;
  kind: 'function' | 'class' | 'method';
  line: number;
}

const DEFAULT_ROOTS = ['src', 'apps/web-dashboard/server', 'packages/shared/src', 'adapters'];

function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_.:/\\-]+/g, ' ')
    .trim();
}

function nodeIdForFile(relPath: string): string {
  return relPath
    .replace(/[\\/.]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_/, '');
}

function listTsFiles(absDir: string, root: string, maxFileKb: number, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) {
      listTsFiles(abs, root, maxFileKb, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(d|test)\.ts$/.test(entry.name)) {
      try {
        const kb = statSync(abs).size / 1024;
        if (kb > maxFileKb) continue;
      } catch {
        continue;
      }
      out.push(relative(root, abs).replace(/\\/g, '/'));
    }
  }
}

/** Parse the import map of a source file: local name → {file, exportedName} */
function collectImports(
  source: ts.SourceFile,
  relFile: string,
  root: string,
): Map<string, { file: string; name: string }> {
  const imports = new Map<string, { file: string; name: string }>();
  for (const stmt of source.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const spec = stmt.moduleSpecifier.text;
    if (!spec.startsWith('.') && !spec.startsWith('@/')) continue;
    // Resolve specifier against the scan root (never process.cwd — the graph
    // may be built for a different root, e.g. in tests). ESM-style .js
    // specifiers map back to their .ts source.
    const stripped = spec.replace(/^@\//, 'src/').replace(/\.js$/, '');
    const base = resolve(root, dirname(relFile), stripped);
    const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')];
    const resolvedRel = (
      candidates.find((c) => {
        try {
          return statSync(c).isFile();
        } catch {
          return false;
        }
      }) ?? ''
    ).replace(/\\/g, '/');
    if (!resolvedRel) continue;
    const target = relative(root, resolvedRel).replace(/\\/g, '/');

    const clause = stmt.importClause;
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        const importedName = (el.propertyName ?? el.name).text;
        imports.set(el.name.text, { file: target, name: importedName });
      }
    } else if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      imports.set(clause.namedBindings.name.text, { file: target, name: '*' });
    } else if (clause?.name) {
      imports.set(clause.name.text, { file: target, name: 'default' });
    }
  }
  return imports;
}

function collectSymbols(source: ts.SourceFile): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  const lineOf = (node: ts.Node): number =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  const visitClass = (cls: ts.ClassDeclaration | ts.ClassExpression, prefix: string): void => {
    const name = cls.name?.text ?? prefix;
    symbols.push({ id: '', name, kind: 'class', line: lineOf(cls) });
    for (const member of cls.members) {
      if (ts.isMethodDeclaration(member) && member.name) {
        const method = member.name.getText(source);
        symbols.push({ id: '', name: `${name}.${method}`, kind: 'method', line: lineOf(member) });
      }
    }
  };

  for (const stmt of source.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      symbols.push({ id: '', name: stmt.name.text, kind: 'function', line: lineOf(stmt) });
    } else if (ts.isClassDeclaration(stmt)) {
      visitClass(stmt, 'anonymous');
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (decl.name && ts.isIdentifier(decl.name)) {
          const init = decl.initializer;
          if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
            symbols.push({ id: '', name: decl.name.text, kind: 'function', line: lineOf(decl) });
          }
        }
      }
    }
  }
  return symbols;
}

/** Collect identifiers invoked inside a function-ish node's body */
function collectCalleeNames(fn: ts.FunctionLikeDeclaration | ts.ArrowFunction): string[] {
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (ts.isIdentifier(expr)) {
        names.push(expr.text);
      } else if (ts.isPropertyAccessExpression(expr)) {
        names.push(expr.name.text);
      }
    }
    node.forEachChild(visit);
  };
  fn.body?.forEachChild(visit);
  return names;
}

/** Function-ish declarations with bodies, aligned with collectSymbols naming */
function functionBodies(
  source: ts.SourceFile,
): Array<{ name: string; fn: ts.FunctionLikeDeclaration | ts.ArrowFunction }> {
  const out: Array<{ name: string; fn: ts.FunctionLikeDeclaration | ts.ArrowFunction }> = [];
  for (const stmt of source.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
      out.push({ name: stmt.name.text, fn: stmt });
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      for (const member of stmt.members) {
        if (ts.isMethodDeclaration(member) && member.name && member.body) {
          out.push({ name: `${stmt.name.text}.${member.name.getText(source)}`, fn: member });
        }
      }
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        const init = decl.initializer;
        if (
          decl.name &&
          ts.isIdentifier(decl.name) &&
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) &&
          init.body
        ) {
          out.push({ name: decl.name.text, fn: init });
        }
      }
    }
  }
  return out;
}

/** Label propagation over the undirected projection of the edge list */
function detectCommunities(nodes: GraphNode[], edges: GraphEdge[], iterations = 8): void {
  const index = new Map<string, number>();
  nodes.forEach((n, i) => index.set(n.id, i));
  const adjacency: number[][] = nodes.map(() => []);
  for (const e of edges) {
    const a = index.get(e.source);
    const b = index.get(e.target);
    if (a === undefined || b === undefined) continue;
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  let labels = nodes.map((_, i) => i);
  const weight = (i: number, label: number): number =>
    adjacency[i].filter((j) => labels[j] === label).length;
  for (let it = 0; it < iterations; it++) {
    let changed = false;
    for (let i = 0; i < nodes.length; i++) {
      if (adjacency[i].length === 0) continue;
      const counts = new Map<number, number>();
      for (const j of adjacency[i]) counts.set(labels[j], (counts.get(labels[j]) ?? 0) + 1);
      let best = labels[i];
      let bestCount = -1;
      for (const [label, count] of counts) {
        if (count > bestCount || (count === bestCount && label < best)) {
          best = label;
          bestCount = count;
        }
      }
      if (best !== labels[i]) {
        labels[i] = best;
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Compact labels to 0..k-1 by first appearance
  const remap = new Map<number, number>();
  labels = labels.map((l) => {
    if (!remap.has(l)) remap.set(l, remap.size);
    return remap.get(l)!;
  });
  nodes.forEach((n, i) => {
    n.community = labels[i];
  });
  void weight;
}

export interface BuildResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  files: number;
  communities: number;
  durationMs: number;
}

export function buildGraph(options: BuildOptions = {}): BuildResult {
  const started = Date.now();
  const root = resolve(options.root ?? process.cwd());
  const roots = options.roots ?? DEFAULT_ROOTS;
  const maxFileKb = options.maxFileKb ?? 400;

  const files: string[] = [];
  for (const r of roots) {
    listTsFiles(join(root, r), root, maxFileKb, files);
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const symbolsByFile = new Map<string, Map<string, SymbolInfo>>();
  const fileNodeIds = new Map<string, string>();
  interface ParsedFile {
    rel: string;
    localByName: Map<string, SymbolInfo>;
    imports: Map<string, { file: string; name: string }>;
    bodies: Array<{ name: string; fn: ts.FunctionLikeDeclaration | ts.ArrowFunction }>;
  }
  const parsedFiles: ParsedFile[] = [];

  // Pass 1: nodes + contains edges + symbol tables (ALL files before any call
  // resolution — a file may import a file that sorts after it alphabetically)
  for (const rel of files) {
    const fileNodeId = nodeIdForFile(rel);
    fileNodeIds.set(rel, fileNodeId);
    nodes.push({
      id: fileNodeId,
      label: rel.split('/').pop() ?? rel,
      norm_label: normalizeLabel(rel),
      source_file: rel,
      source_location: '1',
      file_type: extname(rel),
      kind: 'file',
      community: -1,
    });

    let source: ts.SourceFile;
    try {
      source = ts.createSourceFile(
        join(root, rel),
        readFileSync(join(root, rel), 'utf8'),
        ts.ScriptTarget.ES2022,
        true,
      );
    } catch {
      continue;
    }

    const symbols = collectSymbols(source);
    const localByName = new Map<string, SymbolInfo>();
    const prefix = `${fileNodeId}_`;
    for (const sym of symbols) {
      sym.id = `${prefix}${sym.name.replace(/[^a-zA-Z0-9_]+/g, '_')}`;
      localByName.set(sym.name, sym);
      nodes.push({
        id: sym.id,
        label: sym.name,
        norm_label: normalizeLabel(sym.name),
        source_file: rel,
        source_location: String(sym.line),
        file_type: extname(rel),
        kind: sym.kind,
        community: -1,
      });
      edges.push({
        source: fileNodeId,
        target: sym.id,
        key: `contains:${sym.id}`,
        type: 'contains',
      });
    }
    symbolsByFile.set(rel, localByName);
    parsedFiles.push({
      rel,
      localByName,
      imports: collectImports(source, rel, root),
      bodies: functionBodies(source),
    });
  }

  // Pass 2: call resolution with the complete symbol tables
  for (const { localByName, imports, bodies } of parsedFiles) {
    for (const { name, fn } of bodies) {
      const caller = localByName.get(name);
      if (!caller) continue;
      for (const callee of collectCalleeNames(fn)) {
        const local = localByName.get(callee);
        if (local && local.id !== caller.id) {
          edges.push({
            source: caller.id,
            target: local.id,
            key: `calls:${caller.id}->${local.id}`,
            type: 'calls',
          });
          continue;
        }
        const imported = imports.get(callee);
        if (imported) {
          const targetSymbols = symbolsByFile.get(imported.file);
          const target = targetSymbols?.get(imported.name);
          if (target) {
            edges.push({
              source: caller.id,
              target: target.id,
              key: `calls:${caller.id}->${target.id}`,
              type: 'calls',
            });
          }
        }
      }
    }
  }

  detectCommunities(nodes, edges);

  return {
    nodes,
    edges,
    files: files.length,
    communities: new Set(nodes.map((n) => n.community)).size,
    durationMs: Date.now() - started,
  };
}

export function writeGraph(result: BuildResult, outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  // Dedupe edges by key (parallel call sites collapse to one edge)
  const seen = new Set<string>();
  const edges = result.edges.filter((e) => {
    if (seen.has(e.key)) return false;
    seen.add(e.key);
    return true;
  });
  writeFileSync(
    join(outDir, 'graph.json'),
    JSON.stringify({ nodes: result.nodes, links: edges }, null, 1),
  );

  const byDegree = new Map<string, number>();
  for (const e of edges) {
    byDegree.set(e.source, (byDegree.get(e.source) ?? 0) + 1);
    byDegree.set(e.target, (byDegree.get(e.target) ?? 0) + 1);
  }
  const hubs = [...byDegree.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([id, deg]) => `- ${id} — degree ${deg}`)
    .join('\n');
  const kinds = result.nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.kind] = (acc[n.kind] ?? 0) + 1;
    return acc;
  }, {});
  writeFileSync(
    join(outDir, 'GRAPH_REPORT.md'),
    `# Graphify — native build report

Generated: ${new Date().toISOString()} · builder: src/cli/graphify-build.ts (AST, no LLM)

- Files scanned: ${result.files}
- Nodes: ${result.nodes.length} (${Object.entries(kinds)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ')})
- Edges: ${edges.length} (${edges.filter((e) => e.type === 'contains').length} contains, ${edges.filter((e) => e.type === 'calls').length} calls)
- Communities (label propagation): ${result.communities}
- Build time: ${result.durationMs} ms

## Top hubs (by degree)

${hubs}

## Node kinds and edge semantics

- \`file\` node per TypeScript source; \`contains\` edge file → symbol.
- \`function\` / \`class\` / \`method\` nodes per declaration; class → method contains edges.
- \`calls\` edges are identifier-level: resolved through each file's import map.
  No \`references\`/\`imports\` edges (that requires type-checker or LLM extraction).
`,
  );
}

export function runBuild(options: BuildOptions = {}): BuildResult {
  const result = buildGraph(options);
  const outDir = join(options.root ? resolve(options.root) : process.cwd(), 'graphify-out');
  writeGraph(result, outDir);
  if (!options.quiet) {
    console.log(
      `[graphify] built: ${result.files} files, ${result.nodes.length} nodes, ` +
        `${result.edges.length} edges, ${result.communities} communities in ${result.durationMs}ms → ${outDir}`,
    );
  }
  return result;
}
