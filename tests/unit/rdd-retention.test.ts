#!/usr/bin/env node
/**
 * Unit Tests: RDD retention (pruneWorkflows) — including DECOY tests
 *
 * Decoy principle (lesson from gentle-ai v2.5.0-rc.1's known gap): a guard is
 * only proven when a test shows it REJECTS the exact shape it must reject.
 * These tests attack pruneWorkflows with the files it must never touch and
 * the states it must close, not just the happy path.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pruneWorkflows } from '../../src/rdd/rdd-core.ts';

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 3_600_000).toISOString();
}

function wf(id: string, status: string, startedDaysAgo: number): string {
  return JSON.stringify({
    workflowId: id,
    status,
    classification: null,
    receipt: null,
    gates: {
      'post-apply': false,
      'pre-commit': false,
      'pre-push': false,
      'pre-pr': false,
      release: false,
    },
    startedAt: daysAgo(startedDaysAgo),
    completedAt: status === 'completed' || status === 'failed' ? daysAgo(startedDaysAgo) : null,
  });
}

function setup(): string {
  return mkdtempSync(join(tmpdir(), 'gv-rdd-retention-'));
}

test('prune: workflow completed >30d se elimina; reciente se retiene', () => {
  const dir = setup();
  try {
    writeFileSync(join(dir, 'old-completed.json'), wf('old', 'completed', 45));
    writeFileSync(join(dir, 'fresh-completed.json'), wf('fresh', 'completed', 3));
    const res = pruneWorkflows(30, dir);
    assert.deepStrictEqual(res.pruned, ['old-completed.json']);
    assert.ok(res.kept.includes('fresh-completed.json'));
    assert.ok(!existsSync(join(dir, 'old-completed.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DECOY: disable-log.jsonl y flag DISABLED jamás se tocan', () => {
  const dir = setup();
  try {
    writeFileSync(join(dir, 'old-completed.json'), wf('old', 'completed', 90));
    writeFileSync(join(dir, 'disable-log.jsonl'), '{"action":"disable"}\n');
    writeFileSync(join(dir, 'DISABLED'), '');
    const res = pruneWorkflows(30, dir);
    assert.ok(existsSync(join(dir, 'disable-log.jsonl')), 'audit log sobrevive');
    assert.ok(existsSync(join(dir, 'DISABLED')), 'kill-switch flag sobrevive');
    assert.ok(!res.pruned.some((f) => !f.endsWith('.json')), 'solo .json en pruned');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DECOY: review estancada >30d se cierra en evento terminal (failed), no se borra', () => {
  const dir = setup();
  try {
    writeFileSync(join(dir, 'stuck-reviewing.json'), wf('stuck', 'reviewing', 40));
    const res = pruneWorkflows(30, dir);
    assert.ok(!res.pruned.includes('stuck-reviewing.json'), 'no se borra: queda como auditoría');
    const closed = JSON.parse(readFileSync(join(dir, 'stuck-reviewing.json'), 'utf-8'));
    assert.strictEqual(closed.status, 'failed', 'cerrada en estado terminal');
    assert.ok(closed.completedAt, 'completedAt fijado');
    assert.ok(
      res.kept.some((k) => k.includes('aborted-stale')),
      'reportada como aborted-stale',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DECOY: archivo .json ilegible nunca se borra a ciegas', () => {
  const dir = setup();
  try {
    writeFileSync(join(dir, 'corrupt.json'), '{not json');
    const res = pruneWorkflows(30, dir);
    assert.ok(!res.pruned.includes('corrupt.json'), 'ilegible no se borra');
    assert.ok(existsSync(join(dir, 'corrupt.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('prune: directorio inexistente → resultado vacío sin error', () => {
  const res = pruneWorkflows(30, join(tmpdir(), 'no-existe-gv-test'));
  assert.deepStrictEqual(res.pruned, []);
  assert.deepStrictEqual(res.kept, []);
});
