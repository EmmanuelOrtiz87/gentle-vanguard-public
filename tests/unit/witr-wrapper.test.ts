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
  isWitrCompatible,
  ensureWitrInstalled,
  sanitizeWitrOutput,
} from '../../src/web/witr-wrapper.ts';

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

  it('ensureWitrInstalled returns a boolean without throwing when witr is available', (context) => {
    if (!isWitrCompatible()) {
      context.skip('witr binary unavailable or incompatible; external installation is optional');
      return;
    }
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

describe('witr-wrapper secret redaction', () => {
  it('removes sensitive structures and values from serialized output', () => {
    const secretName = 'GH_TOKEN';
    const secretValue = 'ghs_regression_secret_123';
    const output = sanitizeWitrOutput({
      Process: {
        PID: 21360,
        Command: 'node',
        Cmdline: `node --token ${secretValue}`,
        Env: [`${secretName}=${secretValue}`, `SAFE=value`],
      },
      Headers: { Authorization: `Bearer ${secretValue}` },
      args: ['--password', secretValue],
      query: { apiKey: secretValue },
      Ancestry: [{ PID: 1, Command: 'init' }],
    });

    const serialized = JSON.stringify(output);
    assert.ok(serialized);
    assert.doesNotMatch(serialized, /GH_TOKEN|ghs_regression_secret_123|Authorization|Bearer/);
    assert.doesNotMatch(serialized, /"Env"|"Headers"|"args"|"query"/);
    assert.match(serialized, /"PID":21360/);
    assert.match(serialized, /"Ancestry"/);
  });

  it('redacts sensitive assignments embedded in trace commands', () => {
    const output = sanitizeWitrOutput({
      command:
        'node GH_TOKEN=secret-value --api-key another-secret Bearer bearer-secret ?token=query-secret',
    });
    assert.equal(JSON.stringify(output), '{"command":"node [REDACTED] [REDACTED] [REDACTED]"}');
    assert.doesNotMatch(
      JSON.stringify(output),
      /secret-value|another-secret|bearer-secret|query-secret/,
    );
  });
});

describe('witr-wrapper graceful degradation', () => {
  it('throws a descriptive error when the installed binary cannot trace', async (context) => {
    if (!isWitrCompatible()) {
      context.skip('witr binary unavailable or incompatible; external installation is optional');
      return;
    }
    try {
      await witr.traceProcess(process.pid);
      assert.ok(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      assert.match(message, /witr could not trace/i);
    }
  });
});
