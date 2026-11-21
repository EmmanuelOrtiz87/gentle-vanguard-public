/**
 * agent-reachability.test.ts — ningún agente registrado puede quedar archivado.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkReachability, formatReport } from '../../src/ops/agent-reachability.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(resolve(ROOT, relative), 'utf-8')) as T;
}

test('el repo real no tiene agentes archivados', () => {
  const report = checkReachability(
    readJson('config/agents.json'),
    readJson('config/auto-delegation.json'),
    readJson('opencode.json'),
  );
  assert.deepEqual(report.missingFromRoster, [], 'hay agentes fuera del roster');
  assert.deepEqual(report.missingFromOpencode, [], 'hay agentes fuera de opencode.json');
  assert.deepEqual(report.rosterWithoutRegistration, [], 'el roster tiene agentes sin registro');
  assert.equal(report.ok, true);
});

test('el agente de narración es alcanzable', () => {
  const report = checkReachability(
    readJson('config/agents.json'),
    readJson('config/auto-delegation.json'),
    readJson('opencode.json'),
  );
  assert.ok(report.registered.includes('editorial-agent'));
  assert.ok(report.inRoster.includes('editorial-agent'));
  assert.ok(report.inOpencode.includes('editorial-agent'));
});

test('un agente fuera del roster se detecta y se nombra', () => {
  const report = checkReachability(
    { agents: { 'x-agent': { name: 'x-agent' } } },
    { _meta: { availableAgents: [] } },
    { agent: {} },
  );
  assert.equal(report.ok, false);
  assert.deepEqual(report.missingFromRoster, ['x-agent']);
  assert.deepEqual(report.missingFromOpencode, ['x-agent']);
  assert.match(formatReport(report), /x-agent/);
});

test('un nombre del roster sin registro se detecta', () => {
  const report = checkReachability(
    { agents: {} },
    { _meta: { availableAgents: ['fantasma'] } },
    { agent: { fantasma: {} } },
  );
  assert.equal(report.ok, false);
  assert.deepEqual(report.rosterWithoutRegistration, ['fantasma']);
});
