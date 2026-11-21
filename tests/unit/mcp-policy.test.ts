/**
 * BL-2026-11-18 — la decision sobre un MCP tiene que ser REAL en todos los
 * consumidores, no solo en el archivo de config que la declara.
 *
 * Casos que fijan:
 *   1. La identidad por alias: el registro dice `engram-mcp`, la politica dice
 *      `engram`. Sin resolucion, el consumidor no encuentra la invariante y
 *      decide por su cuenta.
 *   2. `mayAutoStart`: lo pesado a demanda, lo indispensable siempre.
 *   3. `buildRegistryDrift`: el registro no puede auto-arrancar lo que la
 *      politica declara a demanda (medido: el gateway levantaba los 11).
 *   4. `findUninventoriedSurfaces`: una superficie MCP del repo que el censo
 *      no mira es un punto ciego (medido: `.opencode/mcp.json`,
 *      `.zcode/config.json` y `.continue/config.json` declaraban codegraph).
 *   5. `mcpBucketOf`: el bucket de servidores vive en tres formas distintas.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  activationFor,
  autoStartReason,
  mayAutoStart,
  normalizeName,
  resolvePolicyKey,
} from '../../src/mcp/mcp-policy.ts';
import {
  buildRegistryDrift,
  findUninventoriedSurfaces,
  mcpBucketOf,
  type Surface,
} from '../../src/tools/mcp-lifecycle.ts';

const POLICY = {
  servers: {
    engram: { activation: 'always-on' as const },
    rea: { activation: 'on-demand' as const },
    'skill-server': {
      activation: 'warm-when-using-skills' as const,
      surfaces: { repo: 'on-demand' as const, cursor: 'always-on' as const },
    },
    codegraph: { activation: 'disabled-by-policy' as const },
  },
};

describe('mcp-policy: una sola fuente de verdad', () => {
  it('resuelve el alias del registro contra la politica', () => {
    assert.equal(resolvePolicyKey(POLICY, 'engram'), 'engram');
    assert.equal(resolvePolicyKey(POLICY, 'engram-mcp'), 'engram');
    assert.equal(resolvePolicyKey(POLICY, 'desconocido'), undefined);
  });

  it('normaliza nombres quitando el sufijo de servidor', () => {
    assert.equal(normalizeName('engram-mcp'), 'engram');
    assert.equal(normalizeName('skill-server'), 'skill');
  });

  it('la activacion sale del override por superficie si existe', () => {
    assert.equal(activationFor(POLICY, 'skill-server', 'repo'), 'on-demand');
    assert.equal(activationFor(POLICY, 'skill-server', 'cursor'), 'always-on');
    assert.equal(activationFor(POLICY, 'skill-server', 'otro'), 'warm-when-using-skills');
  });

  it('lo pesado a demanda no se auto-arranca; lo indispensable si', () => {
    assert.equal(mayAutoStart(POLICY, 'engram-mcp'), true);
    assert.equal(mayAutoStart(POLICY, 'rea'), false);
    assert.equal(mayAutoStart(POLICY, 'codegraph'), false);
    // El override por superficie manda sobre la activacion global.
    assert.equal(mayAutoStart(POLICY, 'skill-server'), false);
  });

  it('sin invariante declarada, el registro decide', () => {
    assert.equal(mayAutoStart(POLICY, 'no-declarado'), true);
    assert.equal(autoStartReason(POLICY, 'no-declarado'), null);
  });

  it('el motivo del no-arranque es legible', () => {
    assert.match(autoStartReason(POLICY, 'rea') ?? '', /on-demand/);
    assert.equal(autoStartReason(POLICY, 'engram'), null);
  });
});

describe('deriva registro vs politica', () => {
  it('detecta un server que la politica prohibe auto-arrancar', () => {
    const drift = buildRegistryDrift(POLICY, [{ name: 'rea', autoStart: true }]);
    assert.equal(drift.length, 1);
    assert.equal(drift[0].kind, 'registry');
    assert.equal(drift[0].actual, 'auto-start-enabled');
    assert.equal(drift[0].expected, 'on-demand');
  });

  it('detecta un server always-on que el registro no calienta', () => {
    const drift = buildRegistryDrift(POLICY, [{ name: 'engram-mcp', autoStart: false }]);
    assert.equal(drift.length, 1);
    assert.equal(drift[0].actual, 'auto-start-disabled');
  });

  it('no inventa deriva cuando la politica no declara invariante', () => {
    const drift = buildRegistryDrift(POLICY, [{ name: 'inventado', autoStart: true }]);
    assert.equal(drift.length, 0);
  });

  it('el alias del registro se resuelve contra la politica', () => {
    const drift = buildRegistryDrift(POLICY, [{ name: 'engram-mcp', autoStart: false }]);
    assert.equal(drift.length, 1);
  });
});

describe('inventario de superficies MCP del repo', () => {
  function repoWithMcpFile(relative: string, body: unknown): string {
    const root = mkdtempSync(join(tmpdir(), 'mcp-inventory-'));
    const path = join(root, relative);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(body, null, 2));
    return root;
  }

  const knownSurface = (id: string, path: string): Surface => ({
    id,
    label: id,
    path,
    owner: 'stack',
    format: 'mcpServers',
    supportsEnabledFlag: false,
    writable: true,
  });

  it('encuentra una superficie del repo que el censo no mira', () => {
    const root = repoWithMcpFile('.opencode/mcp.json', {
      servers: { codegraph: { command: 'codegraph' } },
    });
    const found = findUninventoriedSurfaces(root, []);
    assert.equal(found.length, 1);
    assert.equal(found[0].path, '.opencode/mcp.json');
    assert.deepEqual(found[0].servers, ['codegraph']);
  });

  it('una superficie ya declarada no se reporta', () => {
    const root = repoWithMcpFile('.opencode/mcp.json', {
      servers: { codegraph: { command: 'codegraph' } },
    });
    const path = join(root, '.opencode/mcp.json');
    const found = findUninventoriedSurfaces(root, [knownSurface('opencode-dir', path)]);
    assert.equal(found.length, 0);
  });

  it('un archivo sin servidores MCP no es superficie', () => {
    const root = repoWithMcpFile('.windsurf/config.json', { theme: 'dark' });
    assert.equal(findUninventoriedSurfaces(root, []).length, 0);
  });
});

describe('formas del bucket de servidores MCP', () => {
  it('lee el formato mcpServers', () => {
    const bucket = mcpBucketOf({ mcpServers: { a: { command: 'x' } } });
    assert.deepEqual(Object.keys(bucket ?? {}), ['a']);
  });

  it('lee el formato servers (VS Code, .opencode/mcp.json)', () => {
    const bucket = mcpBucketOf({ servers: { a: { command: 'x' } } });
    assert.deepEqual(Object.keys(bucket ?? {}), ['a']);
  });

  it('lee el formato mcp.servers (OpenCode, ZCode)', () => {
    const bucket = mcpBucketOf({ mcp: { servers: { a: { command: 'x' } } } });
    assert.deepEqual(Object.keys(bucket ?? {}), ['a']);
  });

  it('una config sin servidores MCP devuelve nada', () => {
    assert.equal(mcpBucketOf({ theme: 'dark' }), undefined);
    assert.equal(mcpBucketOf({ mcp: { type: 'local' } }), undefined);
  });
});
