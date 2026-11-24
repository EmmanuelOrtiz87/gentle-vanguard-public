import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { resolveRemoteOAuthToken } from '../../src/mcp/mcp-inventory.js';
import { callServer } from '../../src/tools/mcp-call.js';

function fixture(serverUrl: string, expiresAt = Date.now() / 1000 + 3600) {
  const home = mkdtempSync(join(tmpdir(), 'gv-oauth-'));
  const dir = join(home, '.local', 'share', 'opencode');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'mcp-auth.json');
  writeFileSync(
    path,
    JSON.stringify({
      fixture: {
        serverUrl,
        tokens: { accessToken: 'fixture-token', expiresAt },
      },
    }),
  );
  return { home, path, clean: () => rmSync(home, { recursive: true, force: true }) };
}

test('OAuth no entrega ni refresca credenciales para otro endpoint', async () => {
  const f = fixture('https://original.example/mcp');
  try {
    const before = readFileSync(f.path, 'utf8');
    assert.equal(
      await resolveRemoteOAuthToken('fixture', {
        home: f.home,
        serverUrl: 'https://original.example/mcp',
      }),
      'fixture-token',
    );
    assert.equal(
      await resolveRemoteOAuthToken('fixture', {
        home: f.home,
        serverUrl: 'https://otro.example/mcp',
      }),
      undefined,
    );
    assert.equal(
      await resolveRemoteOAuthToken('fixture', {
        home: f.home,
        serverUrl: 'https://original.example/otro',
      }),
      undefined,
    );
    assert.equal(readFileSync(f.path, 'utf8'), before);
  } finally {
    f.clean();
  }
});

test('OAuth ausente o vencido sin refresh no se presenta como vigente', async () => {
  const f = fixture('https://original.example/mcp', 1);
  try {
    assert.equal(await resolveRemoteOAuthToken('fixture', { home: f.home }), undefined);
    assert.equal(await resolveRemoteOAuthToken('ausente', { home: f.home }), undefined);
  } finally {
    f.clean();
  }
});

test('un endpoint distinto no inicia refresh ni modifica el almacén', async (t) => {
  const f = fixture('https://original.example/mcp', 1);
  try {
    const entry = JSON.parse(readFileSync(f.path, 'utf8'));
    entry.fixture.tokens.refreshToken = 'fixture-refresh';
    writeFileSync(f.path, JSON.stringify(entry));
    const before = readFileSync(f.path, 'utf8');
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('No debe consultar discovery para otro endpoint');
    });
    assert.equal(
      await resolveRemoteOAuthToken('fixture', {
        home: f.home,
        serverUrl: 'https://otro.example/mcp',
      }),
      undefined,
    );
    assert.equal(fetchMock.mock.callCount(), 0);
    assert.equal(readFileSync(f.path, 'utf8'), before);
  } finally {
    f.clean();
  }
});

test('el puente autentica handshake, lista y tool sin copiar ni loguear el token', async () => {
  const methods: string[] = [];
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer fixture-token') {
      res.writeHead(401).end();
      return;
    }
    if (req.method === 'GET') {
      res.writeHead(405).end();
      return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    methods.push(body.method);
    if (body.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    const result =
      body.method === 'initialize'
        ? {
            protocolVersion: body.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'fixture', version: '1' },
          }
        : body.method === 'tools/list'
          ? { tools: [{ name: 'search_documentation', inputSchema: { type: 'object' } }] }
          : { content: [{ type: 'text', text: 'documentación oficial de fixture' }] };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/mcp`;
  const f = fixture(url);
  try {
    const before = readFileSync(f.path, 'utf8');
    const outcome = await callServer(
      { name: 'fixture', command: '', args: [], source: 'registro', transport: 'http', url },
      {
        tool: 'search_documentation',
        args: { term: 'webhooks' },
        oauthHome: f.home,
      },
    );
    assert.equal(outcome.ok, true, outcome.error);
    assert.equal(outcome.tools, undefined);
    assert.deepEqual(outcome.content, [{ type: 'text', text: 'documentación oficial de fixture' }]);
    assert.ok(methods.includes('initialize'));
    assert.ok(methods.includes('tools/list'));
    assert.ok(methods.includes('tools/call'));
    assert.equal(JSON.stringify(outcome).includes('fixture-token'), false);
    assert.equal(readFileSync(f.path, 'utf8'), before);
  } finally {
    f.clean();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
