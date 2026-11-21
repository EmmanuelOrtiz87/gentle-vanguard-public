/**
 * Smoke e2e de academy-landing (campaña P3, meta-auditoría 2026-11-20).
 *
 * Contrato del smoke mínimo: server REAL (tools/serve-static.mjs del stack)
 * en puerto efímero, assertions sobre el contenido servido, cleanup en finally.
 * Nivel: HTTP real — index con estructura canon y los insumos de datos
 * (catalog.json) y estilos canon que la landing consume en el cliente.
 * La integración con el sitio público (/academy/ en corporate-web) se verifica
 * en el smoke de corporate-web y en el ciclo de publicación (prepare-pages).
 *
 * Uso: npm run test:smoke  (desde apps/academy-landing)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = dirname(HERE);
const REPO_ROOT = resolve(APP_ROOT, '..', '..');
const BOOT_TIMEOUT_MS = 20_000;

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => (probe.listening ? reject(new Error('probe still open')) : resolve(port)));
    });
    probe.on('error', reject);
  });
}

test('academy-landing: server real sirve index, catalogo y estilos canon', async () => {
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [join('tools', 'serve-static.mjs'), String(port), join('apps', 'academy-landing'), '--no-store'],
    { cwd: REPO_ROOT, stdio: 'ignore', windowsHide: true },
  );
  const base = `http://127.0.0.1:${port}`;
  try {
    // 1. Boot: el index responde antes del timeout.
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    let page = null;
    let lastError = null;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break;
      try {
        const res = await fetch(base);
        if (res.ok) {
          page = res;
          break;
        }
      } catch (e) {
        lastError = e;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(page, `server no arrancó en ${BOOT_TIMEOUT_MS}ms (último error: ${lastError})`);
    const html = await page.text();

    // 2. Estructura canon: título de Academy y estilos canon declarados.
    assert.match(html, /<title>GentleVanguard Academy/);
    assert.match(html, /academy\.css/);

    // 3. Insumos reales: catalog.json (datos del catálogo) y estilos canon.
    const catalog = await fetch(new URL('catalog.json', base));
    assert.equal(catalog.status, 200, 'catalog.json no se sirve');
    const parsed = await catalog.json();
    assert.ok(parsed && typeof parsed === 'object', 'catalog.json no parsea a objeto');
    for (const asset of ['gv-fonts.css', 'gv-tokens.css', 'academy.css']) {
      const res = await fetch(new URL(asset, base));
      assert.equal(res.status, 200, `asset ${asset} no se sirve`);
    }
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});
