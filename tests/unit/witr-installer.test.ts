import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_WITR_VERSION,
  WITR_INSTALL_TIMEOUT,
  detectWitrPlatform,
} from '../../src/web/witr-installer.ts';

describe('witr TypeScript installer', () => {
  it('uses the pinned release and bounded install timeout', () => {
    assert.equal(DEFAULT_WITR_VERSION, 'v0.3.3');
    assert.equal(WITR_INSTALL_TIMEOUT, 120_000);
  });

  it('detects a supported local platform and architecture', () => {
    const platform = detectWitrPlatform();
    assert.ok(['windows', 'linux', 'darwin'].includes(platform.os));
    assert.ok(['amd64', 'arm64'].includes(platform.arch));
    assert.equal(platform.isWindows, process.platform === 'win32');
  });
});
