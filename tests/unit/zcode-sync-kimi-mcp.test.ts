/**
 * BL-2026-11-16 — zcode-sync genera .kimi-code/mcp.json.
 *
 * El audit de interoperabilidad exige el archivo con el servidor engram
 * declarado; antes el sync solo generaba skills espejo y cada clon nuevo
 * quedaba con Kimi en WARN hasta crearlo a mano.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKimiMcpConfig } from '../../src/integrations/zcode-sync.js';

test('buildKimiMcpConfig declara mcpServers.engram (contrato del audit)', () => {
  const cfg = buildKimiMcpConfig() as {
    mcpServers: { engram: Record<string, unknown> };
  };
  assert.ok(cfg.mcpServers, 'contenedor mcpServers');
  assert.ok(cfg.mcpServers.engram, 'servidor engram declarado');
  assert.equal(typeof cfg.mcpServers.engram, 'object');
  assert.equal(cfg.mcpServers.engram.command, 'engram');
});

test('buildKimiMcpConfig es determinística (idempotente en el sync)', () => {
  const a = JSON.stringify(buildKimiMcpConfig());
  const b = JSON.stringify(buildKimiMcpConfig());
  assert.equal(a, b);
});
