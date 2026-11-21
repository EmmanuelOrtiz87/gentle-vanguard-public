import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  auditCodegraphUsage,
  calibrateDetector,
  countHitsInLine,
} from '../../src/tools/codegraph-usage-audit.ts';

describe('codegraph-usage-audit · detector', () => {
  it('calibra con controles positivos y negativos', () => {
    const calibration = calibrateDetector();
    const failed = calibration.checks.filter((c) => !c.pass);
    assert.deepEqual(failed, [], `controles fallados: ${failed.map((c) => c.name).join(', ')}`);
    assert.equal(calibration.pass, true);
  });

  it('cuenta la invocacion anthropic tool_use', () => {
    const line =
      '{"type":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"mcp__codegraph__codegraph_context","input":{}}]}';
    assert.equal(countHitsInLine(line).hits, 1);
  });

  it('cuenta la invocacion mcode toolCall', () => {
    const line =
      '{"message":{"role":"assistant","content":[{"type":"toolCall","id":"call_1","name":"mcp__codegraph__codegraph_status","arguments":"{}"}]}}';
    assert.equal(countHitsInLine(line).hits, 1);
  });

  it('cuenta la invocacion zcode toolCalls[]', () => {
    const line = '{"response":{"toolCalls":[{"id":"call_2","name":"codegraph_files","input":{}}]}}';
    assert.equal(countHitsInLine(line).hits, 1);
  });

  it('NO cuenta el catalogo MCP (declarado no es usado)', () => {
    const line =
      '{"request":{"tools":[{"name":"mcp__codegraph__codegraph_status","description":"Status","input_schema":{"type":"object"}}]}}';
    assert.equal(countHitsInLine(line).hits, 0);
  });

  it('NO cuenta la mencion en texto', () => {
    const line =
      '{"message":{"role":"assistant","content":[{"type":"thinking","thinking":"codegraph no se usa"}]}}';
    assert.equal(countHitsInLine(line).hits, 0);
  });

  it('NO cuenta el input de una tool (name de un simbolo)', () => {
    const line =
      '{"type":"assistant","content":[{"type":"tool_use","id":"toolu_3","name":"read","input":{"name":"codegraph_status"}}]}';
    assert.equal(countHitsInLine(line).hits, 0);
  });
});

describe('codegraph-usage-audit · veredicto', () => {
  it('nunca declara "unused" con el detector sin calibrar', () => {
    const result = auditCodegraphUsage(365, '/ruta/que/no/existe');
    // Sin transcripts no hay veredicto de uso.
    assert.equal(result.hostsWithoutData.length, result.hosts.length);
    assert.equal(result.verdict, 'no-data');
    assert.equal(result.calibration.pass, true);
  });
});
