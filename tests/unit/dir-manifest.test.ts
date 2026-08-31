#!/usr/bin/env node

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildManifest, walkFiles } from '../../src/tools/dir-manifest';

function makeTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'dir-manifest-'));
  // tree:
  //   a.txt
  //   sub/b.txt
  //   sub/deep/c.txt
  writeFileSync(join(root, 'a.txt'), 'hello');
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'sub', 'b.txt'), 'xx');
  mkdirSync(join(root, 'sub', 'deep'));
  writeFileSync(join(root, 'sub', 'deep', 'c.txt'), 'zzz');
  return root;
}

test('walks files recursively in deterministic order', () => {
  const root = makeTree();
  try {
    const files = walkFiles(root);
    assert.equal(files.length, 3);
    const rel = files.map((f) => f.slice(root.length + 1));
    const iA = rel.indexOf('a.txt');
    const iB = rel.indexOf(join('sub', 'b.txt'));
    const iC = rel.indexOf(join('sub', 'deep', 'c.txt'));
    assert.ok(iA < iB && iB < iC, `expected sorted order, got ${rel.join(', ')}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('builds manifest with historical schema and correct byte counts', () => {
  const root = makeTree();
  try {
    const m = buildManifest(root);
    assert.ok(m.created_at, 'created_at must be set');
    assert.equal(m.total_files, 3);
    assert.equal(m.total_bytes, 5 + 2 + 3);
    const byPath = new Map(m.files.map((f) => [f.path, f.bytes]));
    assert.equal(byPath.get('a.txt'), 5);
    assert.equal(byPath.get('sub/b.txt'), 2); // forward slashes normalized
    assert.equal(byPath.get('sub/deep/c.txt'), 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('serializes to JSON matching the GENTLE_VANGUARD_MASTER schema', () => {
  const root = makeTree();
  try {
    const m = buildManifest(root);
    const parsed = JSON.parse(JSON.stringify(m));
    assert.ok('created_at' in parsed);
    assert.ok(Array.isArray(parsed.files));
    assert.ok('path' in parsed.files[0]);
    assert.ok('bytes' in parsed.files[0]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
