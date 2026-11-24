import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:8080';
const WS_URL = process.env.WS_URL || 'ws://localhost:8080';

describe('Dashboard API Health', () => {
  it('GET /api/health returns 200 with status ok', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(typeof body.uptime, 'number');
  });

  it('GET /api/metrics returns valid metrics structure', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.type, 'metrics');
    assert.ok(body.data);
    assert.ok(body.data.timestamp);
    assert.ok(body.data.tokens);
    assert.ok(body.data.sessions);
    assert.ok(body.data.git);
    assert.ok(body.data.health);
    assert.ok(body.data.mcp);
  });

  it('GET /api/agent/tools returns tools array', async () => {
    const res = await fetch(`${BASE_URL}/api/agent/tools`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.tools));
    assert.equal(typeof body.connected, 'boolean');
  });

  it('GET /api/agent/sessions returns sessions list', async () => {
    const res = await fetch(`${BASE_URL}/api/agent/sessions`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.sessions));
  });

  it('GET /api/state/events returns events array', async () => {
    const res = await fetch(`${BASE_URL}/api/state/events`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.events));
  });

  it('GET /api/state/tasks returns tasks array', async () => {
    const res = await fetch(`${BASE_URL}/api/state/tasks`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.tasks));
  });

  it('GET /api/health/global returns global health data', async () => {
    const res = await fetch(`${BASE_URL}/api/health/global`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.repositories);
    assert.ok(Array.isArray(body.repositories));
    assert.ok(body.overallStatus);
    assert.equal(typeof body.totalRepos, 'number');
  });

  it('GET /api/marketplace returns marketplace listings', async () => {
    const res = await fetch(`${BASE_URL}/api/marketplace`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.success);
    assert.ok(Array.isArray(body.data));
    assert.equal(typeof body.total, 'number');
  });
});

describe('CORS Headers', () => {
  it('returns CORS headers on GET requests', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });

  it('returns CORS headers on OPTIONS preflight', async () => {
    const res = await fetch(`${BASE_URL}/api/health`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.ok(res.headers.get('access-control-allow-methods').includes('GET'));
  });
});

describe('WebSocket Connection', () => {
  let ws;

  before(() => {
    ws = new WebSocket(WS_URL);
    return new Promise((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('WebSocket connection failed'));
      setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
    });
  });

  after(() => {
    ws.close();
  });

  it('receives initial metrics message on connect', async () => {
    const msg = await new Promise((resolve, reject) => {
      ws.onmessage = (event) => resolve(event.data);
      setTimeout(() => reject(new Error('Timeout waiting for message')), 5000);
    });
    const parsed = JSON.parse(msg);
    assert.ok(parsed.type);
    assert.ok(parsed.data);
  });

  it('responds to ping with pong', async () => {
    ws.send(JSON.stringify({ type: 'ping' }));
    const msg = await new Promise((resolve, reject) => {
      ws.onmessage = (event) => resolve(event.data);
      setTimeout(() => reject(new Error('Timeout waiting for pong')), 5000);
    });
    const parsed = JSON.parse(msg);
    assert.equal(parsed.type, 'pong');
  });

  it('can create an agent session via WebSocket', async () => {
    ws.send(JSON.stringify({ type: 'agent', action: 'create_session', agent: 'test' }));
    const msg = await new Promise((resolve, reject) => {
      ws.onmessage = (event) => {
        const parsed = JSON.parse(event.data);
        if (parsed.type === 'agent_session_created') resolve(event.data);
      };
      setTimeout(() => reject(new Error('Timeout waiting for session creation')), 5000);
    });
    const parsed = JSON.parse(msg);
    assert.equal(parsed.type, 'agent_session_created');
    assert.ok(parsed.session.id);
    assert.equal(parsed.session.agent, 'test');
  });
});

describe('Error Handling', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await fetch(`${BASE_URL}/api/nonexistent`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Not found');
  });

  it('returns 400 for malformed JSON on POST endpoints', async () => {
    const res = await fetch(`${BASE_URL}/api/state/emit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);
  });
});
