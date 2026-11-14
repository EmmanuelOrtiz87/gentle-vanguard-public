#!/usr/bin/env node
/**
 * Unit Tests: stack-verify reporta TODAS sus capas (layerPlan)
 *
 * Contratest del defecto real medido el 2026-11-14: `stack-verify` resumia
 * "17 PASS | 23 WARN | 2 FAIL | 44 total" e imprimia ~20 lineas, sin una sola
 * linea con el nombre de lo que fallaba. Causa: `printReport` tenia la lista de
 * capas hardcodeada con 4 entradas mientras `CheckResult.layer` admitia 5
 * (faltaba `apps`, la capa mas lenta: typecheck/test/build de 30 apps).
 *
 * El efecto practico era el peor posible: un FAIL invisible. Indistinguible de
 * un flake, y contrario a NORMATIVA-VERIFICACIONES-STACK §4.2 ("todo gate imprime
 * su resultado legible").
 *
 * Estos tests fallan si alguien vuelve a hardcodear la lista y deja una capa
 * afuera. No prueban el texto impreso (eso es formato); prueban que NINGUN
 * result quede sin capa asignada, que es la condicion del bug.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { layerPlan, type CheckResult } from '../../src/ops/stack-verify.ts';

const result = (
  layer: CheckResult['layer'],
  status: CheckResult['status'],
  name = `check-${layer}`,
): CheckResult => ({ name, layer, status, message: 'fixture' });

test('layerPlan: incluye `apps` — la capa que el bug dejaba afuera', () => {
  const plan = layerPlan([result('apps', 'FAIL', 'app:command-center')]);
  const keys = plan.map((l) => l.key);
  assert.ok(keys.includes('apps'), `apps ausente del plan: ${keys.join(', ')}`);
  assert.equal(plan.find((l) => l.key === 'apps')?.label, 'APPS (typecheck / test / build)');
});

test('layerPlan: ningun result queda sin capa (cobertura total)', () => {
  const layers: CheckResult['layer'][] = ['deps', 'platform', 'services', 'integrity', 'apps'];
  const results = layers.map((layer) => result(layer, 'PASS'));
  const keys = layerPlan(results).map((l) => l.key);
  for (const layer of layers) {
    assert.ok(keys.includes(layer), `capa ${layer} no se imprimiria (plan: ${keys.join(', ')})`);
  }
});

test('layerPlan: una capa desconocida se imprime igual, no se descarta', () => {
  // Un modulo nuevo puede empujar results con un layer fuera del union: si el
  // plan lo ignora, ese result es invisible. El fallback debe cubrirlo.
  const rogue = {
    name: 'rogue',
    layer: 'observability',
    status: 'FAIL',
    message: 'x',
  } as unknown as CheckResult;
  const plan = layerPlan([rogue]);
  const keys = plan.map((l) => l.key);
  assert.ok(
    keys.includes('observability' as CheckResult['layer']),
    `capa desconocida descartada: ${keys.join(', ')}`,
  );
  assert.equal(plan[0]?.label, 'OBSERVABILITY');
});

test('layerPlan: no imprime encabezados de capas sin resultados', () => {
  const plan = layerPlan([result('integrity', 'PASS')]);
  assert.deepEqual(
    plan.map((l) => l.key),
    ['integrity'],
  );
});

test('layerPlan: el orden de las capas conocidas es estable', () => {
  const results = [
    result('apps', 'PASS'),
    result('deps', 'PASS'),
    result('integrity', 'PASS'),
    result('platform', 'PASS'),
    result('services', 'PASS'),
  ];
  assert.deepEqual(
    layerPlan(results).map((l) => l.key),
    ['deps', 'platform', 'services', 'integrity', 'apps'],
  );
});
