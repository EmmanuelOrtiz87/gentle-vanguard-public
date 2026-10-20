import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBootstrapStatus,
  formatReadinessStatus,
  healthCheckPassed,
  resolveBootstrapOutcome,
  shouldSkipBootstrapChecks,
  type BootstrapChecks,
} from '../../src/ops/stack-readiness.js';

const passingChecks: BootstrapChecks = {
  session: true,
  delegation: true,
  policy: true,
  routing: true,
  security: true,
  health: true,
};

test('bootstrap status is healthy only when every required check passes', () => {
  const status = createBootstrapStatus(passingChecks, '2026-10-19T00:00:00.000Z');

  assert.equal(status.healthy, true);
  assert.equal(status.phase, 'complete');
  assert.deepEqual(status.services, {
    session: true,
    delegation: true,
    policy: true,
    routing: true,
    security: true,
    watchtower: true,
  });
});

test('failed required checks produce an unhealthy status and preserve actual service states', () => {
  const failedChecks = { ...passingChecks, policy: false, health: false };
  const status = createBootstrapStatus(failedChecks, '2026-10-19T00:00:00.000Z');

  assert.equal(status.healthy, false);
  assert.equal(status.phase, 'failed');
  assert.equal(status.services.policy, false);
  assert.equal(status.services.watchtower, false);
  assert.equal(status.services.session, true);
});

test('status never verifies readiness from a bootstrap marker alone', () => {
  assert.match(formatReadinessStatus(true), /Readiness no verificada/);
  assert.match(
    formatReadinessStatus(true),
    /marker de bootstrap no acredita una validación vigente/,
  );
  assert.match(formatReadinessStatus(false), /Readiness no verificada/);
  assert.match(formatReadinessStatus(false), /no existe una validación de bootstrap finalizada/);
});

test('health check result requires a nonzero PASS count and zero FAIL count', () => {
  assert.equal(healthCheckPassed('PASS: 8 | WARN: 1 | FAIL: 0 | SKIP: 2 | Total: 11'), true);
  assert.equal(healthCheckPassed('PASS: 8 | WARN: 1 | FAIL: 1 | SKIP: 1 | Total: 11'), false);
  assert.equal(healthCheckPassed('PASS: 0 | WARN: 0 | FAIL: 0 | SKIP: 11 | Total: 11'), false);
  assert.equal(healthCheckPassed('watchtower output unavailable'), false);
});

test('quick checks report success without claiming finalized production readiness', () => {
  const outcome = resolveBootstrapOutcome(passingChecks, 'skipped');

  assert.equal(outcome.status, 'CHECKS PASSED (NOT FINALIZED)');
  assert.equal(outcome.readinessVerified, false);
  assert.equal(outcome.exitCode, 0);
});

test('force and auto modes run checks despite an existing bootstrap marker', () => {
  assert.equal(shouldSkipBootstrapChecks(true, false, false), true);
  assert.equal(shouldSkipBootstrapChecks(true, false, true), false);
  assert.equal(shouldSkipBootstrapChecks(true, true, false), false);
  assert.equal(shouldSkipBootstrapChecks(false, false, false), false);
});

test('failed checks and failed finalization never report healthy readiness', () => {
  const failedChecks = { ...passingChecks, health: false };

  assert.deepEqual(resolveBootstrapOutcome(failedChecks, 'complete'), {
    status: 'PARTIAL',
    readinessVerified: false,
    exitCode: 1,
  });
  assert.deepEqual(resolveBootstrapOutcome(passingChecks, 'failed'), {
    status: 'PARTIAL',
    readinessVerified: false,
    exitCode: 1,
  });
  assert.deepEqual(resolveBootstrapOutcome(passingChecks, 'complete'), {
    status: 'HEALTHY',
    readinessVerified: true,
    exitCode: 0,
  });
});
