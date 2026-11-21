#!/usr/bin/env node
/**
 * Unit Tests: graphify-diff (núcleo puro de diff-impact pre-commit).
 * Sujeto del pilot de mutation testing (Stryker, `npm run test:mutation`) —
 * NORMATIVAS-TESTING.md §7 exige que los módulos de contrato maten mutantes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDiffImpact, type Graph } from '../../src/cli/graphify-diff.js';

const graph: Graph = {
  nodes: [
    {
      id: 'src_cli_graphify_ts',
      label: 'graphify.ts',
      kind: 'file',
      source_file: 'src/cli/graphify.ts',
    },
    {
      id: 'src_cli_graphify_ts_main',
      label: 'main',
      kind: 'function',
      source_file: 'src/cli/graphify.ts',
      source_location: '10',
    },
    {
      id: 'src_cli_graphify_ts_query',
      label: 'query',
      kind: 'function',
      source_file: 'src/cli/graphify.ts',
      source_location: '20',
    },
    {
      id: 'src_cli_graphify_ts_main_parseArgs',
      label: 'parseArgs',
      kind: 'function',
      source_file: 'src/cli/graphify.ts',
      source_location: '15',
    },
    {
      id: 'src_cli_graphify_build_ts',
      label: 'graphify-build.ts',
      kind: 'file',
      source_file: 'src/cli/graphify-build.ts',
    },
    {
      id: 'src_cli_graphify_build_ts_runBuild',
      label: 'runBuild',
      kind: 'function',
      source_file: 'src/cli/graphify-build.ts',
    },
    {
      id: 'src_core_run-command_ts_runSync',
      label: 'runSync',
      kind: 'function',
      source_file: 'src/core/run-command.ts',
    },
    {
      id: 'src_review_test-runner_ts_run',
      label: 'run',
      kind: 'function',
      source_file: 'src/review/test-runner.ts',
    },
  ],
  links: [
    { source: 'src_cli_graphify_ts_main', target: 'src_cli_graphify_ts_query', type: 'calls' },
    {
      source: 'src_cli_graphify_ts_main',
      target: 'src_cli_graphify_ts_main_parseArgs',
      type: 'calls',
    },
    {
      source: 'src_cli_graphify_ts_main',
      target: 'src_cli_graphify_build_ts_runBuild',
      type: 'calls',
    },
    {
      source: 'src_cli_graphify_ts_main',
      target: 'src_core_run-command_ts_runSync',
      type: 'calls',
    },
    {
      source: 'src_cli_graphify_ts_query',
      target: 'src_core_run-command_ts_runSync',
      type: 'calls',
    },
    { source: 'src_review_test-runner_ts_run', target: 'src_cli_graphify_ts_query', type: 'calls' },
    { source: 'src_cli_graphify_ts', target: 'src_cli_graphify_ts_main', type: 'contains' },
  ],
};

test('matched symbols y file-nodes por archivo cambiado', () => {
  const report = computeDiffImpact(graph, ['src/cli/graphify.ts']);
  assert.equal(report.files.length, 1);
  assert.equal(report.files[0].file, 'src/cli/graphify.ts');
  const symbolIds = report.files[0].matchedSymbols.map((s) => s.id).sort();
  assert.deepEqual(symbolIds, [
    'src_cli_graphify_ts_main',
    'src_cli_graphify_ts_main_parseArgs',
    'src_cli_graphify_ts_query',
  ]);
  assert.deepEqual(report.files[0].fileNodes, ['src_cli_graphify_ts']);
  assert.equal(report.notInGraph.length, 0);
});

test('callers: símbolos externos que llaman a código cambiado', () => {
  const report = computeDiffImpact(graph, ['src/cli/graphify.ts']);
  const callerIds = report.impact.callers.map((c) => c.id);
  assert.deepEqual(callerIds, ['src_review_test-runner_ts_run']);
  assert.equal(report.impact.callers[0].calls, 1);
  // los símbolos cambiados entre sí no se auto-cuentan como callers
  assert.ok(!callerIds.includes('src_cli_graphify_ts_main'));
});

test('callees: dedupe y ranking por número de llamadas', () => {
  const report = computeDiffImpact(graph, ['src/cli/graphify.ts']);
  const calleeIds = report.impact.callees.map((c) => c.id);
  // runSync lo llaman main y query (2 llamadas) → primero; runBuild 1 llamada
  assert.deepEqual(calleeIds, [
    'src_core_run-command_ts_runSync',
    'src_cli_graphify_build_ts_runBuild',
  ]);
  assert.equal(report.impact.callees[0].calls, 2);
});

test('archivos fuera del grafo se reportan, no rompen', () => {
  const report = computeDiffImpact(graph, ['package.json', 'src/cli/archivo-nuevo.ts']);
  assert.equal(report.files.length, 0);
  assert.deepEqual(report.notInGraph, ['package.json', 'src/cli/archivo-nuevo.ts']);
});

test('contains no genera impacto — solo edges calls', () => {
  const report = computeDiffImpact(graph, ['src/cli/graphify.ts']);
  const allIds = [...report.impact.callers, ...report.impact.callees].map((s) => s.id);
  assert.ok(
    !allIds.includes('src_cli_graphify_ts_main'),
    'el edge contains file→main no debe crear impacto',
  );
});

test('normaliza separadores Windows y prefijo ./', () => {
  const backslash = computeDiffImpact(graph, ['src\\cli\\graphify.ts']);
  assert.equal(backslash.files.length, 1);
  const dotPrefix = computeDiffImpact(graph, ['./src/cli/graphify.ts']);
  assert.equal(dotPrefix.files.length, 1);
});

test('varios archivos: dos archivos cambiados cruzan callers/callees correctamente', () => {
  const report = computeDiffImpact(graph, ['src/cli/graphify.ts', 'src/cli/graphify-build.ts']);
  // runBuild es cambiado → el edge main→runBuild no crea callee (ambos cambiados)
  const calleeIds = report.impact.callees.map((c) => c.id);
  assert.deepEqual(calleeIds, ['src_core_run-command_ts_runSync']);
  // y runBuild aparece como símbolo tocado del segundo archivo
  const build = report.files.find((f) => f.file === 'src/cli/graphify-build.ts');
  assert.ok(build);
  assert.deepEqual(
    build.matchedSymbols.map((s) => s.id),
    ['src_cli_graphify_build_ts_runBuild'],
  );
});

test('max recorta callers/callees/matchedSymbols', () => {
  const report = computeDiffImpact(graph, ['src/cli/graphify.ts'], 1);
  assert.equal(report.files[0].matchedSymbols.length, 1);
  assert.equal(report.impact.callees.length, 1);
  assert.equal(report.impact.callers.length, 1);
});

test('sin archivos: reporte vacío sin error', () => {
  const report = computeDiffImpact(graph, []);
  assert.deepEqual(report.files, []);
  assert.deepEqual(report.impact.callers, []);
  assert.deepEqual(report.impact.callees, []);
  assert.deepEqual(report.notInGraph, []);
});

test('edge colgante (nodo inexistente en el grafo): no rompe, degrada a undefined', () => {
  const dangling: Graph = {
    nodes: [
      { id: 'src_a_ts', label: 'a.ts', kind: 'file', source_file: 'src/a.ts' },
      { id: 'src_a_ts_fn', label: 'fn', kind: 'function', source_file: 'src/a.ts' },
    ],
    links: [
      { source: 'src_nodo_fantasma_ts_run', target: 'src_a_ts_fn', type: 'calls' },
      { source: 'src_a_ts_fn', target: 'src_b_ts_run', type: 'calls' },
    ],
  };
  const report = computeDiffImpact(dangling, ['src/a.ts']);
  assert.equal(report.impact.callers.length, 1);
  assert.equal(report.impact.callers[0].id, 'src_nodo_fantasma_ts_run');
  assert.equal(report.impact.callers[0].label, undefined);
  assert.equal(report.impact.callers[0].calls, 1);
  assert.equal(report.impact.callees.length, 1);
  assert.equal(report.impact.callees[0].id, 'src_b_ts_run');
  assert.equal(report.impact.callees[0].label, undefined);
});
