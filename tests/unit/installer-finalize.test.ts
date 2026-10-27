import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('checksum describes final bytes after signing, including unsigned builds', async () => {
  const { finalizeInstaller } = await import('../../src/installer/finalize.js');
  const root = mkdtempSync(join(tmpdir(), 'gv-sign-order-'));
  try {
    for (const status of ['signed', 'skipped'] as const) {
      const file = join(root, `${status}.exe`);
      writeFileSync(file, 'installer');
      const result = finalizeInstaller(file, () => {
        if (status === 'signed') appendFileSync(file, '-simulated-signature');
        return { status, detail: 'test fixture; no real certificate' };
      });
      const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
      assert.equal(result.checksum, hash);
      assert.equal(readFileSync(`${file}.sha256`, 'utf8'), `${hash}  ${status}.exe\n`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('failed signing cannot publish a checksum sidecar', async () => {
  const { finalizeInstaller } = await import('../../src/installer/finalize.js');
  const root = mkdtempSync(join(tmpdir(), 'gv-sign-failure-'));
  try {
    const file = join(root, 'failed.exe');
    writeFileSync(file, 'installer');
    assert.throws(() => finalizeInstaller(file, () => ({ status: 'failed', detail: 'signer failed' })), /signer failed/);
    assert.equal(existsSync(`${file}.sha256`), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
