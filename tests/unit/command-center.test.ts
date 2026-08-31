import { afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  APPS_REGISTRY,
  createAppsController,
  createCommandCenterServer,
} from '../../apps/command-center/server.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function testRoot(): string {
  const root = join(tmpdir(), `gv-command-center-${Date.now()}-${Math.random()}`);
  mkdirSync(join(root, '.runtime'), { recursive: true });
  roots.push(root);
  return root;
}
function fakeSpawn() {
  return { pid: 12345, unref: () => undefined } as never;
}

describe('Command Center app controller', () => {
  it('exposes the five normal managed apps', () =>
    expect(APPS_REGISTRY.map((app) => app.id)).toEqual([
      'dashboard',
      'analytics',
      'cms',
      'academy',
      'prompts',
    ]));
  it('does not spawn when an app is already running', async () => {
    const root = testRoot();
    writeFileSync(join(root, '.runtime', 'app-academy-http.pid'), String(process.pid));
    const spawn = (() => {
      throw new Error('must not spawn');
    }) as never;
    const controller = createAppsController({ root, probe: async () => true, spawn });
    const result = await controller.start('academy');
    expect(result.status).toBe(200);
  });
  it('starts and stops a stopped app', async () => {
    const root = testRoot();
    let calls = 0;
    let probes = 0;
    const spawn = (() => {
      calls++;
      return fakeSpawn();
    }) as never;
    const controller = createAppsController({ root, probe: async () => ++probes > 1, spawn });
    await controller.start('academy');
    expect(calls).toBe(1);
    expect((await controller.stop('academy')).status).toBe(200);
  });
  it('uses a live legacy dashboard pidfile and trusts the port when that pid is stale', async () => {
    const root = testRoot();
    const legacy = join(root, '.runtime', 'dashboard-ws.pid');
    writeFileSync(legacy, '999999');
    const controller = createAppsController({ root, probe: async () => true });
    const dashboard = (await controller.list()).find((app) => app.id === 'dashboard');
    expect(dashboard?.processes[0]).toMatchObject({ alive: true, pid: null });
    expect(existsSync(legacy)).toBe(true);
  });
});

function requestServer(
  server: ReturnType<typeof createCommandCenterServer>,
  path: string,
  method = 'GET',
  origin?: string,
) {
  return new Promise<{
    status: number | undefined;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }>((resolve, reject) => {
    const address = server.address();
    if (!address || typeof address === 'string')
      return reject(new Error('server is not listening'));
    const req = request(
      {
        host: '127.0.0.1',
        port: address.port,
        path,
        method,
        headers: origin ? { Origin: origin } : undefined,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('Command Center HTTP API', () => {
  it('runs presets sequentially and skips apps already in the target state', async () => {
    const statuses = new Map([
      ['dashboard', 'running'],
      ['analytics', 'stopped'],
      ['cms', 'partial'],
      ['academy', 'stopped'],
      ['prompts', 'running'],
    ]);
    const calls: string[] = [];
    const controller = {
      list: async () =>
        [...statuses].map(([id, status]) => ({
          id,
          name: id,
          description: '',
          status,
          url: '',
          processes: [],
        })),
      start: async (id: string) => {
        calls.push(`start:${id}`);
        statuses.set(id, 'running');
        return { status: 200, body: { id, status: 'running' } };
      },
      stop: async (id: string) => {
        calls.push(`stop:${id}`);
        statuses.set(id, 'stopped');
        return { status: 200, body: { id, status: 'stopped' } };
      },
    } as never;
    const server = createCommandCenterServer(controller);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const started = await requestServer(server, '/api/presets/start-all', 'POST');
      expect(JSON.parse(started.body).results).toEqual([
        { id: 'dashboard', status: 'running' },
        { id: 'analytics', status: 'running' },
        { id: 'cms', status: 'running' },
        { id: 'academy', status: 'running' },
        { id: 'prompts', status: 'running' },
      ]);
      expect(calls).toEqual(['start:analytics', 'start:cms', 'start:academy']);
      calls.length = 0;
      const stopped = await requestServer(server, '/api/presets/stop-all', 'POST');
      expect(
        JSON.parse(stopped.body).results.every(
          (result: { status: string }) => result.status === 'stopped',
        ),
      ).toBe(true);
      expect(calls).toEqual([
        'stop:dashboard',
        'stop:analytics',
        'stop:cms',
        'stop:academy',
        'stop:prompts',
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('reflects only loopback origins and supports preflight', async () => {
    const controller = { list: async () => [] } as never;
    const server = createCommandCenterServer(controller);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const loopback = await requestServer(server, '/api/apps', 'GET', 'http://localhost:5173');
      expect(loopback.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      const external = await requestServer(server, '/api/apps', 'GET', 'https://evil.example');
      expect(external.headers['access-control-allow-origin']).toBeUndefined();
      const options = await requestServer(server, '/api/apps', 'OPTIONS', 'http://127.0.0.1:5173');
      expect(options.status).toBe(204);
      expect(options.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
      expect(options.headers['access-control-allow-methods']).toBe('GET, POST, OPTIONS');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
