import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig } from '../../../src/config/local-overrides.js';

test('local wins over canon (scalar)', () => {
  const out = resolveConfig({ daily: 10_000_000 }, { daily: 5_000_000 });
  assert.equal(out.daily, 5_000_000);
});

test('canon keys preserved when local absent', () => {
  const out = resolveConfig({ daily: 10_000_000, perSession: 3_000_000 }, {});
  assert.deepEqual(out, { daily: 10_000_000, perSession: 3_000_000 });
});

test('deep merge: local object keys override only their own keys', () => {
  const canon = { routing: { cheap: 'a', premium: 'b' }, other: 1 };
  const local = { routing: { premium: 'z' } };
  const out = resolveConfig(canon, local);
  // canon keys preserved, local override wins
  assert.deepEqual(out.routing, { cheap: 'a', premium: 'z' });
  assert.equal(out.other, 1);
});

test('arrays replaced wholesale (predictable)', () => {
  const out = resolveConfig({ tags: ['a', 'b'] }, { tags: ['c'] });
  assert.deepEqual(out.tags, ['c']);
});

test('null canon → local only', () => {
  const out = resolveConfig(null, { x: 1 });
  assert.deepEqual(out, { x: 1 });
});

test('null local → canon only', () => {
  const out = resolveConfig({ x: 1 }, null);
  assert.deepEqual(out, { x: 1 });
});

test('both null → empty object', () => {
  assert.deepEqual(resolveConfig(null, null), {});
});

test('local can add new keys not in canon', () => {
  const out = resolveConfig({ a: 1 }, { b: 2 });
  assert.deepEqual(out, { a: 1, b: 2 });
});
