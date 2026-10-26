#!/usr/bin/env node
/**
 * Unit Tests: Checkpoint Manager
 * Verifies the TS checkpoint manager contract using a temp root.
 * Self-contained: does not depend on the session pipeline having run beforehand.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

const ROOT = join(import.meta.dirname, '..', '..');
const SRC = pathToFileURL(join(ROOT, 'src', 'ops', 'checkpoint-manager.ts')).href;

function makeTempRoot(): string {
  const dir = join(tmpdir(), `ckpt-test-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`);
  mkdirSync(join(dir, '.session'), { recursive: true });
  return dir;
}

describe('Checkpoint Manager', () => {
  it('checkpoints state without copying external repos or dated evidence archives', async () => {
    const mod = await import(SRC);
    const root = makeTempRoot();
    try {
      for (const file of ['session-current.json', 'context-log/run/.state.json', 'evolution/learning.json',
        'external-repos/vendor/source.ts', 'evolution-2026-10-16/security/image.tar']) {
        const target = join(root, '.session', file);
        mkdirSync(join(target, '..'), { recursive: true });
        writeFileSync(target, 'preserve me');
      }
      const created = mod.createCheckpoint(root, { checkpointId: 'ckpt-scope' });
      assert.equal(created.count, 3);
      assert.equal(mod.verifyCheckpoint(root, created.checkpointId).status, 'INTACT');
      assert.equal(readFileSync(join(root, '.session/evolution-2026-10-16/security/image.tar'), 'utf8'), 'preserve me');
      assert.equal(readFileSync(join(root, '.session/external-repos/vendor/source.ts'), 'utf8'), 'preserve me');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps user artifacts and context while leaving historical telemetry in place', async () => {
    const mod = await import(SRC);
    const root = makeTempRoot();
    try {
      const retained = ['session-current.json', 'context-log/current/.state.json',
        'evolution/learning.json', 'artifacts/finance/user-report.json', 'artifacts/health/user-report.json'];
      const telemetry = ['live-metrics/old-session.json', 'contract-results/check-old.json', 'health/db-health-old.json'];
      for (const file of [...retained, ...telemetry]) {
        const target = join(root, '.session', file);
        mkdirSync(join(target, '..'), { recursive: true });
        writeFileSync(target, 'original');
      }
      const created = mod.createCheckpoint(root, { checkpointId: 'ckpt-state-only', prune: false });
      assert.deepEqual(created.files.map((file: { path: string }) => file.path.replaceAll('\\', '/')).sort(), retained.sort());
      assert.equal(mod.verifyCheckpoint(root, created.checkpointId).status, 'INTACT');
      for (const file of telemetry) assert.equal(readFileSync(join(root, '.session', file), 'utf8'), 'original');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('never replaces an existing checkpoint when the same ID is requested', async () => {
    const mod = await import(SRC);
    const root = makeTempRoot();
    try {
      writeFileSync(join(root, '.session/state.json'), 'first');
      mod.createCheckpoint(root, { checkpointId: 'ckpt-unique' });
      writeFileSync(join(root, '.session/state.json'), 'second');
      assert.throws(() => mod.createCheckpoint(root, { checkpointId: 'ckpt-unique' }));
      assert.equal(readFileSync(join(root, '.session/checkpoints/ckpt-unique/state.json'), 'utf8'), 'first');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('allows checkpoint verification without pruning previous recovery points', async () => {
    const mod = await import(SRC);
    const root = makeTempRoot();
    try {
      for (let index = 0; index < 5; index++) {
        mod.createCheckpoint(root, { checkpointId: `ckpt-retain-${index}`, prune: false });
      }
      assert.equal(mod.listCheckpoints(root).length, 5);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('module exports the expected contract', async () => {
    const mod = await import(SRC);
    for (const fn of [
      'createCheckpoint',
      'listCheckpoints',
      'verifyCheckpoint',
      'restoreCheckpoint',
      'pruneCheckpoints',
    ]) {
      assert.equal(typeof (mod as any)[fn], 'function', `${fn} should be exported`);
    }
  });

  it('restores interrupted session files from an intact checkpoint', async () => {
    const mod = await import(SRC);
    const root = makeTempRoot();
    try {
      const statePath = join(root, '.session', 'session-current.json');
      writeFileSync(statePath, '{"status":"active","step":4}');
      mod.createCheckpoint(root, { checkpointId: 'ckpt-restore-001' });
      writeFileSync(statePath, '{"status":"corrupted"}');

      const restored = mod.restoreCheckpoint(root, 'ckpt-restore-001');
      assert.equal(restored.status, 'INTACT');
      assert.equal(restored.restored, 1);
      assert.equal(readFileSync(statePath, 'utf8'), '{"status":"active","step":4}');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('createCheckpoint creates the checkpoint directory under temp root', async () => {
    const mod = await import(SRC);
    const root = makeTempRoot();
    try {
      const manifest = mod.createCheckpoint(root, { checkpointId: 'ckpt-test-001' });
      assert.ok(manifest.checkpointId, 'manifest should have checkpointId');
      const ckptDir = join(root, '.session', 'checkpoints', 'ckpt-test-001');
      assert.ok(existsSync(ckptDir), 'checkpoint directory should exist');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('listCheckpoints returns an array (empty when none)', async () => {
    const mod = await import(SRC);
    const root = makeTempRoot();
    try {
      const list = mod.listCheckpoints(root);
      assert.ok(Array.isArray(list), 'list should be an array');
      assert.equal(list.length, 0, 'should be empty without checkpoints');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('createCheckpoint followed by listCheckpoints shows the checkpoint', async () => {
    const mod = await import(SRC);
    const root = makeTempRoot();
    try {
      mod.createCheckpoint(root, { checkpointId: 'ckpt-test-002' });
      const list = mod.listCheckpoints(root);
      assert.ok(
        list.some((c: any) => c.id === 'ckpt-test-002'),
        'checkpoint should appear in list',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
