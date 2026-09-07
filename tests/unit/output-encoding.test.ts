import { describe, it } from 'node:test';
import assert from 'node:assert';
import { encodeOutput, encode } from '../../src/security/output-encoding.js';

describe('output-encoding', () => {
  it('escapes SQL string literals', () => {
    const r = encodeOutput("Robert'); DROP TABLE users;--", 'sql');
    assert.ok(r.modified);
    // SQL escaping doubles single quotes (''), preventing string termination
    assert.ok(r.encoded.includes("''"));
    // The doubled quote neutralizes the injection: the string does not close
    assert.ok(!r.encoded.includes("' DROP"));
  });

  it('wraps shell output in single quotes', () => {
    const r = encodeOutput('$(rm -rf /)', 'shell');
    assert.ok(r.modified);
    assert.ok(r.encoded.startsWith("'"));
    assert.ok(r.encoded.endsWith("'"));
  });

  it('HTML-entity encodes text nodes', () => {
    const r = encodeOutput('<script>alert(1)</script>', 'html');
    assert.ok(r.modified);
    assert.ok(!r.encoded.includes('<script>'));
    assert.ok(r.encoded.includes('&lt;script&gt;'));
  });

  it('HTML-entity encodes attribute values including quotes', () => {
    const r = encodeOutput('"><img src=x onerror=alert(1)>', 'htmlAttr');
    assert.ok(r.modified);
    assert.ok(!r.encoded.includes('"'));
    assert.ok(r.encoded.includes('&quot;'));
  });

  it('URL-encodes query segments', () => {
    const r = encodeOutput('a b&c=d', 'url');
    assert.ok(r.modified);
    assert.ok(!r.encoded.includes(' '));
  });

  it('JSON-escapes strings', () => {
    const r = encodeOutput('line1\nline2"quote', 'json');
    assert.ok(r.modified);
    assert.ok(r.encoded.includes('\\n'));
  });

  it('returns unmodified result for safe input', () => {
    const r = encodeOutput('hello world', 'html');
    assert.strictEqual(r.modified, false);
    assert.strictEqual(r.encoded, 'hello world');
  });

  it('encode() convenience returns just the string', () => {
    assert.strictEqual(encode('<b>', 'html'), '&lt;b&gt;');
  });
});