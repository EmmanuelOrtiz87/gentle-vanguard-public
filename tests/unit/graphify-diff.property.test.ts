#!/usr/bin/env node
/**
 * Property-based Tests: graphify-diff (oráculo independiente §7 — fast-check).
 * Las propiedades vienen del REQUISITO, no de la implementación: el impacto
 * jamás incluye símbolos cambiados, los límites se respetan y el reporte es
 * determinista ante cualquier grafo y cualquier lista de archivos.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { computeDiffImpact, type Graph, type GraphNode } from '../../src/cli/graphify-diff.js';

const KINDS = ['file', 'function', 'class', 'method', 'import'] as const;
const EDGE_TYPES = ['calls', 'contains', 'references'] as const;

const nodeArb: fc.Arbitrary<GraphNode> = fc.record({
  id: fc.string({ minLength: 2, maxLength: 14 }).map((s) => `n_${s.replace(/\s/g, '_')}`),
  label: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
  kind: fc.constantFrom(...KINDS),
  source_file: fc.constantFrom('src/a.ts', 'src/b.ts', 'lib/c.ts'),
});

const fileArb = fc.oneof(
  fc.constantFrom('src/a.ts', 'src/b.ts', 'lib/c.ts'),
  fc.string({ minLength: 1, maxLength: 10 }).map((s) => `${s.replace(/[^\w-]/g, '') || 'x'}.ts`),
);

const graphArb: fc.Arbitrary<Graph> = fc
  .array(nodeArb, { minLength: 1, maxLength: 12 })
  .chain((nodes) =>
    fc.record({
      nodes: fc.constant(nodes),
      links: fc.array(
        fc.record({
          source: fc.constantFrom(...nodes.map((n) => n.id)),
          target: fc.constantFrom(...nodes.map((n) => n.id)),
          type: fc.constantFrom(...EDGE_TYPES),
        }),
        { maxLength: 24 },
      ),
    }),
  );

test('propiedad: ningún caller ni callee es un símbolo cambiado', () => {
  fc.assert(
    fc.property(graphArb, fc.array(fileArb, { maxLength: 8 }), (graph, files) => {
      const report = computeDiffImpact(graph, files, 50);
      const changed = new Set(report.files.flatMap((f) => f.matchedSymbols.map((s) => s.id)));
      for (const caller of report.impact.callers) assert.ok(!changed.has(caller.id));
      for (const callee of report.impact.callees) assert.ok(!changed.has(callee.id));
    }),
    { numRuns: 300 },
  );
});

test('propiedad: archivos particionados exactamente entre files y notInGraph', () => {
  fc.assert(
    fc.property(graphArb, fc.array(fileArb, { maxLength: 8 }), (graph, files) => {
      const report = computeDiffImpact(graph, files, 50);
      const known = new Set(graph.nodes.map((n) => n.source_file));
      for (const file of files) {
        const inFiles = report.files.some((f) => f.file === file);
        const inNotInGraph = report.notInGraph.includes(file);
        const shouldMatch = known.has(file);
        assert.equal(inFiles, shouldMatch, `file ${file} mal particionado`);
        assert.equal(inNotInGraph, files.includes(file) && !shouldMatch);
      }
    }),
    { numRuns: 300 },
  );
});

test('propiedad: los límites max se respetan en callers, callees y matchedSymbols', () => {
  fc.assert(
    fc.property(graphArb, fc.array(fileArb, { maxLength: 8 }), fc.nat(30), (graph, files, max) => {
      const report = computeDiffImpact(graph, files, Math.max(1, max));
      assert.ok(report.impact.callers.length <= Math.max(1, max));
      assert.ok(report.impact.callees.length <= Math.max(1, max));
      for (const file of report.files) assert.ok(file.matchedSymbols.length <= Math.max(1, max));
    }),
    { numRuns: 200 },
  );
});

test('propiedad: cada caller/callee acumula al menos una llamada y el ranking es descendente', () => {
  fc.assert(
    fc.property(graphArb, fc.array(fileArb, { maxLength: 8 }), (graph, files) => {
      const report = computeDiffImpact(graph, files, 50);
      const calls = report.impact.callers.map((c) => c.calls);
      const callees = report.impact.callees.map((c) => c.calls);
      for (const count of [...calls, ...callees]) assert.ok(count >= 1);
      assert.deepEqual(
        [...calls].sort((a, b) => b - a),
        calls,
      );
      assert.deepEqual(
        [...callees].sort((a, b) => b - a),
        callees,
      );
    }),
    { numRuns: 300 },
  );
});

test('propiedad: pureza — mismo input produce el mismo reporte', () => {
  fc.assert(
    fc.property(graphArb, fc.array(fileArb, { maxLength: 8 }), (graph, files) => {
      const a = computeDiffImpact(graph, files, 20);
      const b = computeDiffImpact(graph, files, 20);
      assert.equal(JSON.stringify(a), JSON.stringify(b));
    }),
    { numRuns: 200 },
  );
});
