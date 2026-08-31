import { test } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDaemonPidFile, writeDaemonPidFile } from '../../src/core/timeout-monitor.ts';

test('timeout monitor owns its pidfile and removes only its own PID', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gv-timeout-monitor-'));
  const pidFile = join(directory, 'monitor-daemon.pid');
  try {
    writeDaemonPidFile(pidFile, 43210);
    assert.strictEqual(readFileSync(pidFile, 'utf-8'), '43210');
    removeDaemonPidFile(pidFile, 43211);
    assert.ok(existsSync(pidFile), 'a newer daemon pidfile must not be removed');
    removeDaemonPidFile(pidFile, 43210);
    assert.ok(!existsSync(pidFile), 'the owning daemon must remove its pidfile');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
