/**
 * session-cleanup-start arg parsing: the autostart config speaks two notations
 * (`--quiet --skip-cache-flush` in phase 0, `-Quiet -SkipSessionInit` in the
 * lazy step). The old switch only matched PowerShell names, so the kebab flags
 * were silently ignored — phase 0 flushed token caches the config told it to
 * skip. Regression: both notations must land on the same options.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCleanupArgs } from '../../src/session/session-cleanup-start.ts';

test('notación kebab del phase 0 se parsea igual que la PowerShell', () => {
  assert.deepEqual(parseCleanupArgs(['--quiet', '--skip-cache-flush', '--skip-compression']), {
    quiet: true,
    skipCacheFlush: true,
    skipCompression: true,
  });
  assert.deepEqual(parseCleanupArgs(['-Quiet', '-SkipCacheFlush', '-SkipCompression']), {
    quiet: true,
    skipCacheFlush: true,
    skipCompression: true,
  });
});

test('la lazy step (PowerShell) conserva su contrato', () => {
  assert.deepEqual(parseCleanupArgs(['-Quiet', '-SkipSessionInit', '-SkipCacheFlush']), {
    quiet: true,
    skipSessionInit: true,
    skipCacheFlush: true,
  });
});

test('flags con valor consumen solo su argumento', () => {
  assert.deepEqual(parseCleanupArgs(['--workspace-root', 'C:/tmp/ws', '--quiet']), {
    workspaceRoot: 'C:/tmp/ws',
    quiet: true,
  });
  assert.deepEqual(parseCleanupArgs(['-WorkspaceRoot', 'C:\\tmp\\ws']), {
    workspaceRoot: 'C:\\tmp\\ws',
  });
});

test('-CaptureIntent se lleva el resto del comando como prompt', () => {
  assert.deepEqual(parseCleanupArgs(['--quiet', '--capture-intent', 'arreglar', 'el', 'login']), {
    quiet: true,
    captureIntent: 'arreglar el login',
  });
});

test('un flag desconocido no rompe ni contamina opciones', () => {
  assert.deepEqual(parseCleanupArgs(['--not-a-flag', '-Quiet']), { quiet: true });
});
