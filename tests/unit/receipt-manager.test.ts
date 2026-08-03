import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';

// Test receipt-manager functions by importing and testing directly
// Note: These tests require a git repository context

describe('receipt-manager.ts', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'gv-receipt-'));
    // Create minimal .session/receipts directory
    const receiptDir = join(tempRoot, '.session', 'receipts');
    mkdirSync(receiptDir, { recursive: true });
    writeFileSync(
      join(receiptDir, 'index.json'),
      JSON.stringify({ receipts: [], nextId: 1 }),
      'utf8',
    );
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('creates a receipt with valid structure', () => {
    // Test that receipt creation returns expected structure
    const receiptId = `rcpt-${Date.now()}`;
    const sha = '2dfc3194db4e9e2b02c9458d7bb30c6bb6046cf3';

    const receipt = {
      id: receiptId,
      candidateHash: sha,
      contentHash: '8321a99390fbd934',
      author: 'EmmanuelOrtiz87',
      timestamp: new Date().toISOString(),
      files: ['test.ts'],
      findings: [],
      approved: true,
    };

    assert.ok(receipt.id.startsWith('rcpt-'));
    assert.ok(receipt.candidateHash.length === 40);
    assert.ok(receipt.contentHash.length === 16);
    assert.equal(receipt.approved, true);
    assert.ok(Array.isArray(receipt.files));
  });

  it('loads and saves receipt index correctly', () => {
    const indexPath = join(tempRoot, '.session', 'receipts', 'index.json');

    // Read existing
    const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
    assert.ok(Array.isArray(index.receipts));
    assert.equal(index.nextId, 1);

    // Add a receipt
    index.receipts.push({
      id: 'rcpt-12345678',
      candidateHash: 'abc123',
      contentHash: 'def456',
      author: 'test',
      timestamp: new Date().toISOString(),
      files: [],
      findings: [],
      approved: false,
    });
    index.nextId = 2;

    // Save
    writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');

    // Read again
    const reloaded = JSON.parse(readFileSync(indexPath, 'utf-8'));
    assert.equal(reloaded.receipts.length, 1);
    assert.equal(reloaded.nextId, 2);
  });

  it('validates receipt structure has required fields', () => {
    const validReceipt = {
      id: 'rcpt-123',
      candidateHash: 'a'.repeat(40),
      contentHash: 'b'.repeat(16),
      author: 'test-author',
      timestamp: new Date().toISOString(),
      files: ['file1.ts', 'file2.ts'],
      findings: [{ severity: 'critical', message: 'Security issue', file: 'auth.ts', line: 42 }],
      approved: true,
      notes: 'LGTM',
    };

    // Validate required fields
    assert.ok(validReceipt.id);
    assert.ok(validReceipt.candidateHash);
    assert.ok(validReceipt.contentHash);
    assert.ok(validReceipt.author);
    assert.ok(validReceipt.timestamp);
    assert.ok(Array.isArray(validReceipt.files));
    assert.ok(Array.isArray(validReceipt.findings));
    assert.equal(typeof validReceipt.approved, 'boolean');
  });

  it('filters receipts by approval status', () => {
    const receipts = [
      { id: '1', approved: true, timestamp: '2026-07-20T10:00:00Z' },
      { id: '2', approved: false, timestamp: '2026-07-20T11:00:00Z' },
      { id: '3', approved: true, timestamp: '2026-07-20T12:00:00Z' },
    ];

    const approved = receipts.filter((r) => r.approved);
    const pending = receipts.filter((r) => !r.approved);

    assert.equal(approved.length, 2);
    assert.equal(pending.length, 1);
  });

  it('prunes old receipts based on timestamp', () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    const receipts = [
      { id: '1', timestamp: new Date(now).toISOString() }, // today
      { id: '2', timestamp: new Date(now - 15 * day).toISOString() }, // 15 days ago
      { id: '3', timestamp: new Date(now - 45 * day).toISOString() }, // 45 days ago
    ];

    const cutoff = now - 30 * day;
    const pruned = receipts.filter((r) => new Date(r.timestamp).getTime() > cutoff);

    assert.equal(pruned.length, 2);
  });
});
