/**
 * mcp-suggest.test.ts — el mapa de demanda MCP.
 *
 * Los tres invariantes que protege:
 *   1. una intencion declara un servidor que el stack PUEDE lanzar (el mapa no
 *      puede prometer una capacidad inalcanzable);
 *   2. toda capacidad declarada en la politica tiene intencion (una
 *      capacidad sin intencion es capacidad no descubrible);
 *   3. el match es por token completo: `rea` no puede matchear dentro de
 *      `react` (medido: "leer la documentacion de react" puntuaba 10 para rea
 *      y ganaba sobre context7).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkDemandMap,
  loadDemandMap,
  normalize,
  scoreIntent,
  suggest,
} from '../../src/tools/mcp-suggest.js';

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-suggest-'));
  mkdirSync(join(dir, 'config'), { recursive: true });
  return dir;
}

describe('mapa de demanda MCP', () => {
  it('el mapa declara una intencion por capacidad de la politica', () => {
    const result = checkDemandMap();
    assert.ok(result.ok, `invariantes rotos:\n${result.problems.join('\n')}`);
    assert.ok(result.intents >= 10, 'el mapa cubre las capacidades del stack');
  });

  it('toda intencion apunta a un servidor lanzable', () => {
    const map = loadDemandMap();
    for (const intent of map.intents) {
      const suggestions = suggest(intent.server);
      const found = suggestions.find((s) => s.server === intent.server);
      assert.ok(found, `la intencion ${intent.id} no resuelve su propio servidor`);
      assert.notEqual(found?.mode, 'no-resoluble', `${intent.server} no es lanzable`);
    }
  });

  it('detecta una intencion que el stack no puede lanzar', () => {
    const root = tempRoot();
    try {
      writeFileSync(
        join(root, 'config', 'mcp-demand-map.json'),
        JSON.stringify({
          version: '1.0.0',
          description: 'test',
          intents: [
            {
              id: 'fantasma',
              task: 'capacidad inexistente',
              keywords: ['fantasma'],
              server: 'no-existe-este-servidor',
              tools: ['nada'],
              preloaded: false,
            },
          ],
        }),
        'utf-8',
      );
      const result = checkDemandMap(root);
      assert.equal(result.ok, false);
      assert.ok(
        result.problems.some((p) => p.includes('no-existe-este-servidor')),
        `problemas: ${result.problems.join(' | ')}`,
      );
    } finally {
      /* el tempdir lo limpia el OS */
    }
  });

  it('detecta una capacidad de la politica sin intencion en el mapa', () => {
    const root = tempRoot();
    try {
      // Sin politica en el temp root el invariante no tiene contra que
      // comparar: el mapa vacio pasaria el check sin decir nada.
      writeFileSync(
        join(root, 'config', 'mcp-lifecycle-policy.json'),
        JSON.stringify({
          version: '1.0.0',
          description: 'test',
          servers: {
            'skill-server': { activation: 'always-on' },
            'servidor-fantasma': { activation: 'on-demand' },
          },
        }),
        'utf-8',
      );
      writeFileSync(
        join(root, 'config', 'mcp-demand-map.json'),
        JSON.stringify({ version: '1.0.0', description: 'test', intents: [] }),
        'utf-8',
      );
      const result = checkDemandMap(root);
      assert.equal(result.ok, false);
      assert.ok(
        result.problems.some((p) => p.includes('servidor-fantasma')),
        `problemas: ${result.problems.join(' | ')}`,
      );
    } finally {
      /* el tempdir lo limpia el OS */
    }
  });

  it('el match es por token completo: rea no matchea dentro de react', () => {
    const map = loadDemandMap();
    const rea = map.intents.find((i) => i.server === 'rea');
    const ctx = map.intents.find((i) => i.server === 'context7');
    assert.ok(rea && ctx);
    const reaScore = scoreIntent(rea, 'leer la documentacion de react').score;
    const ctxScore = scoreIntent(ctx, 'leer la documentacion de react').score;
    assert.equal(reaScore, 0, '`react` no puede matchear con `rea`');
    assert.ok(ctxScore > 0, 'context7 debe matchear documentacion');
  });

  it('normaliza acentos y mayusculas', () => {
    assert.equal(normalize('ANÁLISIS de APK'), 'analisis de apk');
  });

  it('el modo declarado distingue precargado de a demanda', () => {
    const suggestions = suggest('buscar una skill');
    const skill = suggestions.find((s) => s.server === 'skill-server');
    assert.equal(skill?.mode, 'precargado');
    assert.ok(!skill?.command, 'un server precargado no necesita comando de puente');

    const onDemand = suggest('analizar un apk');
    const rea = onDemand.find((s) => s.server === 'rea');
    assert.equal(rea?.mode, 'a-demanda');
    assert.ok(rea?.command?.includes('--server rea'), 'debe dar el comando del puente');
  });

  it('responde con el servidor correcto para una tarea tipica', () => {
    const cases: Array<[string, string]> = [
      ['analizar un apk', 'rea'],
      ['leer la documentacion de react', 'context7'],
      ['tokens del design system', 'gv-design-system'],
      ['jira de la entrega', 'gv-analytics-atlassian'],
      ['definicion de la funcion', 'lsp-server'],
    ];
    for (const [query, expected] of cases) {
      const best = suggest(query)[0];
      assert.equal(best?.server, expected, `"${query}" deberia resolver a ${expected}`);
    }
  });
});
