import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cached,
  defaultTtlMinutes,
  estimateTokensFor,
  isCacheDisabled,
  type CacheLike,
} from '../../src/resilience/response-cache/cached';

/** In-memory CacheLike honoring the same (input, context) keying + TTL semantics. */
class MemoryCache implements CacheLike {
  entries = new Map<string, { response: string; tokensSaved: number; expiresAt: number }>();
  writes = 0;

  get(input: string, context = ''): { response: string; tokensSaved: number } | null {
    const e = this.entries.get(`${input}|${context}`);
    if (!e) return null;
    if (Date.now() > e.expiresAt) {
      this.entries.delete(`${input}|${context}`);
      return null; // expired
    }
    return { response: e.response, tokensSaved: e.tokensSaved };
  }

  set(
    input: string,
    response: string,
    tokensSaved: number,
    context = '',
    ttlMinutes?: number,
  ): void {
    this.writes++;
    this.entries.set(`${input}|${context}`, {
      response,
      tokensSaved,
      expiresAt: Date.now() + (ttlMinutes ?? 60) * 60_000,
    });
  }
}

const OPTS = { context: 'test', input: 'q1', cache: undefined as unknown as CacheLike };

test('cached(): miss then hit — fn runs once, second call served from cache', async () => {
  const cache = new MemoryCache();
  let calls = 0;
  const fn = async (): Promise<{ a: number }> => {
    calls++;
    return { a: 42 };
  };

  const first = await cached({ ...OPTS, cache }, fn);
  assert.equal(first.cache, 'miss');
  assert.deepEqual(first.value, { a: 42 });
  assert.equal(calls, 1);

  const second = await cached({ ...OPTS, cache }, fn);
  assert.equal(second.cache, 'hit');
  assert.deepEqual(second.value, { a: 42 });
  assert.equal(calls, 1, 'fn must NOT re-run on hit');
  assert.ok(second.tokensSaved > 0, 'hit reports estimated tokens saved');
  assert.equal(cache.writes, 1, 'only one write');
});

test('cached(): different input or context is a miss (correct key discrimination)', async () => {
  const cache = new MemoryCache();
  let calls = 0;
  const fn = async (): Promise<string> => {
    calls++;
    return 'v';
  };
  await cached({ context: 'c1', input: 'i1', cache }, fn);
  const otherInput = await cached({ context: 'c1', input: 'i2', cache }, fn);
  const otherContext = await cached({ context: 'c2', input: 'i1', cache }, fn);
  assert.equal(otherInput.cache, 'miss');
  assert.equal(otherContext.cache, 'miss');
  assert.equal(calls, 3);
});

test('cached(): GV_CACHE_DISABLED=1 bypasses cache entirely (no read, no write)', async () => {
  const prev = process.env.GV_CACHE_DISABLED;
  process.env.GV_CACHE_DISABLED = '1';
  try {
    assert.ok(isCacheDisabled());
    const cache = new MemoryCache();
    let calls = 0;
    const fn = async (): Promise<string> => {
      calls++;
      return 'x';
    };
    const r1 = await cached({ context: 't', input: 'bypass', cache }, fn);
    const r2 = await cached({ context: 't', input: 'bypass', cache }, fn);
    assert.equal(r1.cache, 'bypass');
    assert.equal(r2.cache, 'bypass');
    assert.equal(calls, 2, 'fn runs every time when bypassed');
    assert.equal(cache.writes, 0, 'no writes while disabled');
  } finally {
    if (prev === undefined) delete process.env.GV_CACHE_DISABLED;
    else process.env.GV_CACHE_DISABLED = prev;
  }
  assert.ok(!isCacheDisabled());
});

test('cached(): TTL expiry — expired entry falls back to fn (miss)', async () => {
  const cache = new MemoryCache();
  let calls = 0;
  const fn = async (): Promise<string> => {
    calls++;
    return 'fresh';
  };
  // Store with a TTL that is already in the past.
  cache.set('ttl-key', JSON.stringify('stale'), 10, 'ttl-ctx', 0);
  await new Promise((r) => setTimeout(r, 5)); // let it expire

  const r = await cached({ context: 'ttl-ctx', input: 'ttl-key', cache }, fn);
  assert.equal(r.cache, 'miss', 'expired entry must be treated as a miss');
  assert.equal(r.value, 'fresh');
  assert.equal(calls, 1);
});

test('cached(): custom ttlMinutes is forwarded to the cache backend', async () => {
  const cache = new MemoryCache();
  await cached({ context: 'ttl-fwd', input: 'x', cache, ttlMinutes: 5 }, async () => 1);
  const e = cache.entries.get('x|ttl-fwd');
  assert.ok(e);
  const expected = Date.now() + 5 * 60_000;
  assert.ok(Math.abs(e.expiresAt - expected) < 1000, `ttl ~5min, got ${e.expiresAt - Date.now()}ms`);
});

test('cached(): corrupt cached payload degrades to miss without throwing', async () => {
  const cache = new MemoryCache();
  cache.set('corrupt', '{not-json', 5, 'corrupt-ctx');
  const r = await cached({ context: 'corrupt-ctx', input: 'corrupt', cache }, async () => 'ok');
  assert.equal(r.cache, 'miss');
  assert.equal(r.value, 'ok');
});

test('cached(): cache write failure never breaks the host path', async () => {
  const broken: CacheLike = {
    get: () => null,
    set: () => {
      throw new Error('disk full');
    },
  };
  const r = await cached({ context: 'c', input: 'i', cache: broken }, async () => 'value');
  assert.equal(r.value, 'value');
  assert.equal(r.cache, 'miss');
});

test('defaultTtlMinutes(): env override + fallback to 24h', () => {
  assert.equal(defaultTtlMinutes(), 1440);
  const prev = process.env.GV_CACHE_TTL_MINUTES;
  process.env.GV_CACHE_TTL_MINUTES = '60';
  try {
    assert.equal(defaultTtlMinutes(), 60);
  } finally {
    if (prev === undefined) delete process.env.GV_CACHE_TTL_MINUTES;
    else process.env.GV_CACHE_TTL_MINUTES = prev;
  }
});

test('estimateTokensFor(): ~chars/4 heuristic', () => {
  assert.equal(estimateTokensFor('abcd'.repeat(10)), 10);
  assert.equal(estimateTokensFor({ a: 'abcd' }), Math.ceil(JSON.stringify({ a: 'abcd' }).length / 4));
});
