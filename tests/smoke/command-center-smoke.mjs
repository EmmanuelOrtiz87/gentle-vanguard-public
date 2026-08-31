import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';

const port = 18090;
const pidFile = '.runtime/command-center-smoke.pid';
const child = spawn(process.execPath, ['--import', 'tsx', 'apps/command-center/server.ts'], {
  env: {
    ...process.env,
    CC_PORT: String(port),
    // Isolated pidfile — never touch the production command-center.pid.
    CC_PID_FILE: pidFile,
  },
  stdio: 'ignore',
  windowsHide: true,
});
const get = (path, method = 'GET', headers = {}) =>
  new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method, headers, timeout: 120000 },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          let parsed = body;
          try {
            parsed = JSON.parse(body);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
try {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await get('/api/health')).status === 200) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const apps = await get('/api/apps');
  assert.equal(apps.status, 200);
  // Presence check, not exact equality: parallel sessions keep registering
  // new apps (e.g. prompts) — the smoke only guarantees the core four exist.
  const ids = apps.body.map((app) => app.id);
  for (const core of ['dashboard', 'analytics', 'cms', 'academy']) {
    assert.ok(ids.includes(core), `registry missing core app: ${core}`);
  }
  const academyWasRunning = apps.body.find((app) => app.id === 'academy').status === 'running';
  const start = await get('/api/apps/academy/start', 'POST');
  assert.equal(start.status, 200);
  assert.equal(start.body.status, 'running');
  const repeat = await get('/api/apps/academy/start', 'POST');
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.status, 'running');
  if (!academyWasRunning) {
    const stop = await get('/api/apps/academy/stop', 'POST');
    assert.equal(stop.status, 200);
    assert.equal(stop.body.status, 'stopped');
  }
  const dashboard = await get('/api/apps/dashboard/start', 'POST');
  assert.equal(dashboard.status, 200);
  assert.notEqual(dashboard.status, 409);
  const widget = await get('/widget.js');
  assert.equal(widget.status, 200);
  assert.match(widget.headers['content-type'], /^text\/javascript; charset=utf-8$/);
  assert.match(widget.body, /data-app/);
  const options = await get('/api/apps', 'OPTIONS', { Origin: 'http://127.0.0.1:5173' });
  assert.equal(options.status, 204);
  assert.equal(options.headers['access-control-allow-origin'], 'http://127.0.0.1:5173');
  const preset = await get('/api/presets/start-all', 'POST');
  assert.equal(preset.status, 200);
  assert.ok(Array.isArray(preset.body.results));
  console.log('command-center smoke: PASS');
} finally {
  child.kill('SIGTERM');
}
