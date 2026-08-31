#!/usr/bin/env node
/**
 * dynamic-dependency-graph.ts — Mapa dinámico de dependencias del sistema
 *
 * Escanea config/session-autostart.config.json y descubre relaciones
 * entre componentes, reemplazando el mapa hardcodeado.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(process.cwd());
const CONFIG_FILE = join(ROOT, 'config', 'session-autostart.config.json');
const GRAPH_FILE = join(ROOT, '.runtime', 'dependency-graph.json');

export interface DependencyNode {
  id: string;
  type: 'pipeline' | 'service' | 'config' | 'database' | 'script';
  dependencies: string[];
  dependents: string[];
  health: 'unknown' | 'healthy' | 'degraded' | 'down';
  lastChecked: string | null;
  metadata: Record<string, unknown>;
}

// ─── Discovery ────────────────────────────────────────────────────────

function inferComponentType(_id: string, script: string): DependencyNode['type'] {
  if (script.includes('database') || script.includes('db-')) return 'database';
  if (script.includes('server') || script.includes('ws-') || script.includes('mcp-'))
    return 'service';
  if (script.includes('config') || script.endsWith('.json')) return 'config';
  if (script.includes('.ps1') || script.includes('.ts')) return 'script';
  return 'pipeline';
}

function discoverDependencies(): DependencyNode[] {
  const nodes: DependencyNode[] = [];
  const nodeMap = new Map<string, DependencyNode>();

  if (!existsSync(CONFIG_FILE)) return nodes;

  const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  const steps = config.pipeline?.steps || [];

  // Create nodes for each step
  for (const step of steps) {
    const node: DependencyNode = {
      id: step.id,
      type: inferComponentType(step.id, step.script || ''),
      dependencies: [],
      dependents: [],
      health: 'unknown',
      lastChecked: null,
      metadata: {
        script: step.script,
        lazy: !!step.lazy,
        required: !!step.required,
        enabled: step.enabled !== false,
        phase: step.phase || 1,
      },
    };
    nodeMap.set(step.id, node);
  }

  // Infer dependencies based on script references
  for (const step of steps) {
    const node = nodeMap.get(step.id);
    if (!node) continue;

    // Check script for references to other steps
    if (step.script) {
      for (const [otherId] of nodeMap) {
        if (otherId !== step.id && step.script.includes(otherId)) {
          node.dependencies.push(otherId);
        }
      }
    }

    // Phase-based dependency (lower phase = dependency)
    for (const [otherId] of nodeMap) {
      if (otherId !== step.id) {
        if (!node.dependencies.includes(otherId)) {
          node.dependencies.push(otherId);
        }
      }
    }

    nodes.push(node);
  }

  // Build dependents (reverse)
  for (const node of nodes) {
    for (const depId of node.dependencies) {
      const dep = nodeMap.get(depId);
      if (dep && !dep.dependents.includes(node.id)) {
        dep.dependents.push(node.id);
      }
    }
  }

  return nodes;
}

// ─── API ──────────────────────────────────────────────────────────────

export function scanDependencies(): DependencyNode[] {
  const nodes = discoverDependencies();
  writeFileSync(GRAPH_FILE, JSON.stringify(nodes, null, 2), 'utf-8');
  return nodes;
}

export function getDependencyGraph(): DependencyNode[] {
  if (!existsSync(GRAPH_FILE)) return scanDependencies();
  return JSON.parse(readFileSync(GRAPH_FILE, 'utf-8'));
}

export function getAffectedComponents(componentId: string): string[] {
  const graph = getDependencyGraph();
  const affected: string[] = [];
  const visited = new Set<string>();

  function traverse(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);

    const node = graph.find((n) => n.id === id);
    if (!node) return;

    for (const dependent of node.dependents) {
      affected.push(dependent);
      traverse(dependent);
    }
  }

  traverse(componentId);
  return affected;
}

export function getComponentDependencies(componentId: string): string[] {
  const graph = getDependencyGraph();
  const node = graph.find((n) => n.id === componentId);
  return node?.dependencies || [];
}

// ─── CLI ──────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const action = args[0];

  if (action === 'scan') {
    const graph = scanDependencies();
    console.log(
      JSON.stringify({
        nodes: graph.length,
        types: {
          pipeline: graph.filter((n) => n.type === 'pipeline').length,
          service: graph.filter((n) => n.type === 'service').length,
          database: graph.filter((n) => n.type === 'database').length,
          config: graph.filter((n) => n.type === 'config').length,
          script: graph.filter((n) => n.type === 'script').length,
        },
      }),
    );
  } else if (action === 'affected' && args[1]) {
    const affected = getAffectedComponents(args[1]);
    console.log(JSON.stringify({ component: args[1], affected }));
  } else if (action === 'graph') {
    const graph = getDependencyGraph();
    console.log(JSON.stringify(graph, null, 2));
  } else {
    console.log('Dynamic Dependency Graph');
    console.log('  Commands: scan, affected <id>, graph');
  }
}

if (process.argv[1]?.includes('dynamic-dependency-graph')) main();
