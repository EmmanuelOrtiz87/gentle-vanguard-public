import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, type TestContext } from 'node:test';
import worker from './worker.js';

// Only the external payment boundary is mocked: no real credentials or requests.
const pricing = JSON.parse(
  readFileSync(new URL('../../apps/academy-web/data/store/pricing.json', import.meta.url), 'utf8'),
) as { products: Record<string, { price: number }> };
const manual = JSON.parse(
  readFileSync(new URL('../../apps/academy-web/data/ebooks/manual-ia-docentes/ebook.json', import.meta.url), 'utf8'),
) as { id: string; title: string; priceTier: string };

function checkout(t: TestContext) {
  const payloads: Array<{ items: Array<{ title: string; unit_price: number; currency_id: string }> }> = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), 'https://api.mercadopago.com/checkout/preferences');
    payloads.push(JSON.parse(String(init?.body)));
    return Response.json({ id: 'test-preference', init_point: 'https://mp.invalid/test-checkout' });
  });
  const valid = {
    slug: manual.id,
    tier: manual.priceTier,
    title: manual.title,
    unitPrice: pricing.products[manual.priceTier].price,
    currency: 'USD',
  };
  return {
    valid,
    payloads,
    request: (body: object) => worker.fetch(new Request('https://bridge.invalid/api/mp/preference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }), { MP_ACCESS_TOKEN: 'TEST-CATALOG-ONLY' }),
  };
}

async function assertRejected(response: Response, payloads: unknown[]) {
  assert.ok(response.status >= 400 && response.status < 500,
    `invalid checkout must return a client error; got ${response.status}`);
  assert.equal((await response.json() as { ok: boolean }).ok, false);
  assert.equal(payloads.length, 0, 'invalid purchases must never create a payment preference');
}

test('catalog checkout accepts an available product at its catalog USD price', async (t) => {
  const { request, valid, payloads } = checkout(t);
  const response = await request(valid);
  assert.equal(response.status, 200);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].items[0].unit_price, valid.unitPrice);
  assert.equal(payloads[0].items[0].currency_id, 'USD');
});

test('catalog checkout rejects a manipulated positive price before contacting MercadoPago', async (t) => {
  const { request, valid, payloads } = checkout(t);
  await assertRejected(await request({ ...valid, unitPrice: 0.01 }), payloads);
});

test('catalog checkout rejects a product slug that does not exist', async (t) => {
  const { request, valid, payloads } = checkout(t);
  await assertRejected(await request({ ...valid, slug: 'nonexistent-product-regression' }), payloads);
});

test('catalog checkout requires product identity instead of accepting an arbitrary tier', async (t) => {
  const { request, valid, payloads } = checkout(t);
  const withoutSlug = Object.fromEntries(Object.entries(valid).filter(([key]) => key !== 'slug'));
  await assertRejected(await request(withoutSlug), payloads);
});

test('catalog checkout rejects a tier and price belonging to a different product category', async (t) => {
  const { request, valid, payloads } = checkout(t);
  await assertRejected(await request({
    ...valid, tier: 'ebook-micro', unitPrice: pricing.products['ebook-micro'].price,
  }), payloads);
});

test('catalog checkout rejects the retired reference-only ia-docentes basic toolkit', async (t) => {
  const { request, payloads } = checkout(t);
  await assertRejected(await request({
    slug: 'ia-docentes', tier: 'toolkit', title: 'IA para Docentes',
    unitPrice: pricing.products.toolkit.price, currency: 'USD',
  }), payloads);
});

test('catalog checkout rejects quote-only services from self-service payment', async (t) => {
  const { request, payloads } = checkout(t);
  await assertRejected(await request({
    slug: 'program-custom', tier: 'program-custom', title: 'Programa Personalizado',
    unitPrice: pricing.products['program-custom'].price, currency: 'USD',
  }), payloads);
});

test('catalog checkout rejects ARS amounts and client exchange rates without a server quote', async (t) => {
  const { request, valid, payloads } = checkout(t);
  await assertRejected(await request({
    ...valid, currency: 'ARS', unitPrice: valid.unitPrice * 1000, exchangeRate: 1000,
  }), payloads);
});

test('catalog checkout rejects unsupported payment currencies', async (t) => {
  const { request, valid, payloads } = checkout(t);
  await assertRejected(await request({ ...valid, currency: 'XXX' }), payloads);
});

test('catalog checkout uses the server product title instead of untrusted client marketing', async (t) => {
  const { request, valid, payloads } = checkout(t);
  const response = await request({ ...valid, title: 'Official accredited certification guaranteed' });
  assert.equal(response.status, 200);
  assert.equal(payloads[0].items[0].title, manual.title);
});
