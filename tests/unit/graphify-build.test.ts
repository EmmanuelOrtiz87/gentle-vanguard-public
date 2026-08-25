import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGraph, writeGraph } from '../../src/cli/graphify-build.js';

let fixtureRoot = '';

before(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'gv-graphify-'));
  mkdirSync(join(fixtureRoot, 'src'), { recursive: true });
  writeFileSync(
    join(fixtureRoot, 'src', 'math.ts'),
    `export function add(a: number, b: number): number {
  return a + b;
}
export function double(x: number): number {
  return add(x, x);
}
`,
  );
  writeFileSync(
    join(fixtureRoot, 'src', 'app.ts'),
    `import { add } from './math.js';
export class Calculator {
  run(): number {
    return add(1, 2);
  }
}
`,
  );
});

after(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('graphify native builder', () => {
  it('builds file/symbol nodes with contains edges', () => {
    const result = buildGraph({ root: fixtureRoot, roots: ['src'], quiet: true });
    const ids = new Set(result.nodes.map((n) => n.id));
    assert.ok(ids.has('src_math_ts'), 'file node for math.ts');
    assert.ok(ids.has('src_math_ts_add'), 'function node add');
    assert.ok(ids.has('src_app_ts_Calculator'), 'class node Calculator');
    assert.ok(ids.has('src_app_ts_Calculator_run'), 'method node Calculator.run (dot sanitized)');
    assert.ok(
      result.edges.some(
        (e) =>
          e.type === 'contains' && e.source === 'src_math_ts' && e.target === 'src_math_ts_add',
      ),
      'file contains function',
    );
  });

  it('resolves cross-file calls through the import map', () => {
    const result = buildGraph({ root: fixtureRoot, roots: ['src'], quiet: true });
    const cross = result.edges.find(
      (e) =>
        e.type === 'calls' &&
        e.source === 'src_app_ts_Calculator_run' &&
        e.target === 'src_math_ts_add',
    );
    assert.ok(cross, 'expected a cross-file calls edge Calculator.run -> add');
    // Local calls are resolved too (double calls add inside math.ts)
    assert.ok(
      result.edges.some(
        (e) =>
          e.type === 'calls' && e.source === 'src_math_ts_double' && e.target === 'src_math_ts_add',
      ),
      'local calls edge double -> add',
    );
  });

  it('assigns a community to every node', () => {
    const result = buildGraph({ root: fixtureRoot, roots: ['src'], quiet: true });
    assert.ok(result.nodes.every((n) => n.community >= 0));
    assert.ok(result.communities >= 1);
  });

  it('writeGraph dedupes parallel edges and writes graph.json + report', () => {
    const result = buildGraph({ root: fixtureRoot, roots: ['src'], quiet: true });
    const outDir = join(fixtureRoot, 'graphify-out');
    writeGraph(result, outDir);
    const graph = JSON.parse(readFileSync(join(outDir, 'graph.json'), 'utf8')) as {
      nodes: unknown[];
      links: { key: string }[];
    };
    assert.ok(graph.nodes.length > 0);
    const keys = graph.links.map((l) => l.key);
    assert.equal(new Set(keys).size, keys.length, 'edge keys must be unique');
  });
});
