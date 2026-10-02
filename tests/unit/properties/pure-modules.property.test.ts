/**
 * Property-based tests (fast-check) sobre los módulos puros del stack.
 *
 * Los tests unitarios fijan ejemplos concretos; estos fijan INVARIANTES que
 * deben cumplirse para toda entrada generada (roundtrip, monotonicidad,
 * caps, aislamiento). Corren con node:test + fast-check, sin red ni I/O.
 *
 * Run: node --import tsx --test tests/unit/properties/pure-modules.property.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { StandardWebhooks } from '../../../src/webhooks/standard-webhooks.ts';
import { computeBackoff } from '../../../src/posting/queue.ts';
import { whereTenant, whereEq, buildWhere } from '../../../src/tenant/helper.ts';

// ─── webhooks: sign/verify roundtrip + tamper detection ─────────────────────

test('webhooks: sign→verify roundtrip para cualquier (secreto, id, ts, body)', () => {
  fc.assert(
    fc.property(
      fc.uint8Array({ minLength: 16, maxLength: 64 }),
      fc.string({ minLength: 8, maxLength: 32 }),
      fc.integer({ min: 1_000_000_000, max: 4_000_000_000 }),
      fc.string({ minLength: 0, maxLength: 512 }),
      (secretBytes, id, ts, body) => {
        // Fuera del dominio wire-format: HTTP trimea whitespace de headers,
        // así que un id de solo espacios nunca llega así por el cable.
        fc.pre(id === id.trim()); // HTTP recorta whitespace de headers: el dominio del wire son ids ya trimmeados
        const secret = 'whsec_' + Buffer.from(secretBytes).toString('base64');
        const sw = new StandardWebhooks(secret);
        const sig = sw.sign(id, ts, body);
        const result = sw.verify(
          { id, 'webhook-timestamp': String(ts), 'webhook-signature': sig },
          body,
          { toleranceSeconds: 1e10 }, // cubre todo el rango de ts generado (2001..2096)
        );
        assert.equal(result.ok, true, `roundtrip falló para ts=${ts} body len=${body.length}`);
      },
    ),
    { numRuns: 200 },
  );
});

test('webhooks: CUALQUIER mutación del body se detecta', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 16, maxLength: 32 }),
      fc.string({ minLength: 1, maxLength: 256 }),
      fc.string({ minLength: 1, maxLength: 256 }),
      (id, original, tamper) => {
        fc.pre(id === id.trim()); // mismo dominio wire que el roundtrip
        fc.pre(original !== tamper);
        const sw = new StandardWebhooks('whsec_' + Buffer.from('prop-test-secret-32-bytes-xxxxxxx').toString('base64'));
        const ts = Math.floor(Date.now() / 1000);
        const sig = sw.sign(id, ts, original);
        const result = sw.verify(
          { id, 'webhook-timestamp': String(ts), 'webhook-signature': sig },
          tamper,
        );
        assert.equal(result.ok, false, 'un body alterado nunca debe verificar');
      },
    ),
    { numRuns: 150 },
  );
});

// ─── posting: computeBackoff (exponencial, jitter acotado, cap 600s) ────────

test('posting: computeBackoff es exponencial, acotado y con jitter en [0s,1s]', () => {
  const MAX_ATTEMPTS = 40;
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: MAX_ATTEMPTS }),
      fc.integer({ min: 0, max: 999_999 }),
      (attempts, jitterInt) => {
        const jitter = jitterInt / 1_000_000;
        const ms = computeBackoff(attempts, () => jitter);
        const base = Math.min(2 ** attempts, 600);
        assert.ok(ms >= base * 1000, `ms=${ms} < base=${base * 1000}`);
        assert.ok(ms <= base * 1000 + 1000, `ms=${ms} excede base+jitter`);
        assert.ok(ms <= 601_000, `ms=${ms} supera el cap 600s+jitter`);
        assert.ok(Number.isInteger(ms), `ms=${ms} no es entero`);
      },
    ),
    { numRuns: 300 },
  );
});

test('posting: computeBackoff es monótono no-decreciente en attempts (mismo rng)', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 30 }), (attempts) => {
      const rng = () => 0.5;
      const lo = computeBackoff(attempts - 1, rng);
      const hi = computeBackoff(attempts, rng);
      // Con base capada en 600s ambos valen 601000 — igualdad es válida.
      assert.ok(hi >= lo, `backoff decreció: attempts=${attempts} lo=${lo} hi=${hi}`);
    }),
    { numRuns: 100 },
  );
});

// ─── tenant: composición de cláusulas — aislamiento por tenant_id ───────────

test('tenant: whereTenant siempre compone tenant_id como primer predicado', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 40 }),
      fc.string({ minLength: 1, maxLength: 40 }),
      (tenantId, extraColumn) => {
        fc.pre(/^[a-z_]+$/i.test(extraColumn));
        const clause = whereTenant(tenantId, { column: extraColumn });
        assert.ok(clause.sql.startsWith(`${extraColumn} = ?`), `sql inesperado: ${clause.sql}`);
        assert.deepEqual(clause.params, [tenantId]);
      },
    ),
    { numRuns: 100 },
  );
});

test('tenant: buildWhere compone N extras con AND sin perder el filtro de tenant', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 30 }),
      fc.array(fc.tuple(fc.string({ minLength: 1, maxLength: 20 }), fc.string({ minLength: 0, maxLength: 30 })), {
        maxLength: 5,
      }),
      (tenantId, extras) => {
        fc.pre(extras.every(([col]) => /^[a-z_]+$/i.test(col)));
        const extrasClauses = extras.map(([col, val]) => whereEq(col, val));
        // Contrato real: buildWhere(tenantWhere, ...extras) envuelve cada
        // cláusula en paréntesis y las une con AND.
        const combined = buildWhere(whereTenant(tenantId), ...extrasClauses);
        assert.ok(combined.sql.startsWith('(tenant_id = ?)'), `tenant_id no va primero: ${combined.sql}`);
        assert.equal(combined.sql.split(' AND ').length, extras.length + 1, 'cantidad de cláusulas AND');
        const expectedParams = [tenantId, ...extras.map(([, v]) => v)];
        assert.deepEqual(combined.params, expectedParams);
      },
    ),
    { numRuns: 120 },
  );
});
