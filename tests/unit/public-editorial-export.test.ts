import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { syncPublicEditorialSources } from '../../src/infrastructure/public-source-boundary.js';

const root = resolve(import.meta.dirname, '../..');
const files = [
  'providers/whisper-api.ts',
  'providers/subtitles.ts',
  'types.ts',
  'types/whisper-node.d.ts',
];
const relative = 'packages/gv-shorts-core/src';

test('exports only the approved editorial dependency closure, byte-identically and idempotently', () => {
  const target = mkdtempSync(join(tmpdir(), 'gv-editorial-export-'));
  try {
    syncPublicEditorialSources(root, target);
    syncPublicEditorialSources(root, target);
    for (const file of files) {
      assert.deepEqual(
        readFileSync(join(target, relative, file)),
        readFileSync(join(root, relative, file)),
      );
    }
    assert.deepEqual(readdirSync(join(target, relative)).sort(), [
      'providers',
      'types',
      'types.ts',
    ]);
    assert.deepEqual(readdirSync(join(target, relative, 'providers')).sort(), [
      'subtitles.ts',
      'whisper-api.ts',
    ]);
    assert.deepEqual(readdirSync(join(target, relative, 'types')), ['whisper-node.d.ts']);
    assert.deepEqual(readdirSync(join(target, 'packages/gv-shorts-core')), ['src']);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('missing canonical input fails before replacing any existing public file', () => {
  const temp = mkdtempSync(join(tmpdir(), 'gv-editorial-missing-'));
  const source = join(temp, 'source');
  const target = join(temp, 'target');
  try {
    for (const file of files.slice(0, -1)) {
      const destination = join(source, relative, file);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, 'new');
    }
    const existing = join(target, relative, files[0]!);
    mkdirSync(dirname(existing), { recursive: true });
    writeFileSync(existing, 'preserve');
    assert.throws(
      () => syncPublicEditorialSources(source, target),
      /Public editorial source missing/,
    );
    assert.equal(readFileSync(existing, 'utf8'), 'preserve');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
