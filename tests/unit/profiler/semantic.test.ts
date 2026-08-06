#!/usr/bin/env node
/**
 * Unit Tests: Semantic Code Graph
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const SEMANTIC_PATH = join(process.cwd(), 'src', 'profiler', 'semantic-code-graph.ts');

describe('Semantic Code Graph', () => {
  it('should have source file', () => {
    assert.ok(existsSync(SEMANTIC_PATH), 'Semantic graph source should exist');
  });

  it('should have generated graph', () => {
    const graphPath = join(process.cwd(), '.runtime', 'semantic-graph', 'semantic-graph.json');
    assert.ok(existsSync(graphPath), 'Semantic graph should be generated');
    
    const graph = JSON.parse(readFileSync(graphPath, 'utf-8'));
    assert.ok(graph.stats, 'Graph should have stats');
    assert.ok(graph.stats.totalNodes > 0, 'Should have nodes');
  });
});
