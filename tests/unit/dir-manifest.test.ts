import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildManifest, walkFiles } from '../../src/dir-manifest';

describe('dir-manifest', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dir-manifest-'));
    // tree:
    //   a.txt
    //   sub/b.txt
    //   sub/deep/c.txt
    writeFileSync(join(root, 'a.txt'), 'hello');
    mkdirSync(join(root, 'sub'));
    writeFileSync(join(root, 'sub', 'b.txt'), 'xx');
    mkdirSync(join(root, 'sub', 'deep'));
    writeFileSync(join(root, 'sub', 'deep', 'c.txt'), 'zzz');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('walks files recursively in deterministic order', () => {
    const files = walkFiles(root);
    expect(files).toHaveLength(3);
    // sorted: a.txt < sub/b.txt < sub/deep/c.txt (localeCompare on full paths)
    const rel = files.map((f) => f.slice(root.length + 1));
    expect(rel.indexOf('a.txt')).toBeLessThan(rel.indexOf(join('sub', 'b.txt')));
    expect(rel.indexOf(join('sub', 'b.txt'))).toBeLessThan(
      rel.indexOf(join('sub', 'deep', 'c.txt')),
    );
  });

  it('builds manifest with historical schema and correct byte counts', () => {
    const m = buildManifest(root);
    expect(m.created_at).toBeTruthy();
    expect(m.total_files).toBe(3);
    expect(m.total_bytes).toBe(5 + 2 + 3);
    const byPath = new Map(m.files.map((f) => [f.path, f.bytes]));
    expect(byPath.get('a.txt')).toBe(5);
    expect(byPath.get('sub/b.txt')).toBe(2); // forward slashes normalized
    expect(byPath.get('sub/deep/c.txt')).toBe(3);
  });

  it('serializes to valid JSON matching the GENTLE_VANGUARD_MASTER schema', () => {
    const m = buildManifest(root);
    const parsed = JSON.parse(JSON.stringify(m));
    expect(Object.keys(parsed)).toEqual(
      expect.arrayContaining(['created_at', 'files']),
    );
    expect(parsed.files[0]).toHaveProperty('path');
    expect(parsed.files[0]).toHaveProperty('bytes');
  });
});

describe('dir-manifest CLI entry guard', () => {
  it('does not auto-run main() when imported as a module', async () => {
    // Importing the module must not trigger main(); if it did, process.exit
    // would have been called during import above. Sanity-check exports exist.
    const mod = await import('../../src/dir-manifest');
    expect(typeof mod.buildManifest).toBe('function');
    expect(typeof mod.walkFiles).toBe('function');
  });
});
