import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const { findLatestInstaller, sha256 } = await import('../../src/cli/verify-installer.js');

test('findLatestInstaller returns null when dist dir does not exist', () => {
  const missing = join(tmpdir(), `gv-verify-test-missing-${Date.now()}`);
  assert.equal(findLatestInstaller(missing), null);
});

test('findLatestInstaller returns null when no installer present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gv-verify-test-empty-'));
  try {
    assert.equal(findLatestInstaller(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('findLatestInstaller picks the highest-sorted version and pairs sha256 file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gv-verify-test-pick-'));
  try {
    for (const name of ['Gentle-Vanguard-Setup-3.8.1.exe', 'Gentle-Vanguard-Setup-3.9.0.exe']) {
      writeFileSync(join(dir, name), 'fake');
    }
    const found = findLatestInstaller(dir);
    assert.ok(found);
    assert.equal(found.exe, join(dir, 'Gentle-Vanguard-Setup-3.9.0.exe'));
    assert.equal(found.sha256File, `${found.exe}.sha256`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sha256 matches node crypto digest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gv-verify-test-hash-'));
  try {
    const file = join(dir, 'sample.bin');
    writeFileSync(file, 'gentle-vanguard-checksum-sample');
    const expected = createHash('sha256').update(readFileSync(file)).digest('hex');
    assert.equal(sha256(file), expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
