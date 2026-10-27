import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runtimeConformance } from '../../packages/gv-design-system/src/cli/runtime-conformance.ts';

test('runtime conformance rejects theme overrides even when canonical CSS is loaded', async () => {
  const tokens = readFileSync('packages/gv-design-system/dist/tokens.css', 'utf8');
  const fonts = readFileSync('assets/gv-fonts.css', 'utf8');
  const shell = readFileSync('packages/gv-design-system/src/shell/shell.css', 'utf8');
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/fonts/')) {
      response.setHeader('Content-Type', 'font/woff2');
      response.end(readFileSync(resolve('assets', request.url.slice(1))));
      return;
    }
    const drift = request.url === '/drift' ? ':root[data-theme=light]{--gv-cyan:#0891b2}' : '';
    const publicName = request.url === '/name-drift' ? 'Gentle Vanguard' : 'GentleVanguard';
    const footerDrift = request.url === '/footer-drift' ? '.gv-footer a{color:var(--gv-purple-soft)}' : '';
    response.setHeader('Content-Type', 'text/html');
    response.end(`<html><head><style>${shell}${tokens}${fonts}${drift}body{font-family:Inter;background:var(--gv-bg)}h1{font-family:Poppins}.gv-brand-logo{width:32px;height:32px}${footerDrift}</style></head><body><header class="gv-topbar"><span class="gv-brand-wordmark">Gentle<span>Vanguard</span></span><svg class="gv-brand-logo"></svg></header><h1>Test</h1><p>${publicName}</p><footer class="gv-footer"><a href="#">Contact</a></footer></body></html>`);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const url = `http://127.0.0.1:${address.port}`;
    await assert.rejects(runtimeConformance(`${url}/drift`), /light --gv-cyan/);
    await assert.rejects(runtimeConformance(`${url}/name-drift`), /public name must be GentleVanguard/);
    await assert.rejects(runtimeConformance(`${url}/footer-drift`), /light: footer contrast/);
    await runtimeConformance(`${url}/canonical`);
  } finally { await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); }
});
