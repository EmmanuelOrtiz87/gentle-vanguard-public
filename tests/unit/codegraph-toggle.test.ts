#!/usr/bin/env node
/**
 * Unit Tests: codegraph-toggle — el contrato que guarda el guardrail de codegraph.
 * readState/writeState/setMcpServer/syncPolicy son contratos que otras superficies
 * consumen (política MCP del stack): se testean con fixtures en temp dirs.
 * Sujeto del gate de mutation score (stryker.config.json → mutate).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readState, setMcpServer, syncPolicy, writeState } from '../../src/ops/codegraph-toggle.js';

function fixtureRoot(options: { withMcp?: boolean; withPolicy?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'gv-toggle-'));
  mkdirSync(join(root, 'config'), { recursive: true });
  if (options.withMcp) {
    writeFileSync(
      join(root, '.mcp.json'),
      `${JSON.stringify({ mcpServers: { engram: { command: 'engram', args: ['mcp'] } } }, null, 2)}\n`,
    );
  }
  if (options.withPolicy) {
    mkdirSync(join(root, 'config'), { recursive: true });
    writeFileSync(
      join(root, 'config', 'mcp-lifecycle-policy.json'),
      `${JSON.stringify(
        {
          servers: {
            codegraph: {
              role: 'code-intelligence',
              activation: 'disabled-by-policy',
              surfaces: { repo: 'disabled-by-policy', zcode: 'disabled-by-policy' },
            },
          },
        },
        null,
        2,
      )}\n`,
    );
  }
  return root;
}

test('readState: config ausente => enabled por defecto', () => {
  const root = fixtureRoot();
  assert.deepEqual(readState(root), { enabled: true });
});

test('readState: config corrupto => enabled por defecto (fail-safe)', () => {
  const root = fixtureRoot();
  writeFileSync(join(root, 'config', 'codegraph.config.json'), '{ roto');
  assert.deepEqual(readState(root), { enabled: true });
});

test('writeState/readState: roundtrip en temp root', () => {
  const root = fixtureRoot();
  writeState({ enabled: true, reason: 'prueba' }, root);
  assert.deepEqual(readState(root), { enabled: true, reason: 'prueba' });
});

test('setMcpServer(true): agrega codegraph con --path y preserva los demás servers', () => {
  const root = fixtureRoot({ withMcp: true });
  assert.equal(setMcpServer(true, root), true);
  const parsed = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf-8'));
  assert.ok(Object.hasOwn(parsed.mcpServers, 'codegraph'));
  assert.ok(Object.hasOwn(parsed.mcpServers, 'engram'), 'no debe tocar los demás');
  assert.ok(parsed.mcpServers.codegraph.args.includes('--path'), 'args lleva --path explícito');
});

test('setMcpServer(true): el entry NO declara el shim codegraph (.cmd ⇒ cmd.exe del host)', () => {
  const root = fixtureRoot({ withMcp: true });
  setMcpServer(true, root);
  const parsed = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf-8'));
  const entry = parsed.mcpServers.codegraph;
  assert.match(String(entry.command), /node(\.exe)?$/i, 'command debe ser node');
  assert.match(String(entry.args[0]), /codegraph\.js$/i, 'el primer arg es el entry JS');
});

test('setMcpServer(true): reescribe un entry viejo con shim (drift) y devuelve true', () => {
  const root = fixtureRoot({ withMcp: true });
  const path = join(root, '.mcp.json');
  const parsed = JSON.parse(readFileSync(path, 'utf-8'));
  parsed.mcpServers.codegraph = { command: 'codegraph', args: ['serve', '--mcp'] };
  writeFileSync(path, JSON.stringify(parsed, null, 2));
  assert.equal(setMcpServer(true, root), true);
  const next = JSON.parse(readFileSync(path, 'utf-8'));
  assert.notEqual(next.mcpServers.codegraph.command, 'codegraph');
});

test('setMcpServer(true): idempotente (ya presente => false, sin duplicar)', () => {
  const root = fixtureRoot({ withMcp: true });
  setMcpServer(true, root);
  assert.equal(setMcpServer(true, root), false);
  const parsed = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf-8'));
  assert.equal(Object.keys(parsed.mcpServers).filter((k) => k === 'codegraph').length, 1);
});

test('setMcpServer(false): saca el entry y preserva los demás', () => {
  const root = fixtureRoot({ withMcp: true });
  setMcpServer(true, root);
  assert.equal(setMcpServer(false, root), true);
  const parsed = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf-8'));
  assert.ok(!Object.hasOwn(parsed.mcpServers, 'codegraph'));
  assert.ok(Object.hasOwn(parsed.mcpServers, 'engram'));
});

test('setMcpServer(false): ya ausente => false', () => {
  const root = fixtureRoot({ withMcp: true });
  assert.equal(setMcpServer(false, root), false);
});

test('setMcpServer: sin .mcp.json => false sin explotar', () => {
  const root = fixtureRoot();
  assert.equal(setMcpServer(true, root), false);
});

test('syncPolicy(true): activation warm-when-developing y surfaces eliminadas', () => {
  const root = fixtureRoot({ withPolicy: true });
  assert.equal(syncPolicy(true, root), true);
  const parsed = JSON.parse(
    readFileSync(join(root, 'config', 'mcp-lifecycle-policy.json'), 'utf-8'),
  );
  assert.equal(parsed.servers.codegraph.activation, 'warm-when-developing');
  assert.ok(!('surfaces' in parsed.servers.codegraph), 'reactivar libera las superficies');
});

test('syncPolicy(false): activation disabled y TODAS las superficies bloqueadas', () => {
  const root = fixtureRoot({ withPolicy: true });
  syncPolicy(true, root);
  assert.equal(syncPolicy(false, root), true);
  const parsed = JSON.parse(
    readFileSync(join(root, 'config', 'mcp-lifecycle-policy.json'), 'utf-8'),
  );
  assert.equal(parsed.servers.codegraph.activation, 'disabled-by-policy');
  for (const value of Object.values(parsed.servers.codegraph.surfaces as Record<string, string>)) {
    assert.equal(value, 'disabled-by-policy');
  }
});

test('syncPolicy: idempotente (ya alineado => false)', () => {
  const root = fixtureRoot({ withPolicy: true });
  assert.equal(syncPolicy(true, root), true);
  assert.equal(syncPolicy(true, root), false);
});

test('syncPolicy: política sin entry codegraph => false', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-toggle-'));
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(
    join(root, 'config', 'mcp-lifecycle-policy.json'),
    `${JSON.stringify({ servers: { engram: { activation: 'always-on' } } }, null, 2)}\n`,
  );
  assert.equal(syncPolicy(true, root), false);
});

test('syncPolicy sin archivo de política => false', () => {
  const root = fixtureRoot();
  assert.equal(existsSync(join(root, 'config', 'mcp-lifecycle-policy.json')), false);
  assert.equal(syncPolicy(true, root), false);
});
