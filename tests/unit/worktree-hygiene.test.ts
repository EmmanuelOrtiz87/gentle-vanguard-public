/**
 * BL-2026-11-16 — clasificación del worktree-hygiene y limpieza segura.
 * Patrón recurrente: Copilot opera en worktrees y quedan candidatos sin
 * homologar; la limpieza solo procede con rama fusionada y árbol limpio.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { classify, parseWorktrees, collectWorktrees } from '../../src/ops/worktree-hygiene.js';

const git = (args: string[], cwd: string) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} falló: ${r.stderr}`);
  return (r.stdout || '').trim();
};

test('parseWorktrees lee porcelain: primary, branch y detached', () => {
  const porcelain = [
    'worktree C:/repo',
    'HEAD abc123',
    'branch refs/heads/main',
    '',
    'worktree C:/copilot/otro',
    'HEAD def456',
    'detached',
    '',
  ].join('\n');
  const parsed = parseWorktrees(porcelain);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].branch, 'refs/heads/main');
  assert.equal(parsed[1].branch, null);
});

test('clasificación: candidato-pendiente gana sobre merged (trabajo sin commit)', () => {
  assert.equal(
    classify({ path: 'w', head: 'h', branch: 'b', primary: false, merged: true, dirtyCount: 5 }),
    'candidato-pendiente',
  );
});

test('clasificación: dirtyCount=-1 (inaccesible) nunca es homologado', () => {
  assert.equal(
    classify({ path: 'w', head: 'h', branch: 'b', primary: false, merged: true, dirtyCount: -1 }),
    'desconocido',
  );
});

test('clasificación: homologado = rama fusionada y limpio; stale = detached fusionado', () => {
  assert.equal(
    classify({ path: 'w', head: 'h', branch: 'b', primary: false, merged: true, dirtyCount: 0 }),
    'homologado',
  );
  assert.equal(
    classify({ path: 'w', head: 'h', branch: null, primary: false, merged: true, dirtyCount: 0 }),
    'stale',
  );
  assert.equal(
    classify({ path: 'w', head: 'h', branch: null, primary: false, merged: false, dirtyCount: 0 }),
    'desconocido',
  );
  assert.equal(
    classify({ path: 'w', head: 'h', branch: 'b', primary: false, merged: false, dirtyCount: 0 }),
    'candidato-pendiente',
  );
});

test('end-to-end en repo temporal: worktree fusionado y limpio clasifica homologado', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-worktree-hygiene-'));
  let linked = '';
  try {
    git(['init'], root);
    git(['config', 'user.email', 't@t.local'], root);
    git(['config', 'user.name', 'T'], root);
    writeFileSync(join(root, 'a.txt'), 'uno\n');
    git(['add', '.'], root);
    git(['commit', '-m', 'init'], root);
    git(['worktree', 'add', join(root, 'linked'), '-b', 'feature/x'], root);
    linked = join(root, 'linked');
    writeFileSync(join(linked, 'b.txt'), 'dos\n');
    git(['add', '.'], linked);
    git(['commit', '-m', 'feature'], linked);
    git(['merge', '-q', 'feature/x'], root); // fusionada a main

    const orig = process.cwd();
    process.chdir(root);
    try {
      const entries = collectWorktrees();
      const linkedEntry = entries.find(
        (e: { path: string }) => resolve(e.path) === resolve(linked),
      );
      assert.ok(linkedEntry, 'worktree linked listado');
      assert.equal(linkedEntry.merged, true);
      assert.equal(linkedEntry.dirtyCount, 0);
      assert.equal(linkedEntry.clazz, 'homologado');
    } finally {
      process.chdir(orig);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
