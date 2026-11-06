import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchAlert, isDuplicate, resetDedupe } from '../../src/monitor/alert-dispatcher.js';

describe('alert-dispatcher', () => {
  beforeEach(() => resetDedupe());

  it('no duplica dentro del TTL', () => {
    const opts = {
      severity: 'warning' as const,
      category: 'watchtower',
      message: 'check X failed',
    };
    assert.equal(isDuplicate(opts), false);
    assert.equal(isDuplicate(opts), true);
  });

  it('respeta dedupeKey distinto del message', () => {
    const base = { severity: 'info' as const, category: 'budget-gate' };
    assert.equal(isDuplicate({ ...base, message: 'a', dedupeKey: 'daily-budget' }), false);
    assert.equal(isDuplicate({ ...base, message: 'b', dedupeKey: 'daily-budget' }), true);
    assert.equal(isDuplicate({ ...base, message: 'c', dedupeKey: 'otra' }), false);
  });

  it('caduca el dedupe al vencer el TTL', () => {
    const opts = { severity: 'critical' as const, category: 'token-spike', message: 'spike' };
    assert.equal(isDuplicate({ ...opts, dedupeTtlMs: 1000 }), false);
    const later = Date.now() + 2000;
    assert.equal(isDuplicate({ ...opts, dedupeTtlMs: 1000 }, later), false);
  });

  it('dedupeTtlMs=0 desactiva el dedupe', () => {
    const opts = {
      severity: 'warning' as const,
      category: 'x',
      message: 'm',
      dedupeTtlMs: 0,
    };
    assert.equal(isDuplicate(opts), false);
    assert.equal(isDuplicate(opts), false);
  });

  it('dispatchAlert con dedupe activo no lanza ni encola duplicados', () => {
    const opts = {
      severity: 'warning' as const,
      category: 't',
      message: 'm',
      dedupeKey: 'k',
    };
    assert.doesNotThrow(() => {
      dispatchAlert(opts);
      dispatchAlert(opts); // segundo es descartado silenciosamente
    });
  });
});
