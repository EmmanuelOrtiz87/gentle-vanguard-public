import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import WebSocket from 'ws';

const SERVER = fileURLToPath(
  new URL('../server/websocket-server.ts', import.meta.url),
);
const TOKEN = 'dashboard-e2e-token';

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

function waitForStartup(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('[WS] Server on port')) {
        child.stdout?.off('data', onData);
        resolve();
      }
    };
    child.stdout?.on('data', onData);
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`dashboard server exited (${code}): ${output}`)));
  });
}

function closeWebSocket(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
  ws.close();
  return new Promise((resolve) => ws.once('close', () => resolve()));
}

describe('Dashboard security E2E', () => {
  let child: ChildProcess;
  let baseUrl: string;
  let wsUrl: string;
  let cookie: string;
  let csrfToken: string;
  let dbDir: string;

  before(async () => {
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}`;
    // Isolated DB so tests can manipulate principals directly without
    // touching the operational database.
    dbDir = await mkdtemp(join(tmpdir(), 'gv-dashboard-e2e-'));
    child = spawn(process.execPath, ['--import', 'tsx', SERVER], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WS_PORT: String(port),
        GV_DASHBOARD_TOKEN: TOKEN,
        GV_DASHBOARD_DEV_AUTH: '',
        GENTLE_TENANT_ID: 'gentle-vanguard',
        GENTLE_VANGUARD_DB_DIR: dbDir,
        NODE_ENV: 'production',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    await waitForStartup(child);
  });

  after(async () => {
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
  });

  it('requires authentication for protected HTTP routes and supports session login/logout', async () => {
    const denied = await fetch(`${baseUrl}/api/metrics`);
    assert.equal(denied.status, 401);

    const invalid = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'wrong' }),
    });
    assert.equal(invalid.status, 401);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get('set-cookie');
    assert.ok(setCookie);
    cookie = setCookie.match(/gv_dashboard_session=[^;]+/)?.[0] || '';
    assert.ok(cookie);
    csrfToken = setCookie.match(/gv_dashboard_csrf=([^;]+)/)?.[1] || '';
    assert.ok(csrfToken, 'login must issue a CSRF cookie');

    const allowed = await fetch(`${baseUrl}/api/metrics`, { headers: { cookie } });
    assert.equal(allowed.status, 200);

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie },
    });
    assert.equal(logout.status, 200);
    const deniedAfterLogout = await fetch(`${baseUrl}/api/metrics`, { headers: { cookie } });
    assert.equal(deniedAfterLogout.status, 401);
  });

  it('rejects unauthenticated and query-token WebSocket handshakes', async () => {
    for (const url of [wsUrl, `${wsUrl}/?token=${encodeURIComponent(TOKEN)}`]) {
      const ws = new WebSocket(url);
      const status = await new Promise<number>((resolve, reject) => {
        ws.once('unexpected-response', (_request, response) => resolve(response.statusCode));
        ws.once('error', (error) => {
          if (!String(error.message).includes('Unexpected server response')) reject(error);
        });
      });
      assert.equal(status, 401);
      await closeWebSocket(ws);
    }
  });

  it('accepts a session cookie during the WebSocket handshake', async () => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    });
    cookie = login.headers.get('set-cookie')?.match(/gv_dashboard_session=[^;]+/)?.[0] || '';
    assert.ok(cookie);

    const ws = new WebSocket(wsUrl, { headers: { Cookie: cookie } });
    await once(ws, 'open');
    const [raw] = await once(ws, 'message');
    const message = JSON.parse(raw.toString());
    assert.equal(message.type, 'metrics');
    await closeWebSocket(ws);
  });

  it('rejects a tenant selector that differs from the deployment tenant', async () => {
    const response = await fetch(`${baseUrl}/api/metrics?tenantId=other-tenant`, {
      headers: { cookie },
    });
    assert.equal(response.status, 400);
  });

  it('binds a principal on login and enforces RBAC + CSRF on admin endpoints', async () => {
    // Fresh isolated DB: first login bootstraps an admin principal.
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get('set-cookie') || '';
    const sessionCookie = setCookie.match(/gv_dashboard_session=[^;]+/)?.[0] || '';
    const csrf = setCookie.match(/gv_dashboard_csrf=([^;]+)/)?.[1] || '';
    assert.ok(sessionCookie && csrf);
    const principalBody = (await login.json()) as {
      principal?: { id: string; subject: string; role: string };
    };
    assert.equal(principalBody.principal?.role, 'admin');
    const ownPrincipalId = principalBody.principal!.id;
    // Double-submit: mutations must carry BOTH the session and CSRF cookies
    // plus the matching X-GV-CSRF header.
    const doubleSubmitCookie = `${sessionCookie}; gv_dashboard_csrf=${csrf}`;
    const authHeaders = { cookie: doubleSubmitCookie, 'x-gv-csrf': csrf };

    // Mutations without the CSRF header are rejected.
    const noCsrf = await fetch(`${baseUrl}/api/admin/principals`, {
      method: 'POST',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ subject: 'e2e-viewer', role: 'viewer' }),
    });
    assert.equal(noCsrf.status, 403);

    // With CSRF, an admin can create principals.
    const created = await fetch(`${baseUrl}/api/admin/principals`, {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ subject: 'e2e-viewer', displayName: 'E2E Viewer', role: 'viewer' }),
    });
    assert.equal(created.status, 201);
    const createdBody = (await created.json()) as { principal?: { id: string } };
    assert.ok(createdBody.principal?.id);

    // Listing works for admins (no CSRF needed on reads).
    const list = await fetch(`${baseUrl}/api/admin/principals`, {
      headers: { cookie: sessionCookie },
    });
    assert.equal(list.status, 200);
    const listBody = (await list.json()) as { principals?: Array<{ subject: string }> };
    const subjects = listBody.principals?.map((p) => p.subject) ?? [];
    assert.ok(subjects.includes('dashboard-operator'));
    assert.ok(subjects.includes('e2e-viewer'));

    // Self role changes are blocked to avoid lockouts.
    const selfPatch = await fetch(`${baseUrl}/api/admin/principals/${ownPrincipalId}/role`, {
      method: 'PATCH',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'viewer' }),
    });
    assert.equal(selfPatch.status, 409);

    // Admin can change other principals' roles.
    const patchOther = await fetch(
      `${baseUrl}/api/admin/principals/${createdBody.principal!.id}/role`,
      {
        method: 'PATCH',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'operator' }),
      },
    );
    assert.equal(patchOther.status, 200);

    // Downgrade own principal directly in the isolated DB: mutations now
    // require operator and are denied, reads keep working.
    const db = new Database(join(dbDir, 'gentle-vanguard.db'));
    db.prepare(
      "UPDATE memberships SET role = 'viewer' WHERE principal_id = ? AND tenant_id = 'gentle-vanguard'",
    ).run(ownPrincipalId);
    db.close();

    const deniedMutation = await fetch(`${baseUrl}/api/mesh/discover`, {
      method: 'POST',
      headers: { cookie: sessionCookie },
    });
    assert.equal(deniedMutation.status, 403);
    const allowedRead = await fetch(`${baseUrl}/api/metrics`, {
      headers: { cookie: sessionCookie },
    });
    assert.equal(allowedRead.status, 200);

    // Restore admin directly: admin endpoints work again.
    const dbRestore = new Database(join(dbDir, 'gentle-vanguard.db'));
    dbRestore
      .prepare(
        "UPDATE memberships SET role = 'admin' WHERE principal_id = ? AND tenant_id = 'gentle-vanguard'",
      )
      .run(ownPrincipalId);
    dbRestore.close();
    const restored = await fetch(
      `${baseUrl}/api/admin/principals/${createdBody.principal!.id}/revoke-sessions`,
      { method: 'POST', headers: authHeaders },
    );
    assert.equal(restored.status, 200);
  });
});
