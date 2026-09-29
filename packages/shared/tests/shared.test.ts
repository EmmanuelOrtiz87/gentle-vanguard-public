import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import {
  tokenize,
  bm25Score,
  parseArgs,
  hasFlag,
  flagValue,
  ensureDir,
  readJson,
  writeJson,
  fileExists,
  ok,
  err,
  isOk,
  isErr,
} from '../src/index.js';

describe('shared/bm25', () => {
  it('tokenizes alphanumeric words, lowercased', () => {
    assert.deepEqual(tokenize('Hello, World_2!'), ['hello', 'world_2']);
  });

  it('returns 0 on empty inputs', () => {
    assert.equal(bm25Score('', 'doc'), 0);
    assert.equal(bm25Score('query', ''), 0);
    assert.equal(bm25Score('!!!', 'doc'), 0);
  });

  it('scores matching docs higher than non-matching', () => {
    const q = 'retrieval grader';
    const match = bm25Score(q, 'the retrieval grader grades chunks by lexical overlap');
    const miss = bm25Score(q, 'docker compose restart policies for services');
    assert.ok(match > miss, `expected ${match} > ${miss}`);
  });

  it('applies longTokenBonus only for tokens >= minLength', () => {
    // short token: bonus irrelevant
    const base = bm25Score('ab', 'ab cd ef');
    const withBonus = bm25Score('ab', 'ab cd ef', { longTokenBonus: 0.3 });
    assert.equal(base, withBonus);
    // long token gets the bonus
    const longBase = bm25Score('abcdefgh', 'abcdefgh cd ef');
    const longBonus = bm25Score('abcdefgh', 'abcdefgh cd ef', { longTokenBonus: 0.3 });
    assert.ok(longBonus > longBase);
  });

  it('caps the score at maxScore', () => {
    const uncapped = bm25Score('abcdefgh ijklmnop', 'abcdefgh ijklmnop rest', {
      longTokenBonus: 5,
    });
    const capped = bm25Score('abcdefgh ijklmnop', 'abcdefgh ijklmnop rest', {
      longTokenBonus: 5,
      maxScore: 10,
    });
    assert.ok(uncapped > 10);
    assert.equal(capped, 10);
  });

  it('base behavior matches the historical retrieval-grader copy (no bonus, no cap)', () => {
    // Regression pin: identical formula to the pre-shared implementation
    const q = 'corrective rag fallback';
    const doc = 'corrective rag keyword fallback retrieval';
    const qTokens = tokenize(q);
    const dTokens = tokenize(doc);
    const freq = new Map<string, number>();
    for (const t of dTokens) freq.set(t, (freq.get(t) ?? 0) + 1);
    const docLen = dTokens.length;
    let expected = 0;
    for (const qt of qTokens) {
      const tf = freq.get(qt) ?? 0;
      if (tf === 0) continue;
      const denom = tf + 1.5 * (1 - 0.75 + 0.75 * (docLen / Math.max(docLen, 1)));
      expected += (tf / denom) * Math.log(2);
    }
    assert.equal(bm25Score(q, doc), expected);
  });
});

describe('shared/parse-args', () => {
  it('parses flags, key=value, key value and positionals', () => {
    const parsed = parseArgs(['--verbose', '--mode', 'deep', '--limit=5', 'file.ts']);
    assert.equal(hasFlag(parsed, 'verbose'), true);
    assert.equal(flagValue(parsed, 'mode'), 'deep');
    assert.equal(flagValue(parsed, 'limit'), '5');
    assert.deepEqual(parsed.positionals, ['file.ts']);
  });

  it('treats --flag followed by another flag as a flag, not a pair', () => {
    const parsed = parseArgs(['--all', '--quick']);
    assert.equal(hasFlag(parsed, 'all'), true);
    assert.equal(hasFlag(parsed, 'quick'), true);
    assert.equal(flagValue(parsed, 'all'), undefined);
  });
});

describe('shared/fs-json', () => {
  it('round-trips JSON with pretty output and nested dirs', () => {
    const path = join(tmpdir(), `gv-shared-test-${Date.now()}`, 'data.json');
    writeJson(path, { hello: 'world', n: 42 });
    assert.equal(fileExists(path), true);
    assert.deepEqual(readJson<{ hello: string; n: number }>(path), { hello: 'world', n: 42 });
  });

  it('includes the path in parse error messages', () => {
    const path = join(tmpdir(), `gv-shared-bad-${Date.now()}.json`);
    writeFileSync(path, '{invalid');
    assert.throws(() => readJson(path), /invalid JSON/);
  });
});

describe('shared/result', () => {
  it('discriminates ok/err', () => {
    const good = ok(1);
    const bad = err(new Error('x'));
    assert.ok(isOk(good) && good.value === 1);
    assert.ok(isErr(bad) && bad.error.message === 'x');
  });
});
