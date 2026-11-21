import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { runDeliveryGate } from '../../src/delivery/gate.ts';
import { validateGate } from '../../src/rdd/rdd-gates.ts';

describe('delivery release gate', () => {
  it('invokes the RDD release validator with its positional gate argument', async () => {
    // A real reviewed receipt can exist locally. Compare with the validator
    // instead of assuming every developer's current receipt must be invalid.
    const expected = validateGate('release');
    const report = await runDeliveryGate({
      stage: 'release',
      only: 'rdd-release-gate',
      quiet: true,
    });
    const [check] = report.checks;

    assert.equal(check.name, 'rdd-release-gate');
    assert.equal(check.status, expected.valid ? 'pass' : 'fail');
    assert.equal(check.exitCode, expected.valid ? 0 : 1);
    if (!expected.valid) {
      assert.ok(
        expected.errors.some((error) => check.detail.includes(error)),
        check.detail,
      );
    }
    assert.doesNotMatch(check.detail, /Unknown gate: --stage/);
  });
});
