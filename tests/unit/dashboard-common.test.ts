import test from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, readFileSync } from 'node:fs';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { isDashboardHtml } from '../../src/ops/dashboard-common.js';
import { openDashboardServerStderr } from '../../src/ops/dashboard-common.js';

test('dashboard HTML detection accepts the GV dashboard shell', () => {
  assert.equal(
    isDashboardHtml(
      '<html><head><title>GentleVanguard Dashboard</title></head><body><div id="root"></div></body></html>',
    ),
    true,
  );
});

test('dashboard HTML detection rejects unrelated local web apps', () => {
  assert.equal(
    isDashboardHtml(
      '<html><head><title>GentleVanguard Analytics</title></head><body><div id="root"></div></body></html>',
    ),
    false,
  );
});

test('dashboard API and websocket proxies target the IPv4 loopback WS listener', () => {
  const viteConfig = readFileSync('apps/web-dashboard/vite.config.ts', 'utf8');

  assert.equal(
    (viteConfig.match(/target: `http:\/\/127\.0\.0\.1:\$\{WS_PORT\}`/g) ?? []).length,
    2,
  );
  assert.doesNotMatch(viteConfig, /target: `http:\/\/localhost:\$\{WS_PORT\}`/);
});

test('dashboard server stderr remains available after its detached launcher exits', async () => {
  const marker = `dashboard-server-error-${Date.now()}`;
  const stderrFd = openDashboardServerStderr();
  let child;
  try {
    child = spawn(process.execPath, ['-e', `process.stderr.write(${JSON.stringify(marker)})`], {
      stdio: ['ignore', 'ignore', stderrFd],
      windowsHide: true,
    });
  } finally {
    closeSync(stderrFd);
  }

  await once(child, 'close');
  assert.ok(readFileSync('.runtime/dashboard-ws-server.stderr.log', 'utf8').includes(marker));
});
