#!/usr/bin/env node
/**
 * Unit Tests: witr-wrapper (Why Is This Running? trace wrapper).
 *
 * Covers input validation, constants, and installation-state detection.
 * The witr binary itself is an external tool — we test the wrapper's
 * guards and error paths without requiring a real trace (network-free).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  witr,
  WITR_VERSION,
  WITR_BIN_PATH,
  isWitrInstalled,
  ensureWitrInstalled,
} from '../../src/witr-wrapper.ts';

describe('witr-wrapper constants', () => {
  it('exposes a semver version', () => {
    assert.match(WITR_VERSION, /^v\d+\.\d+\.\d+$/);
  });

  it('computes a binary path under .runtime/tools/witr', () => {
    assert.ok(WITR_BIN_PATH.includes('witr'));
    assert.ok(WITR_BIN_PATH.endsWith(process.platform === 'win32' ? 'witr.exe' : 'witr'));
  });

  it('detects installation state as a boolean', () => {
    assert.equal(typeof isWitrInstalled(), 'boolean');
  });

  it('ensureWitrInstalled returns a boolean without throwing', () => {
    assert.equal(typeof ensureWitrInstalled(), 'boolean');
  });
});

describe('witr-wrapper input validation', () => {
  it('traceProcess rejects non-positive PIDs', async () => {
    await assert.rejects(() => witr.traceProcess(0), /Invalid PID/);
    await assert.rejects(() => witr.traceProcess(-5), /Invalid PID/);
  });

  it('traceProcess rejects fractional PIDs', async () => {
    await assert.rejects(() => witr.traceProcess(1.5), /Invalid PID/);
  });

  it('tracePort rejects out-of-range ports', async () => {
    await assert.rejects(() => witr.tracePort(0), /Invalid port/);
    await assert.rejects(() => witr.tracePort(65536), /Invalid port/);
    await assert.rejects(() => witr.tracePort(-1), /Invalid port/);
  });

  it('traceFile rejects empty paths', async () => {
    await assert.rejects(() => witr.traceFile(''), /Empty file path/);
  });

  it('traceContainer rejects empty names', async () => {
    await assert.rejects(() => witr.traceContainer(''), /Empty container name/);
  });
});

describe('witr-wrapper graceful degradation', () => {
  it('throws a descriptive error when the binary is unavailable', async () => {
    // A valid PID should attempt a real trace; if witr is missing or the
    // query fails, we must get an Error — never an unhandled crash.
    try {
      await witr.traceProcess(process.pid);
      // If we got here, the binary exists and the trace worked. Accept it.
      assert.ok(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      assert.match(message, /witr could not trace/i);
    }
  });
});
