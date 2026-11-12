/**
 * Checkout de la landing: la pestaña de pago NO puede depender de un popup.
 *
 * POR QUE UN TEST Y NO UN SMOKE MANUAL
 * ------------------------------------
 * El bug real fue: `window.open(pref.initPoint)` DESPUÉS de un `await`. El
 * navegador lo bloquea como popup y el cliente hace clic en "Comprar curso" y
 * no pasa nada. Es un fallo invisible en el código (el flujo "funciona" en
 * cualquier test que no mime un bloqueo de popups) y en produccion es una
 * venta perdida.
 *
 * Este test mira las TRES partes del arreglo:
 *   1. ESTATICO: la pestaña se abre ANTES del await (si se abre después, el
 *      navegador la bloquea) y el patrón viejo `window.open(pref.initPoint)`
 *      no existe en el código publicado.
 *   2. E2E con popup permitido: la pestaña abierta es la que aterriza en el
 *      checkout, no una pestaña nueva con la landing.
 *   3. E2E con popup bloqueado (`window.open` → null): el checkout se abre en
 *      la MISMA pestaña. Un arreglo que sólo funciona "con popup" deja al
 *      cliente sin checkout cuando el navegador decide bloquear.
 *
 * El bridge es un MOCK local: el test no toca MercadoPago ni genera
 * preferencias reales. Lo que se verifica es el flujo de la landing.
 *
 * Run: node --import tsx --test apps/academy-landing/scripts/checkout-popup.test.ts
 */
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

const LANDING = resolve(process.cwd(), 'apps/academy-landing/index.html');
const HTML = readFileSync(LANDING, 'utf8');

/** Revisión del catálogo que la landing exige al bridge (si no, aborta el pago). */
const REVISION = /status\.catalogRevision !== "([0-9a-f]+)"/.exec(HTML)?.[1];

/** Corta `function name(...) { ... }` contando llaves (mismo patrón que external-reference.test.ts). */
function extractFn(src: string, name: string): string {
  let start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`no encontre ${name} en la landing`);
  if (src.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  const braceStart = src.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`llaves sin cerrar en ${name}`);
}

/** Servidor único: bridge mock (health + preference) y página de checkout. */
function startMockBridge(): Promise<{ url: string; close: () => void; preferences: () => number }> {
  let preferences = 0;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const cors = {
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-bridge-secret',
      'Content-Type': 'application/json',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    if (url.pathname === '/api/mp/health') {
      res.writeHead(200, cors);
      res.end(JSON.stringify({ ok: true, hasToken: true, hasPublicKey: true, catalogRevision: REVISION }));
      return;
    }
    if (url.pathname === '/api/mp/preference') {
      preferences += 1;
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const port = (server.address() as { port: number }).port;
        const prefId = `mock-pref-${preferences}`;
        res.writeHead(200, cors);
        res.end(
          JSON.stringify({
            ok: true,
            preferenceId: prefId,
            initPoint: `http://127.0.0.1:${port}/mock-checkout?pref_id=${prefId}`,
          }),
        );
      });
      return;
    }
    if (url.pathname === '/mock-checkout') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>Checkout mock</title><h1>Checkout mock</h1>');
      return;
    }
    res.writeHead(404, cors);
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolvePromise({
        url: `http://127.0.0.1:${port}`,
        close: () => server.close(),
        preferences: () => preferences,
      });
    });
  });
}

/** Sirve la landing parcheada (bridge -> mock) desde un directorio temporal. */
function startLandingServer(bridgeUrl: string): Promise<{ url: string; close: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), 'gv-landing-'));
  const patched = HTML.replace(/var MP_BRIDGE_URL = "[^"]*";/, `var MP_BRIDGE_URL = ${JSON.stringify(bridgeUrl)};`);
  if (patched === HTML) throw new Error('no se pudo parchar MP_BRIDGE_URL en la landing');
  writeFileSync(join(dir, 'index.html'), patched);
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url || '/').split('?')[0];
    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(patched);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolvePromise({ url: `http://127.0.0.1:${port}/`, close: () => server.close() });
    });
  });
}

/** Compra completa: abrir checkout, llenar datos y enviar. */
async function buy(page: Page): Promise<void> {
  await page.locator('a.btn-checkout').first().click();
  await page.waitForSelector('#checkout-overlay', { state: 'visible' });
  await page.fill('#checkout-name', 'Prueba Popup');
  await page.fill('#checkout-email', 'popup@example.com');
}

test('la landing abre la pestaña de pago ANTES del await (si no, el navegador la bloquea)', () => {
  const handler = extractFn(HTML, 'openPaymentTab');
  assert.ok(handler, 'openPaymentTab debe existir en la landing');
  const submit = /document\.getElementById\('checkout-form'\)\.addEventListener\('submit'[\s\S]*?\n\}\);/.exec(HTML)?.[0];
  assert.ok(submit, 'no se encontro el submit del checkout');
  const openAt = submit.indexOf('openPaymentTab()');
  const awaitAt = submit.indexOf('await bridgePreference(');
  assert.ok(openAt >= 0, 'el submit debe abrir la pestaña de pago');
  assert.ok(awaitAt >= 0, 'el submit debe crear la preferencia');
  assert.ok(openAt < awaitAt, 'la pestaña se abre DESPUES del await: el navegador la bloquea como popup');
});

test('la landing publicada no usa el patron que el navegador bloquea', () => {
  assert.ok(
    !/window\.open\(pref\.initPoint/.test(HTML),
    'window.open(pref.initPoint) despues del await es exactamente el bug que se corrigio',
  );
  assert.ok(/function handleMpReturn\(/.test(HTML), 'la landing debe manejar el retorno ?mp= de MercadoPago');
  assert.ok(HTML.includes('mp=success') || /MP_STATUS_MSG/.test(HTML), 'debe existir el estado de pago confirmado');
});

test('con popup permitido: la pestana de pago aterriza en el checkout', async (t) => {
  const bridge = await startMockBridge();
  const landing = await startLandingServer(bridge.url);
  const browser: Browser = await chromium.launch();
  const context: BrowserContext = await browser.newContext();
  t.after(async () => {
    await browser.close();
    landing.close();
    bridge.close();
  });
  const page = await context.newPage();
  await page.goto(landing.url);
  await buy(page);

  const [popup] = await Promise.all([context.waitForEvent('page'), page.click('#checkout-go')]);
  // La navegación del popup es asíncrona: primero se abre en blanco y DESPUÉS
  // se la lleva al checkout. Esperar por la URL (no por domcontentloaded) es
  // lo que verifica que el checkout llegó de verdad.
  await popup.waitForURL(/\/mock-checkout\?pref_id=/, { timeout: 15000 });
  assert.match(popup.url(), /\/mock-checkout\?pref_id=/, 'la pestaña nueva debe llevar al checkout');
  assert.notEqual(popup.url(), landing.url, 'la pestaña nueva no puede ser la landing');
  assert.equal(bridge.preferences(), 1, 'debe crearse UNA preferencia (la del producto comprado)');
  // La landing queda mostrando el estado del pago (no la pantalla de gracias vacía).
  await page.waitForSelector('#gracias', { state: 'visible' });
  const sub = await page.textContent('#gracias-sub');
  assert.match(sub || '', /MercadoPago/, 'la landing debe explicar que el pago se completa en MercadoPago');
});

test('con popup bloqueado: el checkout se abre en la MISMA pestana (fallback)', async (t) => {
  const bridge = await startMockBridge();
  const landing = await startLandingServer(bridge.url);
  const browser: Browser = await chromium.launch();
  const context: BrowserContext = await browser.newContext();
  t.after(async () => {
    await browser.close();
    landing.close();
    bridge.close();
  });
  // El navegador bloquea el popup: window.open devuelve null.
  await context.addInitScript(() => {
    (window as unknown as { open: () => null }).open = () => null;
  });
  const page = await context.newPage();
  await page.goto(landing.url);
  await buy(page);
  await page.click('#checkout-go');
  await page.waitForURL(/\/mock-checkout\?pref_id=/, { timeout: 15000 });
  assert.match(page.url(), /\/mock-checkout\?pref_id=/, 'sin popup, el checkout debe quedar en la misma pestaña');
});

test('el retorno ?mp=success muestra la confirmacion y limpia la URL', async (t) => {
  const bridge = await startMockBridge();
  const landing = await startLandingServer(bridge.url);
  const browser: Browser = await chromium.launch();
  const context: BrowserContext = await browser.newContext();
  t.after(async () => {
    await browser.close();
    landing.close();
    bridge.close();
  });
  const page = await context.newPage();
  await page.goto(`${landing.url}?mp=success&ref=gv_course-base_agentes-ia_1700000000_abcd`);
  await page.waitForSelector('#gracias', { state: 'visible' });
  const sub = await page.textContent('#gracias-sub');
  assert.match(sub || '', /Pago confirmado/i, 'debe confirmar el pago al volver de MercadoPago');
  assert.ok(!page.url().includes('mp=success'), 'la URL debe quedar limpia (si no, se redispara al recargar)');
});
