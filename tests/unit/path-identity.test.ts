#!/usr/bin/env node
/**
 * Unit Tests: path-identity — Windows path-identity-correct comparison
 *
 * Absorbed from gentle-ai v2.5.0-rc.3 (#3888) and v2.4.0 Windows lane.
 * Verifies: canonical form, samePath case/separator folding, isWithinRoot
 * boundary rejection (the `C:\repo-evil` vs `C:\repo` startsWith bug), and
 * safeResolveWithin as a drop-in typed safePath replacement.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { sep } from 'node:path';
import {
  canonicalPath,
  samePath,
  isWithinRoot,
  safeResolveWithin,
} from '../../src/core/path-identity.ts';

const WIN = process.platform === 'win32';
const root = WIN ? 'C:\\repo' : '/repo';

test('samePath folds separator differences', () => {
  const a = WIN ? 'C:\\repo\\src' : '/repo/src';
  const b = WIN ? 'C:/repo/src' : '/repo/src/';
  assert.ok(samePath(a, b), `${a} and ${b} must be one identity`);
});

test('samePath resolves relative segments before comparing', () => {
  assert.ok(samePath(`${root}${sep}a${sep}..`, root));
});

test('samePath is case-insensitive on win32/mac, sensitive elsewhere by default', () => {
  const a = WIN ? 'C:\\Repo\\SRC' : '/Repo/SRC';
  const b = WIN ? 'c:\\repo\\src' : '/repo/src';
  if (WIN || process.platform === 'darwin') {
    assert.ok(samePath(a, b));
  } else {
    assert.ok(!samePath(a, b));
  }
  // opt-in case-insensitive works everywhere
  assert.ok(samePath(a, b, { caseInsensitive: true }));
});

test('isWithinRoot rejects sibling prefix (the startsWith boundary bug)', () => {
  const evil = WIN ? 'C:\\repo-evil' : '/repo-evil';
  assert.ok(!isWithinRoot(evil, root), 'sibling directory must NOT pass as within-root');
  assert.ok(isWithinRoot(root, root), 'root itself is within root');
});

test('isWithinRoot accepts real children', () => {
  const child = WIN ? 'C:\\REPO\\src\\deep\\file.ts' : '/repo/src/deep/file.ts';
  assert.ok(isWithinRoot(child, root), 'child (case-mixed on win32) is within root');
});

test('canonicalPath strips trailing separators but preserves drive root', () => {
  if (WIN) {
    assert.equal(canonicalPath('C:\\'), 'c:\\');
    assert.equal(canonicalPath('C:\\a\\b\\'), canonicalPath('C:\\a\\b'));
    // Bare `C:` is drive-RELATIVE on Windows (current dir on that drive) —
    // Node resolve() semantics preserved, identity = cwd on that drive.
    if (process.cwd().toLowerCase().startsWith('c:')) {
      assert.equal(canonicalPath('C:'), canonicalPath(process.cwd()));
    }
  } else {
    assert.equal(canonicalPath('/'), '/');
    assert.equal(canonicalPath('/a/b/'), canonicalPath('/a/b'));
  }
});

test('safeResolveWithin blocks traversal and admits legit paths', () => {
  const base = WIN ? 'C:\\repo\\store' : '/repo/store';
  assert.ok(safeResolveWithin('ok/file.json', base) !== null);
  // .. resolves above base → must be refused (identity-correct, not stringly)
  assert.equal(safeResolveWithin('../escape.txt', base), null);
});
