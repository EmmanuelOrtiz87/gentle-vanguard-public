#!/usr/bin/env node

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker';

const env = {
  MP_ACCESS_TOKEN: 'TEST-123',
  MP_PUBLIC_KEY: 'TEST-PUB',
  MP_BRIDGE_SECRET: 's3cret',
  CRM_WEBHOOK_URL: '',
};

function req(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`https://gv-mp-bridge.test${path}`, init), env);
}

test('health expone estado sin secretos', async () => {
  const res = await req('/api/mp/health');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; hasToken: boolean; hasPublicKey: boolean };
  assert.equal(body.ok, true);
  assert.equal(body.hasToken, true);
  assert.equal(body.hasPublicKey, true);
});

test('preference exige secreto compartido cuando esta definido', async () => {
  const res = await req('/api/mp/preference', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier: 'ebook-micro', title: 'Test', unitPrice: 20 }),
  });
  assert.equal(res.status, 401);
});

test('preference rechaza unitPrice invalido', async () => {
  const res = await req('/api/mp/preference', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bridge-secret': 's3cret' },
    body: JSON.stringify({ tier: 'ebook-micro', title: 'Test', unitPrice: 0 }),
  });
  assert.equal(res.status, 400);
});

test('preference sin token configurado devuelve 500', async () => {
  const res = await worker.fetch(
    new Request('https://gv-mp-bridge.test/api/mp/preference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-secret': 's3cret' },
      body: JSON.stringify({ tier: 'x', title: 'T', unitPrice: 10 }),
    }),
    { MP_PUBLIC_KEY: 'k' },
  );
  assert.equal(res.status, 500);
});

test('webhook sin payment id devuelve 400', async () => {
  const res = await req('/api/mp/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'payment', data: {} }),
  });
  assert.equal(res.status, 400);
});

test('ruta desconocida devuelve 404', async () => {
  const res = await req('/nope');
  assert.equal(res.status, 404);
});

test('OPTIONS responde CORS', async () => {
  const res = await req('/api/mp/preference', { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.ok(res.headers.get('access-control-allow-origin'));
});

test('notification_url apunta al WORKER, no a la landing (regresión)', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/checkout/preferences')) {
      calls.push({ url, body: String(init?.body ?? '') });
      return new Response(JSON.stringify({ id: 'pref-1', init_point: 'https://mp.test/checkout/1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    const res = await req('/api/mp/preference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-secret': 's3cret' },
      body: JSON.stringify({
        tier: 'ebook-micro',
        title: 'Test',
        unitPrice: 20,
        backUrl: 'https://landing-maliciosa.com',
      }),
    });
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1, 'debería haber llamado a la API de MP');
    const payload = JSON.parse(calls[0].body) as { notification_url: string };
    assert.equal(payload.notification_url, 'https://gv-mp-bridge.test/api/mp/webhook');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ─── Cola at-least-once (SALES_KV): pending / ack / auth ────────────────────

/** KV fake in-memory. */
function fakeKV(): {
  store: Map<string, string>;
  kv: {
    get(k: string): Promise<string | null>;
    put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void>;
    delete(k: string): Promise<void>;
    list(o?: { prefix?: string }): Promise<{ keys: Array<{ name: string }> }>;
  };
} {
  const store = new Map<string, string>();
  return {
    store,
    kv: {
      get: async (k) => store.get(k) ?? null,
      put: async (k, v) => void store.set(k, v),
      delete: async (k) => void store.delete(k),
      list: async (o) => ({
        keys: [...store.keys()].filter((k) => !o?.prefix || k.startsWith(o.prefix)).map((name) => ({ name })),
      }),
    },
  };
}

test('sales/pending sin SALES_KV devuelve 500', async () => {
  const res = await req('/api/mp/sales/pending');
  assert.equal(res.status, 500);
});

test('cola: webhook aprobado encola → pending lista → ack borra', async () => {
  const { store, kv } = fakeKV();
  const envKv = { ...env, SALES_KV: kv, SALES_POLL_SECRET: 'poll-secret' };

  // Simular webhook aprobado (mock de verifyPayment contra la API de MP).
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/v1/payments/')) {
      return new Response(
        JSON.stringify({
          id: 999,
          status: 'approved',
          status_detail: 'accredited',
          transaction_amount: 10,
          currency_id: 'USD',
          external_reference: 'gv-test-abc',
          payer: { email: 'buyer@test.com' },
          payment_method_id: 'master',
          date_approved: '2026-09-22T12:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return originalFetch(input);
  }) as typeof fetch;

  try {
    const wh = await worker.fetch(
      new Request('https://gv-mp-bridge.test/api/mp/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'payment', data: { id: 999 } }),
      }),
      envKv,
    );
    assert.equal(wh.status, 200);
    assert.equal(store.size, 2, 'la venta queda encolada: fan-out de una clave por consumidor');

    // pending sin secret → 401
    const denied = await worker.fetch(
      new Request('https://gv-mp-bridge.test/api/mp/sales/pending'),
      envKv,
    );
    assert.equal(denied.status, 401);

    // pending con secret → 1 venta con _key
    const pend = await worker.fetch(
      new Request('https://gv-mp-bridge.test/api/mp/sales/pending', {
        headers: { 'x-poll-secret': 'poll-secret' },
      }),
      envKv,
    );
    assert.equal(pend.status, 200);
    const pendBody = (await pend.json()) as { count: number; sales: Array<{ paymentId: string; _key: string }> };
    assert.equal(pendBody.count, 1);
    assert.equal(pendBody.sales[0].paymentId, '999');
    assert.ok(pendBody.sales[0]._key.startsWith('sale:'));

    // Fan-out: la venta se encoló para CADA consumidor. El ack del CRM solo
    // borra la suya — la del portal sobrevive (es el punto del fan-out).
    assert.equal(store.size, 2, 'fan-out: una clave por consumidor');
    const portalKey = [...store.keys()].find((k) => k.startsWith('consumer:portal:'));
    assert.ok(portalKey, 'debe existir una clave consumer:portal:');

    // ack con la key → borra SOLO la de este consumidor
    const ack = await worker.fetch(
      new Request('https://gv-mp-bridge.test/api/mp/sales/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-poll-secret': 'poll-secret' },
        body: JSON.stringify({ keys: [pendBody.sales[0]._key] }),
      }),
      envKv,
    );
    assert.equal(ack.status, 200);
    const ackBody = (await ack.json()) as { acked: number; consumer: string };
    assert.equal(ackBody.acked, 1);
    assert.equal(ackBody.consumer, 'crm', 'el default sigue siendo el CRM');
    assert.equal(store.size, 1, 'solo desaparece la cola del CRM');
    assert.ok([...store.keys()].includes(portalKey!), 'la cola del portal NO se toca');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('cola: fan-out — pending por consumidor devuelve SU cola', async () => {
  const { store, kv } = fakeKV();
  const envKv = { ...env, SALES_KV: kv };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes('/v1/payments/')) {
      return new Response(JSON.stringify({ id: 777, status: 'approved' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(input);
  }) as typeof fetch;
  try {
    const wh = await worker.fetch(
      new Request('https://gv-mp-bridge.test/api/mp/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'payment', data: { id: 777 } }),
      }),
      envKv,
    );
    assert.equal(wh.status, 200);
    assert.equal(store.size, 2, 'la venta va a las dos colas');

    const crm = await worker.fetch(
      new Request('https://gv-mp-bridge.test/api/mp/sales/pending?consumer=crm', {
        headers: { 'x-poll-secret': 'poll-secret' },
      }),
      envKv,
    );
    const crmBody = (await crm.json()) as { count: number; sales: Array<{ _key: string; _consumer: string }> };
    assert.equal(crmBody.count, 1);
    assert.equal(crmBody.sales[0]._consumer, 'crm');
    assert.ok(crmBody.sales[0]._key.startsWith('sale:'));
    assert.ok(!crmBody.sales[0]._key.includes('consumer:'), 'el CRM no ve la cola del portal');

    const portal = await worker.fetch(
      new Request('https://gv-mp-bridge.test/api/mp/sales/pending?consumer=portal', {
        headers: { 'x-poll-secret': 'poll-secret' },
      }),
      envKv,
    );
    const portalBody = (await portal.json()) as { count: number; sales: Array<{ _key: string; _consumer: string }> };
    assert.equal(portalBody.count, 1, 'el portal ve la misma venta');
    assert.equal(portalBody.sales[0]._consumer, 'portal');
    assert.ok(portalBody.sales[0]._key.startsWith('consumer:portal:'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('cola: el ack de un consumidor NO puede borrar claves de otro', async () => {
  const { store, kv } = fakeKV();
  const envKv = { ...env, SALES_KV: kv };
  store.set('sale:1:ref-crm', JSON.stringify({ paymentId: '1' }));
  store.set('consumer:portal:1:ref-portal', JSON.stringify({ paymentId: '1' }));

  // El portal intenta ackear la clave del CRM → 400, y no borra nada.
  const cross = await worker.fetch(
    new Request('https://gv-mp-bridge.test/api/mp/sales/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-poll-secret': 'poll-secret' },
      body: JSON.stringify({ keys: ['sale:1:ref-crm'], consumer: 'portal' }),
    }),
    envKv,
  );
  assert.equal(cross.status, 400, 'un consumidor no puede ackear la cola de otro');
  assert.equal(store.size, 2, 'no se borró ninguna clave');

  // El portal sí puede ackear la suya.
  const own = await worker.fetch(
    new Request('https://gv-mp-bridge.test/api/mp/sales/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-poll-secret': 'poll-secret' },
      body: JSON.stringify({ keys: ['consumer:portal:1:ref-portal'], consumer: 'portal' }),
    }),
    envKv,
  );
  assert.equal(own.status, 200);
  assert.equal(store.size, 1);
  assert.ok([...store.keys()].includes('sale:1:ref-crm'), 'la cola del CRM queda intacta');
});

test('cola: webhook no aprobado NO encola', async () => {
  const { store, kv } = fakeKV();
  const envKv = { ...env, SALES_KV: kv };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/v1/payments/')) {
      return new Response(JSON.stringify({ id: 888, status: 'pending' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(input);
  }) as typeof fetch;
  try {
    const wh = await worker.fetch(
      new Request('https://gv-mp-bridge.test/api/mp/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'payment', data: { id: 888 } }),
      }),
      envKv,
    );
    assert.equal(wh.status, 200);
    assert.equal(store.size, 0, 'solo ventas approved se encolan');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('cola: ack rechaza keys inválidas', async () => {
  const { kv } = fakeKV();
  const res = await worker.fetch(
    new Request('https://gv-mp-bridge.test/api/mp/sales/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: ['otra-cosa'] }),
    }),
    { ...env, SALES_KV: kv },
  );
  assert.equal(res.status, 400);
});