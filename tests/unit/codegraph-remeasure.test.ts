#!/usr/bin/env node
/** Unit Tests: codegraph-remeasure — clasificador de tools y veredictos por fecha. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyCodegraphTool,
  recordOutcome,
  remeasureCodegraph,
} from '../../src/ops/codegraph-remeasure.js';

test('clasificador: semánticas son las que justifican el índice', () => {
  assert.equal(classifyCodegraphTool('mcp__codegraph__context'), 'semantic');
  assert.equal(classifyCodegraphTool('codegraph_context'), 'semantic');
  assert.equal(classifyCodegraphTool('mcp__codegraph__callers'), 'semantic');
  assert.equal(classifyCodegraphTool('mcp__codegraph__callees'), 'semantic');
  assert.equal(classifyCodegraphTool('codegraph_search'), 'semantic');
  assert.equal(classifyCodegraphTool('codegraph_impact'), 'semantic');
});

test('clasificador: files/status son estructurales (lo único que se usó antes del disable)', () => {
  assert.equal(classifyCodegraphTool('codegraph_files'), 'structural');
  assert.equal(classifyCodegraphTool('mcp__codegraph__status'), 'structural');
});

test('clasificador: lo demás es other', () => {
  assert.equal(classifyCodegraphTool('codegraph'), 'other');
  assert.equal(classifyCodegraphTool('mcp__codegraph____ping'), 'other');
  assert.equal(classifyCodegraphTool('engram_search'), 'other');
  assert.equal(classifyCodegraphTool('codegraph_contextual'), 'other');
});

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'gv-remeasure-'));
  mkdirSync(root, { recursive: true });
  return root;
}

test('veredicto pendiente: antes de la fecha comprometida no decide', () => {
  const root = fixtureRoot();
  writeFileSync(
    join(root, 'codegraph.config.json'),
    JSON.stringify({ reenabledAt: '2026-11-18T18:09:07.342Z', reMeasureAt: '2026-12-18' }),
  );
  const now = Date.parse('2026-11-19T12:00:00.000Z');
  const result = remeasureCodegraph(join(root, 'codegraph.config.json'), now, root);
  assert.equal(result.verdict, 'pendiente');
  assert.equal(result.decisionDue, false);
  assert.equal(result.semanticHits, 0);
});

test('veredicto re-disable: decisión vencida con 0 semánticas', () => {
  const root = fixtureRoot();
  writeFileSync(
    join(root, 'codegraph.config.json'),
    JSON.stringify({ reenabledAt: '2026-11-18T18:09:07.342Z', reMeasureAt: '2026-12-18' }),
  );
  const now = Date.parse('2026-12-19T12:00:00.000Z');
  const result = remeasureCodegraph(join(root, 'codegraph.config.json'), now, root);
  assert.equal(result.verdict, 're-disable-recomendado');
  assert.equal(result.decisionDue, true);
  assert.ok(result.note.includes('codegraph:disable'));
});

test('veredicto permanece: transcript fabricado con invocaciones semánticas reales', () => {
  const root = fixtureRoot();
  writeFileSync(
    join(root, 'codegraph.config.json'),
    JSON.stringify({ reenabledAt: '2026-01-01T00:00:00.000Z', reMeasureAt: '2026-02-01' }),
  );
  // Transcript en el formato que scanHost parsea (anthropic tool_use — ver calibrateDetector).
  const home = join(root, 'home');
  mkdirSync(join(home, '.zcode', 'cli', 'rollout'), { recursive: true });
  const line = (tool: string) =>
    `{"type":"assistant","content":[{"type":"tool_use","id":"t1","name":"${tool}","input":{}}]}\n`;
  writeFileSync(
    join(home, '.zcode', 'cli', 'rollout', 'session.jsonl'),
    line('mcp__codegraph__codegraph_context') +
      line('mcp__codegraph__codegraph_context') +
      line('mcp__codegraph__codegraph_files'),
  );
  const now = Date.parse('2026-02-02T12:00:00.000Z');
  const result = remeasureCodegraph(join(root, 'codegraph.config.json'), now, home);
  assert.equal(result.verdict, 'permanece');
  assert.equal(result.semanticHits, 2);
  assert.equal(result.structuralHits, 1);
  assert.deepEqual(result.hostsUsingSemantic, ['ZCode']);
  assert.ok(result.lastSemanticAt);
  assert.ok(result.note.includes('permanece con evidencia'));
});

test('la raiz del repo sigue al config: el fixture no lee el .runtime real', () => {
  // Regresión del fallo medido: con la raiz implicita (process.cwd()), el host
  // "MCP bridge (stack)" escaneaba el `.runtime/mcp-calls.jsonl` REAL del repo y
  // el test dependia del estado de la maquina (structuralHits 2 en vez de 1).
  // Aqui la raiz esta junto al config: el log del puente del fixture SI cuenta.
  const root = fixtureRoot();
  writeFileSync(
    join(root, 'codegraph.config.json'),
    JSON.stringify({ reenabledAt: '2026-01-01T00:00:00.000Z', reMeasureAt: '2026-02-01' }),
  );
  mkdirSync(join(root, '.runtime'), { recursive: true });
  writeFileSync(
    join(root, '.runtime', 'mcp-calls.jsonl'),
    '{"at":"2026-02-01T00:00:00.000Z","via":"bridge","type":"assistant","content":[{"type":"tool_use","id":"bridge-codegraph","name":"mcp__codegraph__codegraph_files","input":{}}],"server":"codegraph"}\n',
  );
  const result = remeasureCodegraph(
    join(root, 'codegraph.config.json'),
    Date.parse('2026-02-02T12:00:00.000Z'),
    join(root, 'home'),
  );
  assert.equal(result.structuralHits, 1);
  assert.equal(result.semanticHits, 0);
});

test('config sin compromiso (sin fechas) falla explícitamente', () => {
  const root = fixtureRoot();
  writeFileSync(join(root, 'codegraph.config.json'), JSON.stringify({ enabled: true }));
  assert.throws(
    () => remeasureCodegraph(join(root, 'codegraph.config.json'), Date.now(), root),
    /no hay compromiso/,
  );
});

test('recordOutcome: registra veredicto y fecha en el config (protocolo watchtower)', () => {
  const root = fixtureRoot();
  const configPath = join(root, 'codegraph.config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      enabled: true,
      reenabledAt: '2026-11-18T18:09:07.342Z',
      reMeasureAt: '2026-12-18',
    }),
  );
  const result = remeasureCodegraph(configPath, Date.parse('2026-12-19T12:00:00.000Z'), root);
  recordOutcome(configPath, result);
  const after = JSON.parse(readFileSync(configPath, 'utf-8')) as {
    remeasureResolvedAt?: string;
    remeasureVerdict?: string;
  };
  assert.equal(after.remeasureVerdict, 're-disable-recomendado');
  assert.equal(after.remeasureResolvedAt, result.until);
  // el compromiso histórico se preserva (no se borra la decisión)
  assert.equal(after.reMeasureAt, '2026-12-18');
});
