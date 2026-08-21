#!/usr/bin/env node
/**
 * Semantic Code Graph - Native Stack Implementation
 * Extracts semantic relationships using skill system and existing tools
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve, basename } from 'path';
import { glob } from 'glob';

interface SemanticEdge {
  source: string;
  target: string;
  type: 'IMPLEMENTS' | 'DEPENDS_ON' | 'EXTENDS' | 'USES' | 'REPLACES' | 'TESTS';
  confidence: number; // 0-1
  extractedFrom: 'filename' | 'comment' | 'imports' | 'patterns';
}

interface SemanticNode {
  id: string;
  path: string;
  type: 'function' | 'class' | 'interface' | 'module';
  description: string;
  patterns: string[];
}

interface SemanticGraph {
  version: string;
  generatedAt: string;
  nodes: SemanticNode[];
  edges: SemanticEdge[];
  stats: {
    totalNodes: number;
    totalEdges: number;
    semanticCoverage: number; // % of AST nodes with semantic edges
  };
}

const GRAPH_DIR = join(resolve(process.cwd()), '.runtime', 'semantic-graph');
const OUTPUT_FILE = join(GRAPH_DIR, 'semantic-graph.json');

// Pattern detection (100% native, no LLM required)
const SEMANTIC_PATTERNS: Record<string, { type: string; weight: number }[]> = {
  // File patterns
  session: [
    { type: 'IMPLEMENTS', weight: 0.8 },
    { type: 'PATTERN:SessionManagement', weight: 0.9 },
  ],
  health: [{ type: 'PATTERN:Monitoring', weight: 0.9 }],
  checkpoint: [{ type: 'PATTERN:StatePersistence', weight: 0.9 }],
  audit: [{ type: 'PATTERN:Observability', weight: 0.9 }],
  skill: [{ type: 'PATTERN:SkillSystem', weight: 0.9 }],
  test: [{ type: 'TESTS', weight: 0.95 }],
  router: [{ type: 'PATTERN:Routing', weight: 0.85 }],
  manager: [{ type: 'PATTERN:Management', weight: 0.75 }],
  pipeline: [{ type: 'PATTERN:Orchestration', weight: 0.9 }],
  config: [{ type: 'PATTERN:Configuration', weight: 0.85 }],
  monitor: [{ type: 'PATTERN:Observability', weight: 0.9 }],
  agent: [{ type: 'PATTERN:AgentSystem', weight: 0.95 }],
  embedder: [{ type: 'PATTERN:NLP', weight: 0.85 }],
  profiler: [{ type: 'PATTERN:Performance', weight: 0.9 }],
};

// Import pattern matching
const IMPORT_PATTERNS: Record<string, string[]> = {
  'audit-pipeline': ['Observability', 'state-persistence'],
  'checkpoint-manager': ['state-persistence', 'backup'],
  'session-autostart': ['orchestration', 'session-management'],
  'skill-router': ['routing', 'nlp', 'dispatch'],
  'health-check': ['monitoring', 'observability'],
  engram: ['memory', 'persistence', 'rag'],
};

// Extract semantic info from source file
function extractSemanticFromSource(filePath: string): Partial<SemanticNode> {
  const content = readFileSync(filePath, 'utf-8');
  const fileName = basename(filePath, '.ts');

  const patterns: string[] = [];
  const type = detectType(filePath, content);

  // Extract patterns from comments
  const jsdocPattern = /\/\*\*[\s\S]*?\*\//g;
  const comments = content.match(jsdocPattern) || [];

  for (const comment of comments) {
    if (comment.includes('manager')) patterns.push('PATTERN:Management');
    if (comment.includes('router')) patterns.push('PATTERN:Routing');
    if (comment.includes('orchestrat')) patterns.push('PATTERN:Orchestration');
    if (comment.includes('monitor')) patterns.push('PATTERN:Observability');
    if (comment.includes('session')) patterns.push('PATTERN:SessionManagement');
    if (comment.includes('pattern') || comment.includes('Pattern')) {
      patterns.push('PATTERN:DesignPattern');
    }
  }

  // Extract from filename
  for (const [keyword, semantics] of Object.entries(SEMANTIC_PATTERNS)) {
    if (fileName.toLowerCase().includes(keyword)) {
      for (const semantic of semantics) {
        if (!patterns.includes(semantic.type)) {
          patterns.push(semantic.type);
        }
      }
    }
  }

  // Generate description from patterns
  const descriptions: string[] = [];
  if (patterns.includes('PATTERN:SessionManagement')) descriptions.push('session management');
  if (patterns.includes('PATTERN:Observability')) descriptions.push('observability');
  if (patterns.includes('PATTERN:Routing')) descriptions.push('routing');
  if (patterns.includes('PATTERN:StatePersistence')) descriptions.push('state persistence');
  if (patterns.includes('PATTERN:NLP')) descriptions.push('semantic analysis');
  if (patterns.includes('PATTERN:Performance')) descriptions.push('performance monitoring');
  if (patterns.includes('PATTERN:Orchestration')) descriptions.push('orchestration');

  const description =
    descriptions.length > 0
      ? `Implements ${descriptions.join(', ')}`
      : `TypeScript ${type} in Gentle-Vanguard stack`;

  return {
    type,
    patterns,
    description,
  };
}

// Detect if function, class, or module
function detectType(
  filePath: string,
  content: string,
): 'function' | 'class' | 'interface' | 'module' {
  if (content.includes('export class') || content.includes('class ')) return 'class';
  if (content.includes('export interface') || content.includes('interface ')) return 'interface';
  if (content.includes('export function') || content.includes('async function')) return 'function';
  return 'module';
}

// Find semantic edges between nodes
function findSemanticEdges(nodes: SemanticNode[]): SemanticEdge[] {
  const edges: SemanticEdge[] = [];

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const source = nodes[i];
      const target = nodes[j];

      // Check for TESTS relationship
      if (
        target.path.includes('test') &&
        target.path.replace('.test.ts', '.ts').includes(source.path.replace('.ts', ''))
      ) {
        edges.push({
          source: source.id,
          target: target.id,
          type: 'TESTS',
          confidence: 0.95,
          extractedFrom: 'filename',
        });
      }

      // Check for import relationships
      try {
        const targetContent = readFileSync(target.path, 'utf-8');
        const sourceName = basename(source.path, '.ts');

        if (
          targetContent.includes(`from '${sourceName}'`) ||
          targetContent.includes(`import './${sourceName}'`)
        ) {
          edges.push({
            source: source.id,
            target: target.id,
            type: 'DEPENDS_ON',
            confidence: 0.9,
            extractedFrom: 'imports',
          });
        }
      } catch {
        // Skip unreadable files
      }

      // Check for pattern-based relationships
      const sourcePatterns = source.patterns.map((p) => p.replace('PATTERN:', ''));
      const targetPatterns = target.patterns.map((p) => p.replace('PATTERN:', ''));

      // Shared pattern = DEPENDS_ON
      const shared = sourcePatterns.filter((p) => targetPatterns.includes(p));
      if (shared.length > 0) {
        edges.push({
          source: source.id,
          target: target.id,
          type: 'USES',
          confidence: 0.7,
          extractedFrom: 'patterns',
        });
      }
    }
  }

  return edges;
}

// Build semantic graph
export async function buildSemanticGraph(): Promise<SemanticGraph> {
  mkdirSync(GRAPH_DIR, { recursive: true });

  console.log('Building Semantic Code Graph...\n');
  console.log('Phase 1: Collecting source files...');

  // Collect all TypeScript files
  const files = [
    ...(await glob('src/**/*.ts', { cwd: process.cwd() })),
    ...(await glob('tests/**/*.ts', { cwd: process.cwd() })),
  ];

  console.log(`  Found ${files.length} files`);
  console.log('\nPhase 2: Extracting semantic patterns...');

  const nodes: SemanticNode[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = join(process.cwd(), file);

    if (!existsSync(filePath)) continue;

    const semantic = extractSemanticFromSource(filePath);
    const node: SemanticNode = {
      id: `node-${nodes.length}`,
      path: filePath,
      type: semantic.type || 'module',
      description: semantic.description || 'Unknown',
      patterns: semantic.patterns || [],
    };
    nodes.push(node);

    if ((i + 1) % 50 === 0) {
      console.log(`  Processed ${i + 1}/${files.length} files...`);
    }
  }

  console.log(`\n  Created ${nodes.length} semantic nodes`);
  console.log('\nPhase 3: Finding relationships...');

  const edges = findSemanticEdges(nodes);

  console.log(`  Found ${edges.length} semantic relationships`);

  // Check additional relationships via import patterns
  console.log('\nPhase 4: Analyzing import patterns...');

  for (const [moduleName, patterns] of Object.entries(IMPORT_PATTERNS)) {
    const matchingNodes = nodes.filter((n) =>
      basename(n.path, '.ts').toLowerCase().includes(moduleName.toLowerCase()),
    );

    for (const node of matchingNodes) {
      // Find related nodes by shared patterns
      for (const pattern of patterns) {
        const related = nodes.filter(
          (n) =>
            n !== node && n.patterns.some((p) => p.toLowerCase().includes(pattern.toLowerCase())),
        );

        for (const rel of related) {
          if (!edges.some((e) => e.source === node.id && e.target === rel.id)) {
            edges.push({
              source: node.id,
              target: rel.id,
              type: 'USES',
              confidence: 0.6,
              extractedFrom: 'patterns',
            });
          }
        }
      }
    }
  }

  // Calculate coverage
  const astNodeCount = nodes.length; // Approximation
  const nodesWithEdges = new Set(edges.flatMap((e) => [e.source, e.target])).size;
  const semanticCoverage = Math.round((nodesWithEdges / astNodeCount) * 100);

  const graph: SemanticGraph = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
    stats: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      semanticCoverage,
    },
  };

  // Save
  writeFileSync(OUTPUT_FILE, JSON.stringify(graph, null, 2), 'utf-8');

  return graph;
}

// Query semantic graph
export function querySemanticGraph(query: string): {
  results: SemanticNode[];
  edges: SemanticEdge[];
} {
  if (!existsSync(OUTPUT_FILE)) {
    return { results: [], edges: [] };
  }

  const graph: SemanticGraph = JSON.parse(readFileSync(OUTPUT_FILE, 'utf-8'));
  const queryLower = query.toLowerCase();

  // Find matching nodes
  const nodes = graph.nodes.filter(
    (n) =>
      n.description.toLowerCase().includes(queryLower) ||
      n.patterns.some((p) => p.toLowerCase().includes(queryLower)) ||
      n.path.toLowerCase().includes(queryLower),
  );

  // Find edges connected to these nodes
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => nodeIds.has(e.source) || nodeIds.has(e.target));

  return { results: nodes, edges };
}

// CLI
if (process.argv[1]?.includes('semantic-code-graph.ts')) {
  const command = process.argv[2];

  void (async () => {
    switch (command) {
      case 'build': {
        const graph = await buildSemanticGraph();
        console.log('\n=== Semantic Code Graph Generated ===\n');
        console.log(`Total nodes: ${graph.stats.totalNodes}`);
        console.log(`Semantic edges: ${graph.stats.totalEdges}`);
        console.log(`Coverage: ${graph.stats.semanticCoverage}%`);
        console.log('\nOutput:', OUTPUT_FILE);
        break;
      }
      case 'query': {
        const query = process.argv.slice(3).join(' ');
        if (!query) {
          console.log('Usage: npx tsx src/profiler/semantic-code-graph.ts query <search>');
          console.log('  Example: query "session management"');
          process.exit(1);
        }

        const { results, edges } = querySemanticGraph(query);
        console.log(`\nQuery: "${query}"`);
        console.log(`\nResults (${results.length}):`);

        for (const node of results.slice(0, 10)) {
          console.log(`  • ${basename(node.path)}: ${node.description}`);
          console.log(`    Patterns: ${node.patterns.slice(0, 3).join(', ')}`);
        }

        if (edges.length > 0) {
          console.log(`\nRelated edges: ${edges.length}`);
        }
        break;
      }
      case 'status': {
        if (existsSync(OUTPUT_FILE)) {
          const graph = JSON.parse(readFileSync(OUTPUT_FILE, 'utf-8'));
          console.log('Semantic Graph Status:');
          console.log('  Generated:', graph.generatedAt);
          console.log('  Nodes:', graph.stats.totalNodes);
          console.log('  Edges:', graph.stats.totalEdges);
          console.log('  Coverage:', graph.stats.semanticCoverage + '%');
        } else {
          console.log('No semantic graph found. Run: npm run semantic:build');
        }
        break;
      }
      default: {
        console.log('Semantic Code Graph - Native Stack Implementation\n');
        console.log('Usage:');
        console.log('  npx tsx src/profiler/semantic-code-graph.ts [command] [args]\n');
        console.log('Commands:');
        console.log('  build              - Build semantic graph from source');
        console.log('  query <pattern>    - Search graph by pattern');
        console.log('  status             - Show graph statistics');
        process.exit(1);
      }
    }
  })();
}
