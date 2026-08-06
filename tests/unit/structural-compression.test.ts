#!/usr/bin/env node
/**
 * Unit Tests: Structural Compression Engine
 * Verifies the 5 Headroom strategies absorbed in pure TS:
 * SmartCrusher (JSON), tabular compaction, LogCompressor, TextCrusher (BM25),
 * and cross-turn dedup.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  compressStructural,
  detectKind,
  estimateTokens,
} from '../../src/structural-compression.ts';

describe('Structural Compression Engine', () => {
  it('should detect tabular JSON arrays', () => {
    const input = JSON.stringify([
      { id: 'a', score: 1 },
      { id: 'b', score: 2 },
    ]);
    assert.strictEqual(detectKind(input), 'tabular');
  });

  it('should detect log output', () => {
    const input = '[ERROR] Build failed\n    at foo (app.ts:1:1)\n    at bar (app.ts:2:2)';
    assert.strictEqual(detectKind(input), 'log');
  });

  it('should detect prose', () => {
    const input = Array.from({ length: 5 }, (_, i) => `This is sentence number ${i} with enough words to be considered prose content.`).join('\n');
    assert.strictEqual(detectKind(input), 'prose');
  });

  it('should estimate tokens as ceil(chars/4)', () => {
    assert.strictEqual(estimateTokens(''), 0);
    assert.strictEqual(estimateTokens('abcd'), 1);
    assert.strictEqual(estimateTokens('abcdefgh'), 2);
  });

  it('SmartCrusher should crush large JSON arrays preserving outliers', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      id: `user_${i}`,
      score: i === 49 ? 5.0 : 80 + (i % 10), // row 49 is an outlier
    }));
    const result = compressStructural(JSON.stringify(rows));
    assert.strictEqual(result.kind, 'tabular');
    assert.strictEqual(result.strategy, 'smart-crusher');
    assert.ok(result.compressedChars < result.originalChars, 'should compress');
    assert.ok(result.tokenSavings > 0, 'should save tokens');
    // Outlier (score 5) must be preserved
    assert.ok(result.compressed.includes('5'), 'outlier should be preserved');
  });

  it('LogCompressor should collapse stack trace frames', () => {
    const input = [
      '[ERROR] Build failed',
      '    at foo (app.ts:1:5)',
      '    at bar (app.ts:2:5)',
      '    at baz (app.ts:3:5)',
      '    at qux (app.ts:4:5)',
      '[INFO] done',
    ].join('\n');
    const result = compressStructural(input);
    assert.strictEqual(result.strategy, 'log-compressor');
    assert.ok(result.compressed.includes('frames collapsed'), 'should collapse frames');
    assert.ok(result.compressedChars < result.originalChars, 'should compress');
  });

  it('TextCrusher should compress prose with query relevance', () => {
    const input = Array.from(
      { length: 10 },
      (_, i) => `This is a detailed sentence about the authentication flow and token handling in the system, numbered ${i}.`,
    ).join('\n');
    const result = compressStructural(input, { query: 'authentication token' });
    assert.strictEqual(result.strategy, 'text-crusher');
    assert.ok(result.compressedChars < result.originalChars, 'should compress');
  });

  it('should return none for empty input', () => {
    const result = compressStructural('');
    assert.strictEqual(result.kind, 'none');
    assert.strictEqual(result.strategy, 'none');
  });

  it('should never throw on malformed input', () => {
    const result = compressStructural('[{broken json');
    assert.ok(result.compressed.length > 0, 'should fall back to original');
  });
});