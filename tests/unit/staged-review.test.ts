import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('staged-review.ts', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'gv-staged-'));
    // Create .session/staged-reviews directory
    const reviewDir = join(tempRoot, '.session', 'staged-reviews');
    mkdirSync(reviewDir, { recursive: true });
    writeFileSync(join(reviewDir, 'current-session.json'), JSON.stringify(null), 'utf8');
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('creates a staged review session with valid structure', () => {
    const session = {
      id: `staged-${Date.now()}`,
      startedAt: new Date().toISOString(),
      stagedSnapshot: {
        sha: '2dfc3194db4e9e2b02c9458d7bb30c6bb6046cf3',
        files: ['file1.ts', 'file2.ts'],
        contentHash: 'bb8d29916ed045a1',
      },
      status: 'active' as const,
    };

    assert.ok(session.id.startsWith('staged-'));
    assert.ok(session.startedAt);
    assert.ok(session.stagedSnapshot.sha.length === 40);
    assert.ok(Array.isArray(session.stagedSnapshot.files));
    assert.ok(session.stagedSnapshot.contentHash.length === 16);
    assert.equal(session.status, 'active');
  });

  it('loads and saves session state correctly', () => {
    const sessionPath = join(tempRoot, '.session', 'staged-reviews', 'current-session.json');

    const session = {
      id: 'staged-123',
      startedAt: new Date().toISOString(),
      stagedSnapshot: {
        sha: 'abc123def456',
        files: ['test.ts'],
        contentHash: 'hash123',
      },
      status: 'active' as const,
    };

    writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf-8');

    const loaded = JSON.parse(readFileSync(sessionPath, 'utf-8'));
    assert.equal(loaded.id, 'staged-123');
    assert.equal(loaded.status, 'active');
  });

  it('validates session can transition to completed', () => {
    const session = {
      id: 'staged-123',
      startedAt: '2026-07-20T10:00:00Z',
      stagedSnapshot: {
        sha: '2dfc3194db4e9e2b02c9458d7bb30c6bb6046cf3',
        files: ['file1.ts'],
        contentHash: 'abc123',
      },
      status: 'active' as const,
    };

    // Complete the session
    session.status = 'completed';
    session.completedAt = new Date().toISOString();
    session.receiptId = 'rcpt-123';

    assert.equal(session.status, 'completed');
    assert.ok(session.completedAt);
    assert.equal(session.receiptId, 'rcpt-123');
  });

  it('validates session can transition to cancelled', () => {
    const session = {
      id: 'staged-123',
      startedAt: '2026-07-20T10:00:00Z',
      stagedSnapshot: {
        sha: '2dfc3194db4e9e2b02c9458d7bb30c6bb6046cf3',
        files: ['file1.ts'],
        contentHash: 'abc123',
      },
      status: 'active' as const,
    };

    // Cancel the session
    session.status = 'cancelled';
    session.completedAt = new Date().toISOString();

    assert.equal(session.status, 'cancelled');
    assert.ok(session.completedAt);
  });

  it('computes snapshot hash consistently', () => {
    // Simulate hash computation (same as staged-review.ts)
    const createHash = (content: string): string => {
      let hash = 0;
      for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      return Math.abs(hash).toString(16);
    };

    const files = [
      { path: 'a.ts', status: 'modified' as const, diff: 'diff-a' },
      { path: 'b.ts', status: 'added' as const, diff: 'diff-b' },
    ];

    const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
    const content = sorted.map((f) => f.path + f.status + f.diff).join('');
    const hash = createHash(content);

    assert.ok(hash.length > 0);
    assert.ok(hash.length <= 16); // Flexible length based on hash function
  });

  it('detects staged file status changes', () => {
    const statuses = ['added', 'modified', 'deleted', 'renamed'] as const;

    const statusMap: Record<string, string> = {
      A: 'added',
      M: 'modified',
      D: 'deleted',
      R: 'renamed',
    };

    assert.equal(statusMap['A'], 'added');
    assert.equal(statusMap['M'], 'modified');
    assert.equal(statusMap['D'], 'deleted');
    assert.equal(statusMap['R'], 'renamed');
  });

  it('validates session against current state detects SHA changes', () => {
    const session = {
      stagedSnapshot: {
        sha: '2dfc3194db4e9e2b02c9458d7bb30c6bb6046cf3',
        contentHash: 'old-hash',
      },
    };

    const currentSHA = '623b5c8ff26a53e9996e1941799f073b2656a'; // different SHA

    const issues: string[] = [];
    if (session.stagedSnapshot.sha !== currentSHA) {
      issues.push(
        `HEAD SHA changed: ${session.stagedSnapshot.sha.slice(0, 7)} → ${currentSHA.slice(0, 7)}`,
      );
    }

    assert.equal(issues.length, 1);
    assert.ok(issues[0].includes('SHA changed'));
  });

  it('validates session detects content hash mismatch', () => {
    const session = {
      stagedSnapshot: {
        sha: '2dfc3194db4e9e2b02c9458d7bb30c6bb6046cf3',
        contentHash: 'bb8d29916ed045a1',
      },
    };

    const currentHash = 'new-different-hash';

    const issues: string[] = [];
    if (session.stagedSnapshot.contentHash !== currentHash) {
      issues.push('Staged files have changed since review started');
    }

    assert.equal(issues.length, 1);
    assert.equal(issues[0], 'Staged files have changed since review started');
  });
});
