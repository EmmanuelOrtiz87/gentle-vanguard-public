#!/usr/bin/env node
/**
 * Unit Tests: Reviewed Boundary (RDD-lite delta base)
 *
 * Feature-doc: docs/features/GB-2026-10-28-reviewed-boundary-absorption.md
 * Absorbe gentle-ai v4.3.1 (#5654 boundary-advance + #5635 upstream-first).
 * Guard: el estado es derivable (no-datos-irrecuperables); corrupción =>
 * null (comportamiento fail-open honesto, base upstream).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  advanceBoundary,
  boundaryStatus,
  clearBoundary,
  getDeltaBase,
  readBoundary,
  shaExists,
  STATE_RELATIVE_PATH,
} from '../../src/review/reviewed-boundary.ts';

function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gv-reviewed-boundary-'));
  const g = (args: string[]) => {
    const r = spawnGit(dir, args);
    assert.strictEqual(r.status, 0, `git ${args.join(' ')} debe salir limpio: ${r.stderr}`);
    return r.stdout.trim();
  };
  g(['init']);
  g(['config', 'user.email', 'test@gentle-vanguard.local']);
  g(['config', 'user.name', 'GV Test']);
  writeFileSync(join(dir, 'a.txt'), 'v1\n', 'utf-8');
  g(['add', 'a.txt']);
  g(['commit', '-m', 'commit 1']);
  return dir;
}

function commitOne(dir: string): string {
  writeFileSync(join(dir, `n-${Date.now()}.txt`), 'x\n', 'utf-8');
  spawnGit(dir, ['add', '.']);
  const r = spawnGit(dir, ['commit', '-m', `commit ${Date.now()}`]);
  assert.strictEqual(r.status, 0, r.stderr);
  const h = spawnGit(dir, ['rev-parse', 'HEAD']);
  assert.strictEqual(h.status, 0, h.stderr);
  return h.stdout.trim();
}

interface GitResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function spawnGit(dir: string, args: string[]): GitResult {
  // Sincrónico simple: tests, no hot path. argv directo.
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf-8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

test('advance+read+clear roundtrip con repo git real', () => {
  const root = makeTempRepo();
  const stateFile = join(root, STATE_RELATIVE_PATH);
  try {
    const sha = spawnGit(root, ['rev-parse', 'HEAD']).stdout.trim();
    const st = advanceBoundary(sha, 'review aceptada', { root, stateFile });
    assert.strictEqual(st.sha, sha);
    assert.ok(!Number.isNaN(Date.parse(st.acknowledgedAt)), 'acknowledgedAt es ISO válido');
    const read = readBoundary({ root, stateFile });
    assert.deepStrictEqual(read, st);

    // fail-open honesto: JSON corrupto => null (el estado es derivable, no alto-riesgo)
    writeFileSync(stateFile, '{corrupt', 'utf-8');
    assert.strictEqual(readBoundary({ root, stateFile }), null);

    assert.strictEqual(clearBoundary({ root, stateFile }), true);
    assert.strictEqual(clearBoundary({ root, stateFile }), false, 'segundo clear ya no elimina');
    assert.strictEqual(readBoundary({ root, stateFile }), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('shaExists falla closed con sha basura y advanceBoundary rechaza SHA inexistente', () => {
  const root = makeTempRepo();
  const stateFile = join(root, STATE_RELATIVE_PATH);
  try {
    assert.strictEqual(shaExists(root, 'zzzz'), false);
    assert.strictEqual(shaExists(root, '../../etc/passwd'), false);
    assert.throws(() => advanceBoundary('deadbeefdead', undefined, { root, stateFile }));
    assert.strictEqual(readBoundary({ root, stateFile }), null, 'nada se escribió en sha inválido');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("delta base: boundary prevalece; sin boundary falla a 'none' sin upstream (S5)", () => {
  const root = makeTempRepo();
  const stateFile = join(root, STATE_RELATIVE_PATH);
  try {
    // Sin boundary y sin upstream -> none (repo temporal sin origin)
    assert.deepStrictEqual(getDeltaBase({ root, stateFile }), { base: null, source: 'none' });
    const st = boundaryStatus({ root, stateFile });
    assert.strictEqual(st.source, 'none');
    assert.strictEqual(st.deltaCount, null);

    // Primer commit => HEAD. Ack a HEAD -> delta = 0 pendientes.
    const sha1 = spawnGit(root, ['rev-parse', 'HEAD']).stdout.trim();
    advanceBoundary(sha1, 'ok', { root, stateFile });
    let s = boundaryStatus({ root, stateFile });
    assert.strictEqual(s.source, 'boundary');
    assert.strictEqual(s.deltaCount, 0);

    // Segundo commit => 1 pendiente de review desde el boundary.
    commitOne(root);
    s = boundaryStatus({ root, stateFile });
    assert.strictEqual(s.source, 'boundary');
    assert.strictEqual(s.deltaCount, 1);
    assert.strictEqual(s.recentCommits.length, 1);
    assert.ok(s.head, 'head presente');
    assert.notStrictEqual(s.head, s.base);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('advanceBoundary resuelve HEAD y nombres de rama (ACK por defecto del CLI)', () => {
  const root = makeTempRepo();
  const stateFile = join(root, STATE_RELATIVE_PATH);
  try {
    const head = spawnGit(root, ['rev-parse', 'HEAD']).stdout.trim();

    // El CLI hace `ack` sin positional => pasa 'HEAD'. Debe resolver, no fallar
    // por el filtro hex de shaExists.
    const st = advanceBoundary('HEAD', 'ack por defecto', { root, stateFile });
    assert.strictEqual(st.sha, head, 'HEAD se resuelve al sha completo');

    // Un nombre de rama también resuelve al commit apuntado.
    const branch = spawnGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
    const st2 = advanceBoundary(branch, 'por rama', { root, stateFile });
    assert.strictEqual(st2.sha, head);
    assert.strictEqual(readBoundary({ root, stateFile })?.sha, head);

    // Revisión inexistente: sigue fail-closed.
    assert.throws(() => advanceBoundary('nope-not-a-ref', undefined, { root, stateFile }));
    assert.strictEqual(readBoundary({ root, stateFile })?.sha, head, 'no pisó el boundary válido');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
