import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  sha256Of,
  verifySource,
  buildSourceRecord,
  verifyProvenanceChain,
} from '../../src/security/rag-source-integrity.js';

describe('rag-source-integrity', () => {
  it('computes SHA-256 hashes deterministically', () => {
    const h1 = sha256Of('hello world');
    const h2 = sha256Of('hello world');
    assert.strictEqual(h1, h2);
    assert.strictEqual(h1.length, 64);
  });

  it('verifies a source against a matching hash', () => {
    const content = 'trusted document content';
    const hash = sha256Of(content);
    const result = verifySource('doc-1', content, hash);
    assert.strictEqual(result.verified, true);
    assert.strictEqual(result.computedHash, hash);
  });

  it('rejects a source with a mismatched hash (fail closed)', () => {
    const content = 'trusted document content';
    const wrongHash = sha256Of('tampered content');
    const result = verifySource('doc-1', content, wrongHash);
    assert.strictEqual(result.verified, false);
    assert.ok(result.reason);
  });

  it('builds a provenance record with content hash', () => {
    const record = buildSourceRecord('doc-1', 'content', 'file:///docs/a.md', 'file');
    assert.strictEqual(record.sourceId, 'doc-1');
    assert.strictEqual(record.contentHash, sha256Of('content'));
    assert.strictEqual(record.sourceType, 'file');
    assert.ok(record.ingestedAt);
  });

  it('verifies a provenance chain with valid records', () => {
    const record = buildSourceRecord('doc-1', 'content', 'file:///docs/a.md', 'file');
    const chain = verifyProvenanceChain({ records: [record], intact: true, violations: [] });
    assert.strictEqual(chain.intact, true);
    assert.strictEqual(chain.violations.length, 0);
  });

  it('flags records with invalid content hashes', () => {
    const badRecord = buildSourceRecord('doc-1', 'content', 'file:///docs/a.md', 'file');
    badRecord.contentHash = 'short';
    const chain = verifyProvenanceChain({ records: [badRecord], intact: true, violations: [] });
    assert.strictEqual(chain.intact, false);
    assert.ok(chain.violations.length > 0);
  });
});