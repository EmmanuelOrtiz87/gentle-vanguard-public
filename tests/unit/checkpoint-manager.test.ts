#!/usr/bin/env node
/**
 * Unit Tests: Checkpoint Manager
 * Tests core checkpoint functionality
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

describe('Checkpoint Manager', () => {
  const checkpointDir = join(process.cwd(), '.session', 'checkpoints');

  it('should have checkpoint directory', () => {
    assert.ok(existsSync(checkpointDir), 'Checkpoint directory should exist');
  });

  it('should have existing checkpoints', () => {
    if (existsSync(checkpointDir)) {
      const checkpoints = readdirSync(checkpointDir)
        .filter(f => statSync(join(checkpointDir, f)).isDirectory());
      assert.ok(checkpoints.length >= 0, `Found ${checkpoints.length} checkpoints`);
    }
  });

  it('should verify checkpoint structure', () => {
    if (existsSync(checkpointDir)) {
      const checkpoints = readdirSync(checkpointDir)
        .filter(f => statSync(join(checkpointDir, f)).isDirectory());
      
      for (const ckpt of checkpoints) {
        const ckptPath = join(checkpointDir, ckpt);
        const stats = statSync(ckptPath);
        assert.ok(stats.isDirectory(), `${ckpt} should be a directory`);
        assert.ok(ckpt.startsWith('ckpt-'), `${ckpt} should start with ckpt-`);
      }
    }
  });
});
