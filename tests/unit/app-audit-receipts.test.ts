import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { appAuditFingerprint, withAppAuditReceipt } from '../../src/git/app-audit-receipts.js';

test('recibos: una corrección en A conserva B; dependencias, contrato y entorno invalidan', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-app-receipts-'));
  const files = [
    'apps/a/main.js',
    'apps/b/main.js',
    'packages/shared/api.ts',
    'config/app-validation-contracts.json',
  ];
  const put = (path: string, value: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  };
  const key = (app: string, environment = 'test-env') =>
    appAuditFingerprint(root, app, [{ kind: 'test', script: 'test' }], environment, files);
  try {
    for (const path of files) put(path, path.endsWith('.json') ? '{"version":1}' : 'original');
    const a = key('a');
    const b = key('b');
    put(files[0], 'correction');
    assert.notEqual(key('a'), a);
    assert.equal(key('b'), b);
    const correctedA = key('a');
    put(files[2], 'shared changed');
    assert.notEqual(key('a'), correctedA);
    assert.notEqual(key('b'), b);
    const sharedB = key('b');
    put('apps/b/.env.production', 'SECRET_TEST=synthetic');
    assert.notEqual(key('b'), sharedB);
    const localB = key('b');
    put(files[3], '{"version":1,"safeLocalTestScripts":{"a":{"test":"isolated"}}}');
    assert.equal(key('b'), localB);
    const beforeContract = key('a');
    put(files[3], '{"version":1,"safeLocalTestScripts":{"a":{"test":"new contract"}}}');
    assert.notEqual(key('a'), beforeContract);
    assert.notEqual(key('b', 'another-environment'), key('b'));
    assert.notEqual(
      appAuditFingerprint(root, 'b', [{ kind: 'build', script: 'build' }], 'test-env', files),
      key('b'),
    );
    put(files[1], "import '../a/main.js';");
    const dependentB = key('b');
    put(files[0], 'second correction');
    assert.notEqual(key('b'), dependentB);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('recibos: solo verdes verificables se reutilizan; nunca planes, fallos, corrupción ni mutaciones', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-app-receipts-'));
  const green = { app: 'a', status: 'PASS', checks: [{ kind: 'test', status: 'PASS' }] };
  let calls = 0;
  let fingerprint: string | null = 'a'.repeat(64);
  const run = (result = green) =>
    withAppAuditReceipt(
      root,
      'a',
      () => fingerprint,
      () => {
        calls++;
        return result;
      },
    );
  try {
    assert.equal(run().reused, false);
    assert.equal(run().reused, true);
    assert.equal(calls, 1);
    const path = join(root, '.runtime/app-audit-receipts/a', `${fingerprint}.json`);
    const expired = JSON.parse(readFileSync(path, 'utf8'));
    expired.at = new Date(0).toISOString();
    writeFileSync(path, JSON.stringify(expired));
    assert.equal(run().reused, false);
    fingerprint = 'b'.repeat(64);
    assert.equal(run({ ...green, status: 'FAIL' }).reused, false);
    assert.equal(run().reused, false);
    assert.equal(run().reused, true);
    writeFileSync(join(root, '.runtime/app-audit-receipts/a', `${fingerprint}.json`), '{bad');
    assert.equal(run().reused, false);
    fingerprint = 'c'.repeat(64);
    assert.equal(run({ ...green, checks: [{ kind: 'test', status: 'SKIP' }] }).reused, false);
    assert.equal(run().reused, false);
    fingerprint = 'e'.repeat(64);
    withAppAuditReceipt(
      root,
      'a',
      () => fingerprint,
      () => {
        fingerprint = 'd'.repeat(64);
        return green;
      },
    );
    assert.equal(run().reused, false);
    fingerprint = null;
    assert.equal(run().reused, false);
    assert.equal(run().reused, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
