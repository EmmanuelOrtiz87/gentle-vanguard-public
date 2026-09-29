#!/usr/bin/env node
/**
 * Tests for Standard Webhooks (sign + verify).
 * Runs with `node --import tsx --test tests/unit/webhooks/standard-webhooks.test.ts`.
 *
 * All verify() calls pass an explicit `now` so the suite is time-deterministic —
 * timestamps are illustrative IDs, not anchors. Per the Standard Webhooks spec,
 * expiration (|now - timestamp| > toleranceSeconds) is checked BEFORE signature
 * verification (prevents replay attacks).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  StandardWebhooks,
  generateSecret,
  type WebhookHeaders,
} from '../../../src/webhooks/standard-webhooks.js';

const SECRET = 'whsec_' + Buffer.from('test-secret-key-32-bytes-padded-XXX').toString('base64');
const FROZEN_NOW = 1_700_000_000; // frozen "now" so tests are deterministic

function buildHeaders(
  id: string,
  ts: number,
  signature: string,
  prefix: '' | 'svix-' | 'webhook-' = '',
): Record<string, string> {
  if (prefix === '') {
    return { id, timestamp: ts.toString(), signature };
  }
  return {
    [`${prefix}id`]: id,
    [`${prefix}timestamp`]: ts.toString(),
    [`${prefix}signature`]: signature,
  };
}

test('sign + verify roundtrip with bare id/timestamp/signature', () => {
  const sw = new StandardWebhooks(SECRET);
  const id = 'msg_123';
  const ts = FROZEN_NOW - 10; // 10s ago (within 5min default tolerance)
  const body = JSON.stringify({ event: 'created', id: 'evt_1' });
  const sig = sw.sign(id, ts, body);
  assert.match(sig, /^v1,[A-Za-z0-9+/=]+$/);
  const result = sw.verify({ id, timestamp: ts.toString(), signature: sig }, body, { now: FROZEN_NOW });
  assert.deepEqual(result, { ok: true });
});

test('verify accepts svix- prefix aliases', () => {
  const sw = new StandardWebhooks(SECRET);
  const id = 'msg_abc';
  const ts = FROZEN_NOW - 20;
  const body = '{"x":1}';
  const sig = sw.sign(id, ts, body);
  const headers = buildHeaders(id, ts, sig, 'svix-');
  const result = sw.verify(headers, body, { now: FROZEN_NOW });
  assert.deepEqual(result, { ok: true });
});

test('verify accepts webhook- prefix aliases (Standard Webhooks spec)', () => {
  const sw = new StandardWebhooks(SECRET);
  const id = 'msg_xyz';
  const ts = FROZEN_NOW - 30;
  const body = '{"hello":"world"}';
  const sig = sw.sign(id, ts, body);
  const headers = buildHeaders(id, ts, sig, 'webhook-');
  const result = sw.verify(headers, body, { now: FROZEN_NOW });
  assert.deepEqual(result, { ok: true });
});

test('verify rejects tampered body (signature mismatch)', () => {
  const sw = new StandardWebhooks(SECRET);
  const id = 'msg_tamper';
  const ts = FROZEN_NOW - 40;
  const body = '{"amount":100}';
  const sig = sw.sign(id, ts, body);
  const tampered = '{"amount":999}';
  const result = sw.verify(
    { id, timestamp: ts.toString(), signature: sig },
    tampered,
    { now: FROZEN_NOW },
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'bad-signature');
});

test('verify rejects expired timestamps (replay protection)', () => {
  const sw = new StandardWebhooks(SECRET);
  const id = 'msg_old';
  const oldTs = FROZEN_NOW - 10_000; // ~2.7h ago (beyond 5min default tolerance)
  const body = '{}';
  const sig = sw.sign(id, oldTs, body);
  const result = sw.verify(
    { id, timestamp: oldTs.toString(), signature: sig },
    body,
    { now: FROZEN_NOW },
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'expired');
});

test('verify respects custom tolerance', () => {
  const sw = new StandardWebhooks(SECRET);
  const id = 'msg_tol';
  const ts = FROZEN_NOW - 60; // 60s ago
  const body = '{}';
  const sig = sw.sign(id, ts, body);
  // 30s tolerance -> reject
  const reject = sw.verify(
    { id, timestamp: ts.toString(), signature: sig },
    body,
    { toleranceSeconds: 30, now: FROZEN_NOW },
  );
  assert.equal(reject.ok, false);
  // 120s tolerance -> accept
  const accept = sw.verify(
    { id, timestamp: ts.toString(), signature: sig },
    body,
    { toleranceSeconds: 120, now: FROZEN_NOW },
  );
  assert.deepEqual(accept, { ok: true });
});

test('verify supports multi-signature (rotation) — match any', () => {
  const oldSecret = 'whsec_' + Buffer.from('old-secret').toString('base64');
  const newSecret = 'whsec_' + Buffer.from('new-secret').toString('base64');
  const oldSw = new StandardWebhooks(oldSecret);
  const newSw = new StandardWebhooks(newSecret);
  const id = 'msg_rot';
  const ts = FROZEN_NOW - 5;
  const body = '{"event":"ping"}';
  const rotated = `${oldSw.sign(id, ts, body)} ${newSw.sign(id, ts, body)}`;
  // verify with NEW secret only — should match the second sig
  const result = newSw.verify(
    { id, timestamp: ts.toString(), signature: rotated },
    body,
    { now: FROZEN_NOW },
  );
  assert.deepEqual(result, { ok: true });
});

test('verify returns structured errors (no throw on bad input)', () => {
  const sw = new StandardWebhooks(SECRET);
  assert.deepEqual(sw.verify({}, '{}'), { ok: false, reason: 'missing-id' });
  assert.deepEqual(sw.verify({ id: 'x' }, '{}'), {
    ok: false,
    reason: 'missing-timestamp',
  });
  assert.deepEqual(sw.verify({ id: 'x', timestamp: '100' }, '{}'), {
    ok: false,
    reason: 'missing-signature',
  });
  assert.deepEqual(
    sw.verify({ id: 'x', timestamp: 'not-a-number', signature: 'v1,abc' }, '{}'),
    { ok: false, reason: 'bad-timestamp' },
  );
});

test('verify rejects v0 or unknown prefix without 0 sig', () => {
  const sw = new StandardWebhooks(SECRET);
  const id = 'msg_v0';
  // Fresh timestamp so verify reaches the signature-prefix check
  // (expiration is checked first per Standard Webhooks spec — replay protection).
  const ts = FROZEN_NOW - 5;
  const body = '{}';
  const result = sw.verify(
    {
      id,
      timestamp: ts.toString(),
      signature: 'v0,AAAA v2,BBBB',
    },
    body,
    { now: FROZEN_NOW },
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-v1-signature');
});

test('constructor rejects malformed secrets', () => {
  assert.throws(() => new StandardWebhooks('not-whsec-foo'), /must start with/);
  assert.throws(() => new StandardWebhooks('whsec_'), /empty/);
  // Whitespace after prefix is not valid base64 (decodes to empty) — should throw.
  assert.throws(() => new StandardWebhooks('whsec_   '), /empty/);
});

test('generateSecret produces whsec_ prefixed random secrets', () => {
  const a = generateSecret();
  const b = generateSecret();
  assert.match(a, /^whsec_[A-Za-z0-9+/=]+$/);
  assert.notEqual(a, b, 'secrets should be unique per call');
  assert.equal(StandardWebhooks.isValidSecret(a), true);
  assert.equal(StandardWebhooks.isValidSecret('not-whsec'), false);
});

test('sign uses raw body bytes — any byte change breaks signature', () => {
  const sw = new StandardWebhooks(SECRET);
  const id = 'msg_raw';
  const ts = FROZEN_NOW - 8;
  // signed with the EXACT byte sequence (whitespace, key order, all preserved)
  const original = '{"a":1,"b":2}';
  const sig = sw.sign(id, ts, original);
  // Different content (one byte changed) — must reject
  const changed = '{"a":2,"b":2}';
  const result = sw.verify(
    { id, timestamp: ts.toString(), signature: sig },
    changed,
    { now: FROZEN_NOW },
  );
  assert.equal(result.ok, false, 'verify must reject any byte change');
});

test('constant-time compare — verifying same length with wrong sig returns bad-signature', () => {
  const sw = new StandardWebhooks(SECRET);
  const now = FROZEN_NOW;
  const id = 'msg_ct';
  const ts = FROZEN_NOW - 10; // 10 seconds ago
  const body = '{}';
  const realSig = sw.sign(id, ts, body);
  // Tamper last base64 char (same length to force full compare)
  const lastIdx = realSig.length - 1;
  const tampered =
    realSig.slice(0, lastIdx) + (realSig[lastIdx] === 'A' ? 'B' : 'A');
  const result = sw.verify(
    { id, timestamp: ts.toString(), signature: tampered },
    body,
    { now },
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'bad-signature');
});