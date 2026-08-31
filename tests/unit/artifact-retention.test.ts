import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runArtifactRetention } from '../../src/session/artifact-retention.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'gv-retention-'));
  mkdirSync(join(root, '.runtime'), { recursive: true });
  mkdirSync(join(root, '.session', 'snapshots'), { recursive: true });
  mkdirSync(join(root, 'protected'), { recursive: true });
  const old = '2026-07-01T00:00:00.000Z';
  writeFileSync(join(root, '.runtime', 'old.tmp'), 'old');
  writeFileSync(join(root, '.runtime', 'new.tmp'), 'new');
  writeFileSync(join(root, '.runtime', 'unmanifested.tmp'), 'keep');
  writeFileSync(
    join(root, '.runtime', 'retention-manifest.json'),
    JSON.stringify({
      version: '1.0.0',
      owner: 'session-close',
      entries: [
        { path: '.runtime/old.tmp', owner: 'session-close', createdAt: old, temporary: true },
        {
          path: '.runtime/new.tmp',
          owner: 'session-close',
          createdAt: '2026-08-20T00:00:00.000Z',
          temporary: true,
        },
        {
          path: '.session/snapshots/required.json',
          owner: 'session-close',
          createdAt: old,
          temporary: true,
          required: true,
        },
        { path: 'protected/secret.enc', owner: 'session-close', createdAt: old, temporary: true },
      ],
    }),
  );
  writeFileSync(join(root, '.session', 'snapshots', 'required.json'), 'keep');
  writeFileSync(join(root, 'protected', 'secret.enc'), 'keep');
  return root;
}

test('retention is dry-run by default and protects denied paths', () => {
  const root = fixture();
  const report = runArtifactRetention({
    workspaceRoot: root,
    now: new Date('2026-08-29T00:00:00.000Z'),
    persistAudit: false,
  });
  assert.equal(report.mode, 'dry-run');
  assert.deepEqual(report.deleted, []);
  assert.equal(existsSync(join(root, '.runtime', 'old.tmp')), true);
  assert.equal(report.candidates[0]?.path, '.runtime/old.tmp');
  assert.ok(report.skipped.some((item) => item.reason === 'protected'));
});

test('apply requires automated authorization', () => {
  const root = fixture();
  const report = runArtifactRetention({
    workspaceRoot: root,
    now: new Date('2026-08-29T00:00:00.000Z'),
    apply: true,
    persistAudit: false,
  });
  assert.equal(report.mode, 'dry-run');
  assert.equal(existsSync(join(root, '.runtime', 'old.tmp')), true);
});

test('authorized apply removes only expired manifest entries', () => {
  const root = fixture();
  const report = runArtifactRetention({
    workspaceRoot: root,
    now: new Date('2026-08-29T00:00:00.000Z'),
    apply: true,
    authorizedAutomatedClose: true,
    persistAudit: false,
  });
  assert.equal(report.mode, 'apply');
  assert.deepEqual(report.deleted, ['.runtime/old.tmp']);
  assert.equal(existsSync(join(root, '.runtime', 'old.tmp')), false);
  assert.equal(existsSync(join(root, '.runtime', 'new.tmp')), true);
  assert.equal(existsSync(join(root, '.runtime', 'unmanifested.tmp')), true);
  assert.equal(existsSync(join(root, 'protected', 'secret.enc')), true);
  assert.equal(existsSync(join(root, '.session', 'snapshots', 'required.json')), true);
});
