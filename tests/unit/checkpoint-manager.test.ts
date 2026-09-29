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
