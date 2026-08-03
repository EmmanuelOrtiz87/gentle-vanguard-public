import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('session-scripts', () => {
  it('src/session-autostart.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'core', 'session-autostart.ts')));
  });

  it('src/session-cleanup-start.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'session-cleanup-start.ts')));
  });

  it('src/session-manager.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'session-manager.ts')));
  });
});
