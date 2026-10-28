import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { runDeliveryGate } from '../../src/delivery/gate.ts';

describe('delivery release gate', () => {
  it('invokes the RDD release validator with its positional gate argument', async () => {
    const report = await runDeliveryGate({
      stage: 'release',
      only: 'rdd-release-gate',
      quiet: true,
    });
    const [check] = report.checks;

    assert.equal(check.name, 'rdd-release-gate');
    assert.match(check.detail, /No receipt found|Legacy or malformed receipt/);
    assert.doesNotMatch(check.detail, /Unknown gate: --stage/);
  });
});
