import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkServices, type CheckResult } from '../../src/ops/stack-verify.ts';

test('stack verification skips a stopped dashboard service under on-demand policy', () => {
  const previousPort = process.env.WS_PORT;
  process.env.WS_PORT = '0';

  try {
    const results: CheckResult[] = [];

    checkServices(results);

    const wsCheck = results.find((result) => result.name === 'WS Server (:0)');
    assert.equal(wsCheck?.status, 'SKIP');
  } finally {
    if (previousPort === undefined) delete process.env.WS_PORT;
    else process.env.WS_PORT = previousPort;
  }
});
