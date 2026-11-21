/**
 * adaptive-router-hits.test.ts — los recibos frescos de delegación alimentan la
 * tabla de routing (GB-20261120). Sin esta ingesta, el loop de aprendizaje solo
 * veía histórico congelado (metrics-report con lastEvent de septiembre).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectDelegations } from '../../src/orchestration/adaptive-router/collect.js';
import { computeAgentPerformance } from '../../src/orchestration/adaptive-router/table.js';
import { DEFAULT_CONFIG } from '../../src/orchestration/adaptive-router/config.js';

const quiet = () => {};

function writeHits(records: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'gv-hits-'));
  const path = join(dir, 'hits.jsonl');
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  dirs.push(dir);
  return path;
}

const dirs: string[] = [];

function cleanup(): void {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

test('los recibos de hits.jsonl se convierten en registros de delegación', () => {
  const path = writeHits([
    {
      timestamp: '2026-11-19T22:40:52Z',
      domain: 'editorial',
      agent: 'editorial-agent',
      success: true,
      duration: 45006,
    },
    {
      timestamp: '2026-11-20T15:22:09Z',
      domain: 'editorial',
      agent: 'editorial-agent',
      success: false,
      duration: 218,
    },
  ]);
  try {
    const delegations = collectDelegations(quiet, path);
    assert.equal(delegations.length, 2);
    assert.equal(delegations[0].agent, 'editorial-agent');
    assert.equal(delegations[0].domain, 'editorial');
    assert.equal(delegations[0].success, true);
    assert.equal(delegations[1].duration, 218);
  } finally {
    cleanup();
  }
});

test('un recibo sin agente o sin éxito verificable no es evidencia y se descarta', () => {
  const path = writeHits([
    {
      timestamp: '2026-11-19T00:00:00Z',
      domain: 'editorial',
      agent: '',
      success: true,
      duration: 1,
    },
    {
      timestamp: '2026-11-19T00:00:01Z',
      domain: 'editorial',
      agent: 'editorial-agent',
      success: 'true',
      duration: 1,
    },
    {
      timestamp: '2026-11-19T00:00:02Z',
      domain: 'editorial',
      agent: 'editorial-agent',
      success: false,
      duration: 5,
    },
  ]);
  const delegations = collectDelegations(quiet, path);
  assert.equal(delegations.length, 1);
  assert.equal(delegations[0].success, false);
});

test('el rendimiento del agente en la tabla refleja los recibos frescos', () => {
  const path = writeHits([
    {
      domain: 'editorial',
      agent: 'editorial-agent',
      success: true,
      duration: 45000,
      timestamp: '2026-11-19T22:40:52Z',
    },
    {
      domain: 'editorial',
      agent: 'editorial-agent',
      success: false,
      duration: 30000,
      timestamp: '2026-11-19T22:41:00Z',
    },
    {
      domain: 'editorial',
      agent: 'editorial-agent',
      success: true,
      duration: 40000,
      timestamp: '2026-11-19T22:42:00Z',
    },
  ]);
  const delegations = collectDelegations(quiet, path);
  const { agentPerformance } = computeAgentPerformance(
    [],
    delegations,
    [],
    [],
    [],
    [],
    DEFAULT_CONFIG,
  );
  const editorial = agentPerformance.find((a) => a.agentId === 'editorial-agent');
  assert.ok(editorial, 'el agente editorial debe aparecer en la tabla');
  assert.equal(editorial.totalDelegations, 3);
  assert.equal(editorial.outcomeCount, 3);
  assert.equal(editorial.successes, 2);
  assert.equal(editorial.successRate, 2 / 3);
  assert.equal(editorial.domain, 'editorial');
  assert.equal(editorial.lastEvent, '2026-11-19T22:42:00Z');
});

test('sin archivo de recibos la recolección sigue funcionando (sin crashear)', () => {
  const delegations = collectDelegations(quiet, join(tmpdir(), 'no-existe', 'hits.jsonl'));
  assert.ok(Array.isArray(delegations));
});
