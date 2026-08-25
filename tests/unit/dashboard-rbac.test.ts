import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RBAC_POLICY_VERSION,
  can,
  resolveRoutePermission,
  roleHasAction,
} from '../../apps/web-dashboard/server/rbac';
import { LoginRateLimiter } from '../../apps/web-dashboard/server/login-rate-limiter';

test('rbac policy version is pinned', () => {
  assert.equal(RBAC_POLICY_VERSION, 1);
});

test('role action matrix follows viewer < operator < admin', () => {
  assert.equal(roleHasAction('viewer', 'read'), true);
  assert.equal(roleHasAction('viewer', 'write'), false);
  assert.equal(roleHasAction('viewer', 'admin'), false);

  assert.equal(roleHasAction('operator', 'read'), true);
  assert.equal(roleHasAction('operator', 'write'), true);
  assert.equal(roleHasAction('operator', 'admin'), false);

  assert.equal(roleHasAction('admin', 'read'), true);
  assert.equal(roleHasAction('admin', 'write'), true);
  assert.equal(roleHasAction('admin', 'admin'), true);
});

test('can() evaluates role against a resolved permission', () => {
  const read = { resource: 'metrics', action: 'read' as const };
  const write = { resource: 'mcp', action: 'write' as const };
  const admin = { resource: 'admin', action: 'admin' as const };

  assert.equal(can('viewer', read), true);
  assert.equal(can('viewer', write), false);
  assert.equal(can('viewer', admin), false);
  assert.equal(can('operator', write), true);
  assert.equal(can('operator', admin), false);
  assert.equal(can('admin', admin), true);
});

test('resolveRoutePermission exempts public health and auth routes', () => {
  assert.equal(resolveRoutePermission('/api/health', 'GET'), undefined);
  assert.equal(resolveRoutePermission('/api/auth/login', 'POST'), undefined);
  assert.equal(resolveRoutePermission('/api/auth/status', 'GET'), undefined);
  assert.equal(resolveRoutePermission('/api/auth/logout', 'POST'), undefined);
});

test('resolveRoutePermission requires admin for /api/admin/* routes', () => {
  assert.deepEqual(resolveRoutePermission('/api/admin/principals', 'GET'), {
    resource: 'admin',
    action: 'read',
  });
  assert.deepEqual(resolveRoutePermission('/api/admin/principals', 'POST'), {
    resource: 'admin',
    action: 'admin',
  });
  assert.deepEqual(resolveRoutePermission('/api/admin/principals/p1/role', 'PATCH'), {
    resource: 'admin',
    action: 'admin',
  });
});

test('resolveRoutePermission maps reads to viewer and mutations to operator', () => {
  assert.deepEqual(resolveRoutePermission('/api/metrics', 'GET'), {
    resource: 'metrics',
    action: 'read',
  });
  assert.deepEqual(resolveRoutePermission('/api/traces', 'GET'), {
    resource: 'traces',
    action: 'read',
  });
  assert.deepEqual(resolveRoutePermission('/api/mcp/servers/srv/start', 'POST'), {
    resource: 'mcp',
    action: 'write',
  });
  assert.deepEqual(resolveRoutePermission('/api/mesh/discover', 'POST'), {
    resource: 'mesh',
    action: 'write',
  });
  assert.deepEqual(resolveRoutePermission('/', 'GET'), { resource: 'general', action: 'read' });
});

test('login rate limiter allows under budget and blocks at threshold', () => {
  let now = 1_000_000;
  const clock = () => now;
  const limiter = new LoginRateLimiter(3, 60_000, clock);

  for (let i = 0; i < 3; i++) {
    assert.equal(limiter.check('ip-1').allowed, true);
    limiter.recordFailure('ip-1');
  }
  const blocked = limiter.check('ip-1');
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1 && blocked.retryAfterSeconds <= 60);

  // A different key is unaffected.
  assert.equal(limiter.check('ip-2').allowed, true);
});

test('login rate limiter window slides and recovers', () => {
  let now = 2_000_000;
  const clock = () => now;
  const limiter = new LoginRateLimiter(2, 10_000, clock);

  limiter.recordFailure('ip');
  limiter.recordFailure('ip');
  assert.equal(limiter.check('ip').allowed, false);

  // Advance past the window: failures expire.
  now += 10_001;
  assert.equal(limiter.check('ip').allowed, true);

  // Successful login resets the counter.
  limiter.recordFailure('ip');
  limiter.reset('ip');
  assert.equal(limiter.check('ip').allowed, true);
});
