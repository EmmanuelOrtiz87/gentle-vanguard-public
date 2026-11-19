/**
 * mcp-call.test.ts — el puente que usa los MCP a demanda sin precargarlos.
 *
 * Los tres invariantes que protects:
 *  1. el comando sale del registro canonico (el stack no inventa comandos);
 *  2. la politica manda: si dice `disabled-by-policy`, el puente se niega;
 *  3. la llamada queda registrada en un formato que el MISMO detector de
 *     invocaciones reconoce -> el uso desde el puente no es un cero falso.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  policyRefusal,
  readCanonServers,
  readRegistryServers,
  recordCall,
  resolveServer,
} from '../../src/tools/mcp-call.js';
import { extractInvocations } from '../../src/tools/mcp-invocation-detector.js';

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-call-'));
  mkdirSync(join(dir, 'config'), { recursive: true });
  return dir;
}

describe('puente MCP a demanda', () => {
  it('resuelve el comando canonico del registro', () => {
    const spec = resolveServer('rea');
    assert.ok(spec, 'rea debe estar en el registro');
    assert.equal(spec.source, 'registro');
    assert.ok(spec.command.length > 0);
    assert.ok(spec.args.length > 0);
  });

  it('resuelve tambien lo declarado en el canon del repo', () => {
    const canon = readCanonServers();
    assert.ok(canon.length > 0, 'el canon .mcp.json declara servidores');
    const spec = resolveServer(canon[0].name);
    assert.ok(spec, 'debe resolverse el servidor del canon');
  });

  it('no inventa comandos para un servidor desconocido', () => {
    assert.equal(resolveServer('no-existe-este-servidor'), undefined);
  });

  it('el registro es la fuente de verdad y no el canon', () => {
    const registry = readRegistryServers();
    assert.ok(registry.length >= 10, 'el registro canonico tiene los servidores del stack');
    // Invariante (no valor): todo servidor del registro tiene una VIA de
    // invocacion. Un stdio se lanza por comando; un remoto se llama por url.
    // "Todo tiene command" era una forma de congelar el estado previo, cuando
    // todavia no habia MCPs remotos en el stack.
    for (const server of registry) {
      const hasWay = server.transport === 'http' ? Boolean(server.url) : server.command.length > 0;
      assert.ok(hasWay, `${server.name} no declara como invocarse`);
    }
  });

  it('la politica puede vetar el acceso (disabled-by-policy)', () => {
    const root = tempRoot();
    try {
      writeFileSync(
        join(root, 'config', 'mcp-lifecycle-policy.json'),
        JSON.stringify({
          servers: { rea: { activation: 'disabled-by-policy', management: 'host-managed' } },
        }),
      );
      const refusal = policyRefusal('rea', root);
      assert.ok(refusal, 'debe negarse con el motivo');
      assert.match(refusal, /politica/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('sin veto de politica no hay negativa', () => {
    const root = tempRoot();
    try {
      writeFileSync(
        join(root, 'config', 'mcp-lifecycle-policy.json'),
        JSON.stringify({
          servers: { rea: { activation: 'on-demand', management: 'host-managed' } },
        }),
      );
      assert.equal(policyRefusal('rea', root), undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('la llamada queda en un formato que el detector de invocaciones reconoce', () => {
    const root = tempRoot();
    try {
      const log = join(root, 'mcp-calls.jsonl');
      recordCall(
        {
          at: new Date().toISOString(),
          tool: 'mcp__rea__rea_files',
          server: 'rea',
          ms: 12,
          isError: false,
          ok: true,
        },
        log,
      );
      assert.ok(existsSync(log));
      const line = readFileSync(log, 'utf-8').trim();
      const hits = extractInvocations(line);
      assert.equal(hits.length, 1, 'el detector debe ver UNA invocacion');
      assert.equal(hits[0].tool, 'mcp__rea__rea_files');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('un MCP remoto se resuelve por url, no por comando', () => {
    const spec = resolveServer('mercadopago');
    assert.ok(spec, 'mercadopago debe estar en el registro');
    assert.equal(spec.transport, 'http');
    assert.match(spec.url ?? '', /^https:\/\//);
  });

  it('todo servidor de la politica es alcanzable por el puente', () => {
    // El gap medido 2026-11-18: filesystem, chrome-devtools, memory, browse y
    // mercadopago estaban en la POLITICA pero NO en el registro -> el puente
    // respondia "no hay entrada canonica" y la capacidad era inalcanzable.
    const policy = JSON.parse(
      readFileSync(join(process.cwd(), 'config', 'mcp-lifecycle-policy.json'), 'utf-8'),
    ) as { servers: Record<string, { activation?: string }> };
    const unreachable: string[] = [];
    for (const [server, entry] of Object.entries(policy.servers)) {
      if (entry.activation === 'disabled-by-policy') continue;
      if (!resolveServer(server)) unreachable.push(server);
    }
    assert.deepEqual(unreachable, [], `capacidades inalcanzables: ${unreachable.join(', ')}`);
  });
});
