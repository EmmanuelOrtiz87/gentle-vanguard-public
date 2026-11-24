import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCensus,
  buildIdentities,
  expectedActivation,
  installEntry,
  isRealCodexSurface,
  readDemandState,
  removeEntry,
  signatureOf,
  toggleDemand,
  type Surface,
} from '../../src/tools/mcp-lifecycle.ts';
import { checkPolicy } from '../../src/tools/mcp-doctor.ts';

function fixtureRoot(
  policyServers: Record<string, unknown>,
  registryServers: Array<Record<string, unknown>> = [],
): string {
  const root = mkdtempSync(join(tmpdir(), 'mcp-lifecycle-'));
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(
    join(root, 'config', 'mcp-lifecycle-policy.json'),
    JSON.stringify({ version: '1.0.0', principles: [], servers: policyServers }),
  );
  writeFileSync(
    join(root, 'config', 'mcp-registry.json'),
    JSON.stringify({ servers: registryServers }),
  );
  return root;
}

function surface(id: string, entries: Record<string, Record<string, unknown>>): Surface {
  const path = join(mkdtempSync(join(tmpdir(), 'mcp-surf-')), 'config.json');
  writeFileSync(path, JSON.stringify({ mcpServers: entries }));
  return {
    id,
    label: id,
    path,
    owner: 'stack',
    format: 'mcpServers',
    supportsEnabledFlag: false,
    writable: true,
  };
}

describe('censo de MCPs', () => {
  it('validar política sin historial conserva toda la deriva y no afirma uso medido', () => {
    const root = fixtureRoot({
      engram: { activation: 'always-on' },
      rea: { activation: 'on-demand' },
    });
    const logs = join(root, '.minimax', 'v2', 'sessions', 'fixture');
    mkdirSync(logs, { recursive: true });
    writeFileSync(
      join(logs, 'messages.jsonl'),
      JSON.stringify({
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', name: 'mcp__engram__mem_search', arguments: '{}' }],
        },
      }) + '\n',
    );
    const surfaces = [surface('kimi', { rea: { command: 'node', args: ['rea.mjs', 'mcp'] } })];
    const full = buildCensus(root, root, 365, { surfaces });
    const policyOnly = buildCensus(root, root, 365, { surfaces, includeUsage: false });
    assert.deepEqual(policyOnly.drift, full.drift);
    assert.ok(full.drift.some((item) => item.server === 'engram'));
    assert.ok(full.drift.some((item) => item.server === 'rea'));
    assert.ok(full.servers.some((item) => item.server === 'engram' && item.usage.invocations > 0));
    assert.equal(policyOnly.usage.calibration, 'NOT-MEASURED');
    assert.equal(policyOnly.usage.days, 0);
    assert.equal(policyOnly.servers.find((item) => item.server === 'engram')?.usage.invocations, 0);
    assert.notEqual(full.usage.calibration, 'NOT-MEASURED');
  });
  it('normaliza la firma: el mismo binario con paths distintos es el mismo server', () => {
    assert.equal(
      signatureOf({ command: 'C:\\Users\\x\\bin\\engram.exe', args: ['mcp'] }),
      signatureOf({ command: 'engram', args: ['mcp'] }),
    );
  });

  it('el array de command de OpenCode se normaliza igual que command+args', () => {
    assert.equal(
      signatureOf({ command: 'node.exe', args: ['server.js', 'mcp'] }),
      signatureOf({ command: 'node', args: ['server.js', 'mcp'] }),
    );
  });

  it('fusiona alias: el policy name manda como canonico', () => {
    const identities = buildIdentities(
      { servers: { engram: { activation: 'always-on' } } },
      [
        {
          name: 'engram-mcp',
          command: 'engram',
          args: ['mcp', '--tools=agent'],
        } as never,
      ],
      [],
      [],
    );
    assert.equal(identities.length, 1);
    assert.equal(identities[0].canonical, 'engram');
    assert.deepEqual(identities[0].aliases, ['engram', 'engram-mcp']);
  });

  it('always-on ausente en una superficie: deriva', () => {
    const root = fixtureRoot({ engram: { activation: 'always-on' } });
    const census = buildCensus(root, root, 365, { surfaces: [surface('kimi', {})] });
    assert.equal(census.drift.length, 1);
    assert.equal(census.drift[0].server, 'engram');
    assert.equal(census.drift[0].surface, 'kimi');
  });

  it('on-demand habilitado en una superficie: deriva', () => {
    const root = fixtureRoot({ rea: { activation: 'on-demand' } });
    const census = buildCensus(root, root, 365, {
      surfaces: [surface('codex', { rea: { command: 'node', args: ['rea.mjs', 'mcp'] } })],
    });
    assert.equal(census.drift.length, 1);
    assert.match(census.drift[0].problem, /on-demand/);
  });

  it('on-demand ausente o deshabilitado: sin deriva', () => {
    const root = fixtureRoot({ rea: { activation: 'on-demand' } });
    const census = buildCensus(root, root, 365, {
      surfaces: [
        surface('codex', { rea: { command: 'node', args: ['rea.mjs', 'mcp'], enabled: false } }),
        surface('kimi', {}),
      ],
    });
    assert.equal(census.drift.length, 0);
  });

  it('un server sin politica NO es deriva (lo declaro el owner, no el stack)', () => {
    const root = fixtureRoot({ engram: { activation: 'always-on' } });
    const census = buildCensus(root, root, 365, {
      surfaces: [surface('codex', { node_repl: { command: 'node_repl.exe' } })],
    });
    assert.deepEqual(
      census.drift.filter((d) => d.server === 'node_repl'),
      [],
      'un server que el stack no declara no genera deriva',
    );
  });

  it('el override por superficie manda sobre la activacion global', () => {
    const entry = {
      activation: 'on-demand' as const,
      surfaces: { cursor: 'always-on' as const },
    };
    assert.equal(expectedActivation(entry, 'cursor'), 'always-on');
    assert.equal(expectedActivation(entry, 'repo'), 'on-demand');
  });
});

describe('activación a demanda', () => {
  it('activar deja el estado DECLARADO: no es deriva', () => {
    const root = fixtureRoot({ harness: { activation: 'on-demand' } });
    writeFileSync(
      join(root, 'config', 'mcp-registry.json'),
      JSON.stringify({
        servers: [{ name: 'harness', command: 'node', args: ['server.ts'], enabled: true }],
      }),
    );
    const repoSurface = surface('repo', {});
    // `toggleDemand` resuelve las superficies por ruta: la del repo es
    // `<root>/.mcp.json`. El fixture debe vivir ahi para que la activacion
    // lo encuentre.
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: {} }));
    const action = toggleDemand('harness', true, root, root);
    assert.equal(action.action, 'activate');
    assert.ok(action.surfaces.includes('repo'));

    const declared = readDemandState(root);
    assert.equal(declared.length, 1);
    assert.equal(declared[0].server, 'harness');
    assert.ok(declared[0].surfaces.includes('repo'));

    // Con la activacion declarada, la superficie no se reporta como deriva.
    // La superficie del repo es la MISMA ruta que el `.mcp.json` del fixture:
    // si no, el gate de superficies no inventariadas la reportaria como
    // superficie ciega (que es exactamente lo que ese gate persigue).
    const repoSurfaceOfFixture: Surface = {
      ...repoSurface,
      path: join(root, '.mcp.json'),
    };
    const census = buildCensus(root, root, 365, { surfaces: [repoSurfaceOfFixture] });
    assert.deepEqual(
      census.drift.filter((d) => d.server === 'harness'),
      [],
    );
  });

  it('desactivar limpia el estado declarado', () => {
    const root = fixtureRoot({ harness: { activation: 'on-demand' } });
    writeFileSync(
      join(root, 'config', 'mcp-registry.json'),
      JSON.stringify({
        servers: [{ name: 'harness', command: 'node', args: ['server.ts'], enabled: true }],
      }),
    );
    // La superficie del repo del fixture: sin esto la activacion no tiene
    // donde escribir y el estado declarado no se genera.
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: {} }));
    toggleDemand('harness', true, root, root);
    assert.equal(readDemandState(root).length, 1);
    toggleDemand('harness', false, root, root);
    assert.equal(readDemandState(root).length, 0);
  });

  it('la CLI de codex NO se usa sobre una superficie que no es la config real', () => {
    // Medido 2026-11-18: el test escribia `harness` en la config REAL de
    // Codex (`codex mcp add` ignora el home que le pase el stack) y dejaba el
    // server levantado en cada sesion de codex, contra la politica.
    const root = fixtureRoot({ harness: { activation: 'on-demand' } });
    const fake: Surface = {
      id: 'codex',
      label: 'Host · Codex (fixture)',
      path: join(root, '.codex', 'config.toml'),
      owner: 'host',
      format: 'codex-cli',
      supportsEnabledFlag: true,
      writable: true,
    };
    assert.equal(isRealCodexSurface(fake), false, 'una config de fixture no es la del host');
    assert.equal(
      installEntry(fake, 'harness', { command: 'node', args: ['server.ts'] }, 'stamp'),
      false,
      'no se escribe nada fuera de la config real',
    );
    assert.equal(
      removeEntry(fake, 'harness', [], 'stamp'),
      false,
      'no se borra nada fuera de la config real',
    );
  });
});

describe('deriva de comando', () => {
  const REGISTRY = [
    {
      name: 'skill-server',
      command: 'node',
      args: ['--import', 'tsx', 'scripts/mcp/skill-server.ts'],
      enabled: true,
    },
  ];

  it('comando distinto del registro en una superficie del stack: deriva', () => {
    const root = fixtureRoot(
      { 'skill-server': { activation: 'always-on', management: 'stack-managed' } },
      REGISTRY,
    );
    const census = buildCensus(root, root, 365, {
      surfaces: [
        surface('repo', {
          'skill-server': { command: 'node', args: ['dist/scripts/mcp/skill-server.js'] },
        }),
      ],
    });
    const drift = census.drift.filter((d) => d.kind === 'command');
    assert.equal(drift.length, 1);
    assert.equal(drift[0].server, 'skill-server');
    assert.match(drift[0].problem, /otro comando/);
    assert.match(drift[0].expectedCommand ?? '', /--import tsx/);
  });

  it('mismo comando que el registro: sin deriva de comando', () => {
    const root = fixtureRoot(
      { 'skill-server': { activation: 'always-on', management: 'stack-managed' } },
      REGISTRY,
    );
    const census = buildCensus(root, root, 365, {
      surfaces: [
        surface('repo', {
          'skill-server': {
            command: 'node',
            args: ['--import', 'tsx', 'scripts/mcp/skill-server.ts'],
          },
        }),
      ],
    });
    assert.deepEqual(
      census.drift.filter((d) => d.kind === 'command'),
      [],
    );
  });

  it('un server host-managed lo lanza el host como quiere: sin deriva de comando', () => {
    const root = fixtureRoot({ rea: { activation: 'on-demand', management: 'host-managed' } }, [
      { name: 'rea', command: 'rea', args: ['mcp'], enabled: true },
    ]);
    const census = buildCensus(root, root, 365, {
      surfaces: [
        surface('repo', { rea: { command: 'node', args: ['src/integrations/rea-cli.ts', 'mcp'] } }),
      ],
    });
    assert.deepEqual(
      census.drift.filter((d) => d.kind === 'command'),
      [],
      'el host declara el comando: el stack no lo imposed',
    );
  });
});

describe('contrato con el repo real', () => {
  it('la politica del repo cumple su schema', () => {
    const drift = checkPolicy(process.cwd());
    assert.deepEqual(drift.problems, [], `problemas de politica: ${drift.problems.join('; ')}`);
  });

  it('el .mcp.json canonico declara SOLO los servidores always-on de la politica', () => {
    const policy = JSON.parse(
      readFileSync(join(process.cwd(), 'config', 'mcp-lifecycle-policy.json'), 'utf-8'),
    ) as { servers: Record<string, { activation?: string; surfaces?: Record<string, string> }> };
    const canonical = JSON.parse(readFileSync(join(process.cwd(), '.mcp.json'), 'utf-8')) as {
      mcpServers: Record<string, unknown>;
    };
    const expected = Object.entries(policy.servers)
      .filter(([, entry]) => {
        const perSurface = entry.surfaces?.repo ?? entry.activation;
        return perSurface === 'always-on';
      })
      .map(([name]) => name);
    assert.deepEqual(
      Object.keys(canonical.mcpServers).sort(),
      expected.sort(),
      'el .mcp.json canonico debe coincidir con la politica: los on-demand se activan con npm run mcp:on-demand',
    );
  });
});
