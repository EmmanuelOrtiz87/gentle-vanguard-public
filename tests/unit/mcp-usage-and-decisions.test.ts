#!/usr/bin/env node
/**
 * Tests de las capacidades nuevas del 2026-11-18:
 *   - detector generico de invocaciones MCP (calibrado, no cuenta el catalogo)
 *   - auditoria de uso por MCP declarado
 *   - toggle declarado de codegraph (MCP + sync + config)
 *   - seleccion determinista de relaciones pending de Engram
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calibrateDetector,
  countInvocations,
  extractInvocations,
} from '../../src/tools/mcp-invocation-detector.ts';
import {
  matchesServer,
  readDeclaredMcpServers,
  readPolicyMcpServers,
  readRegisteredMcpServers,
  scanHost,
  toolBreakdown,
  type HostSpec,
} from '../../src/tools/mcp-usage-audit.ts';
import { readState, setMcpServer } from '../../src/ops/codegraph-toggle.ts';
import {
  jaccard,
  selectJudgablePairs,
  tokensOf,
} from '../../src/ops/engram-judge-deterministic.ts';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('detector de invocaciones MCP', () => {
  it('se calibra con controles positivos y negativos', () => {
    const calibration = calibrateDetector();
    const failed = calibration.checks.filter((c) => !c.pass);
    assert.deepEqual(failed, [], `controles fallados: ${failed.map((c) => c.name).join(', ')}`);
    assert.equal(calibration.pass, true);
  });

  it('reconoce los tres formatos de invocacion', () => {
    const anthropic = extractInvocations(
      '{"type":"assistant","content":[{"type":"tool_use","id":"t1","name":"mcp__engram__mem_save","input":{}}]}',
    );
    assert.equal(anthropic.length, 1);
    assert.equal(anthropic[0].format, 'anthropic');

    const mcode = extractInvocations(
      '{"message":{"role":"assistant","content":[{"type":"toolCall","id":"c1","name":"mcp__engram__mem_save"}]}}',
    );
    assert.equal(mcode.length, 1);
    assert.equal(mcode[0].format, 'mcode');

    const openai = extractInvocations(
      '{"response":{"toolCalls":[{"id":"x","name":"mcp__engram__mem_save"}]}}',
    );
    assert.equal(openai.length, 1);
    assert.equal(openai[0].format, 'openai');
  });

  it('el catalogo NO es invocacion', () => {
    const line =
      '{"request":{"tools":[{"name":"mcp__engram__mem_save","description":"x","input_schema":{}}]}}';
    assert.equal(countInvocations(line, matchesServer('engram')).hits, 0);
  });

  it('el matcher reconoce el prefijo MCP y el nombre plano', () => {
    const matcher = matchesServer('codegraph');
    assert.equal(matcher('mcp__codegraph__codegraph_files'), true);
    assert.equal(matcher('codegraph_files'), true);
    assert.equal(matcher('mcp__codegraph_x__y'), false);
    assert.equal(matcher('read'), false);
  });
});

describe('auditoria de uso por MCP', () => {
  it('registra el NOMBRE de cada tool, no solo el total del servidor', () => {
    // La re-medicion de codegraph (2026-12-18) decide con este dato: 5
    // llamadas a codegraph_status no son "se usa el grafo".
    const dir = mkdtempSync(join(tmpdir(), 'mcp-tools-'));
    const root = mkdtempSync(join(tmpdir(), 'mcp-root-'));
    try {
      writeFileSync(
        join(dir, 's1.jsonl'),
        [
          '{"type":"assistant","content":[{"type":"tool_use","id":"a","name":"mcp__codegraph__codegraph_callers","input":{}}]}',
          '{"type":"assistant","content":[{"type":"tool_use","id":"b","name":"mcp__codegraph__codegraph_callers","input":{}}]}',
          '{"type":"assistant","content":[{"type":"tool_use","id":"c","name":"mcp__codegraph__codegraph_status","input":{}}]}',
        ].join('\n'),
      );
      const spec: HostSpec = {
        host: 'Fake',
        source: 'tmp',
        dir: () => dir,
        ext: '.jsonl',
        limit: 10,
      };
      const { scan } = scanHost(spec, tmpdir(), 0, root);
      assert.equal(scan.toolCalls['mcp__codegraph__codegraph_callers'], 2);
      assert.equal(scan.toolCalls['mcp__codegraph__codegraph_status'], 1);
      assert.equal(toolBreakdown(scan.toolCalls), 'codegraph_callers x2, codegraph_status x1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('lee los servidores declarados por el canon (.mcp.json)', () => {
    const servers = readDeclaredMcpServers(process.cwd());
    assert.ok(servers.includes('engram'), 'engram debe estar declarado');
    // El invariante no es el VALOR de la decision (codegraph se reactivo y se
    // puede volver a desactivar): es que el canon (.mcp.json) y el estado
    // declarado (config/codegraph.config.json) digan lo MISMO. Una decision
    // escrita en un solo lugar no es una decision.
    const declared = readState(process.cwd()).enabled;
    assert.equal(
      servers.includes('codegraph'),
      declared,
      'el canon (.mcp.json) y el estado declarado de codegraph deben coincidir',
    );
  });

  it('"declarado" son TRES fuentes: canon, registro y politica', () => {
    // Medido 2026-11-18: la auditoria reportaba `rea`, `fetch-server`,
    // `chrome-devtools` y `gv-analytics-atlassian` como "usados sin declarar"
    // cuando son a demanda POR DISENO y estan en el registro y en la
    // politica: solo faltan en `.mcp.json`, que es la lista de los
    // PRECARGADOS. Comparar contra el canon solo produce falsos positivos.
    const root = process.cwd();
    const canon = readDeclaredMcpServers(root);
    const registry = readRegisteredMcpServers(root);
    const policy = readPolicyMcpServers(root);

    // `rea` es a demanda: NO esta en el canon, pero SI en el registro y la
    // politica. Ese es el caso que la auditoria clasificaba como deriva.
    assert.ok(!canon.includes('rea'), 'rea no debe estar en el canon de precargados');
    assert.ok(registry.includes('rea'), 'rea debe estar en el registro');
    assert.ok(policy.includes('rea'), 'rea debe estar en la politica');

    // El invariante: todo lo que la politica declara tiene al menos una
    // via de declaracion mas alla del canon (registro o canon).
    const uncovered = policy.filter(
      (server) => !registry.includes(server) && !canon.includes(server),
    );
    assert.deepEqual(
      uncovered,
      [],
      `servidores de la politica sin registro ni canon: ${uncovered.join(', ')}`,
    );
  });
});

describe('toggle declarado de codegraph', () => {
  it('el estado vive declarado en config/codegraph.config.json', () => {
    const state = readState(process.cwd());
    assert.equal(typeof state.enabled, 'boolean', 'el estado debe estar declarado');
    assert.ok(state.reason && state.reason.length > 20, 'el motivo debe estar declarado');
    // Decision reversible: el config dice COMO volver atrás.
    assert.ok(
      typeof state.reversible === 'string' && state.reversible.length > 5,
      'el config debe declarar como revertir la decision',
    );
  });

  it('setMcpServer agrega y saca el servidor del .mcp.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-toggle-'));
    try {
      writeFileSync(
        join(dir, '.mcp.json'),
        JSON.stringify({ mcpServers: { engram: { command: 'engram' } } }, null, 2),
      );
      assert.equal(setMcpServer(true, dir), true, 'debe agregar codegraph');
      const after = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8'));
      assert.ok(after.mcpServers.codegraph);
      assert.equal(setMcpServer(false, dir), true, 'debe sacar codegraph');
      const removed = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8'));
      assert.equal(removed.mcpServers.codegraph, undefined);
      assert.ok(removed.mcpServers.engram, 'no debe tocar los otros servidores');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('juicio determinista de Engram', () => {
  it('solo selecciona pares con MISMO titulo y contenido equivalente', () => {
    const pairs = [
      {
        source_id: 'a',
        target_id: 'b',
        title_a: 'Duplicate cleanup check',
        title_b: 'Duplicate cleanup check',
        content_a: 'Duplicate check run at 2026-05-22 15:13:28. Found entries needing review.',
        content_b: 'Duplicate check run at 2026-05-22 16:16:27. Found entries needing review.',
        type_a: 'discovery',
        type_b: 'discovery',
      },
      {
        source_id: 'c',
        target_id: 'd',
        title_a: 'Ola 0 auditoria stack',
        title_b: 'Plan de readiness productivo',
        content_a: 'texto totalmente distinto',
        content_b: 'otro texto sin relacion',
        type_a: 'decision',
        type_b: 'decision',
      },
    ];
    const judged = selectJudgablePairs(pairs);
    assert.equal(judged.length, 1);
    assert.equal(judged[0].title, 'Duplicate cleanup check');
    assert.ok(judged[0].similarity >= 0.7);
  });

  it('el calculo de similitud ignora timestamps y palabras cortas', () => {
    const a = tokensOf('Duplicate check run at 2026-05-22 15:13:28. Found entries needing review.');
    const b = tokensOf('Duplicate check run at 2026-05-22 16:16:27. Found entries needing review.');
    assert.equal(jaccard(a, b), 1);
  });
});
