import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  diffToolsets,
  dedupeServerSpecs,
  loadServerSpecs,
  parseArgString,
  signatureOf,
} from '../../src/mcp/mcp-inventory.js';

describe('parseArgString', () => {
  it('splitea por espacios y respeta rutas con comillas', () => {
    assert.deepEqual(
      parseArgString('-y @modelcontextprotocol/server-filesystem@latest C:\\Workspace_local'),
      ['-y', '@modelcontextprotocol/server-filesystem@latest', 'C:\\Workspace_local'],
    );
    assert.deepEqual(parseArgString('"C:\\Program Files\\tool" --flag'), [
      'C:\\Program Files\\tool',
      '--flag',
    ]);
    assert.deepEqual(parseArgString(''), []);
    assert.deepEqual(parseArgString(undefined), []);
    assert.deepEqual(parseArgString(['-y', 'x']), []);
  });
});

describe('diffToolsets', () => {
  it('detecta added y removed', () => {
    assert.deepEqual(diffToolsets(['a', 'b'], ['b', 'c']), { added: ['c'], removed: ['a'] });
  });
  it('sin drift', () => {
    assert.deepEqual(diffToolsets(['a', 'b'], ['b', 'a']), { added: [], removed: [] });
  });
  it('normaliza a listas vacias', () => {
    assert.deepEqual(diffToolsets([], ['x']), { added: ['x'], removed: [] });
  });
});

describe('signatureOf / dedupeServerSpecs', () => {
  const mk = (
    name: string,
    source: 'mcp-registry' | 'opencode',
    command: string,
    args: string[] = [],
  ) => ({ name, source, command, args });

  it('normaliza separadores y case en la firma', () => {
    assert.equal(
      signatureOf(mk('a', 'opencode', 'CodeGraph', ['serve'])),
      signatureOf(mk('b', 'mcp-registry', 'codegraph', ['serve'])),
    );
    assert.notEqual(
      signatureOf(mk('a', 'opencode', 'node', ['--x'])),
      signatureOf(mk('a', 'opencode', 'node', ['--y'])),
    );
  });

  it('dedupe: la misma instancia declarada en registry+opencode comparte resultado', () => {
    const specs = [
      mk('gv-analytics-atlassian', 'mcp-registry', 'node', [
        '--import',
        'tsx',
        'apps/gv-analytics/server/mcp.ts',
      ]),
      mk('codegraph', 'opencode', 'codegraph', ['serve', '--mcp']),
      mk('gv-analytics-atlassian', 'opencode', 'node', [
        '--import',
        'tsx',
        'apps/gv-analytics/server/mcp.ts',
      ]),
    ];
    const out = dedupeServerSpecs(specs);
    assert.equal(out.length, 3);
    assert.ok(out[0].isPrimary, 'primera entry es primary');
    assert.ok(out[1].isPrimary, 'codegraph tiene firma única');
    assert.ok(out[1].primaryName === 'codegraph');
    assert.ok(!out[2].isPrimary, 'duplicado de gv-analytics no es primary');
    assert.ok(out[2].primaryName === 'gv-analytics-atlassian');
  });
});

describe('loadServerSpecs', () => {
  it('lee servers habilitados del repo (sanity sobre configs reales)', () => {
    const specs = loadServerSpecs(process.cwd(), false);
    const names = specs.map((s) => s.name);
    // La politica declara engram como always-on: es el probe del estado real.
    assert.ok(names.includes('engram'), 'engram (always-on) debe estar');
    assert.ok(
      specs.some((s) => s.source === 'mcp-registry'),
      'registry presente',
    );
    // Los servidores apagados por politica (codegraph, harness, rea) no se levantan.
    for (const apagado of ['codegraph', 'harness', 'rea']) {
      assert.ok(
        !names.includes(apagado),
        `${apagado} esta apagado por politica: no debe levantarse`,
      );
    }
    const engram = specs.find((s) => s.name === 'engram' && s.source === 'opencode');
    assert.ok(engram && Array.isArray(engram.args) && engram.args.length > 0, 'args normalizados');
    assert.ok(!names.includes('chrome-devtools'), 'heavy excluded por default');
    // Los a demanda (autoStart: false) si se inventarian con --include-heavy:
    // args arrays en opencode.json (2026-10-21) y en el registro.
    const conHeavy = loadServerSpecs(process.cwd(), true);
    const gva = conHeavy.find((s) => s.name === 'gv-analytics-atlassian');
    assert.ok(
      gva && gva.args.length === 3,
      `gv-analytics-atlassian args debe normalizar array (got ${JSON.stringify(gva?.args)})`,
    );
  });
});
