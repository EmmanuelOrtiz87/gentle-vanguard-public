import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IncomingMessage } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DashboardAuth, SESSION_COOKIE } from '../../apps/web-dashboard/server/auth.ts';

function request(cookie?: string, host = 'localhost'): IncomingMessage {
  return {
    headers: { host, ...(cookie ? { cookie } : {}) },
    socket: { remoteAddress: '127.0.0.1' },
  } as IncomingMessage;
}

describe('DashboardAuth', () => {
  it('creates and validates opaque TTL sessions', () => {
    let now = 100;
    const auth = new DashboardAuth({ token: 'secret', ttlMs: 10, now: () => now });
    const session = auth.login('secret');
    assert.ok(session);
    assert.notEqual(session, 'secret');
    assert.equal(auth.authenticate(request(`${SESSION_COOKIE}=${session}`)), true);
    now = 110;
    assert.equal(auth.authenticate(request(`${SESSION_COOKIE}=${session}`)), false);
  });

  it('trusts loopback and fails closed for remote when no token is configured (local-default)', () => {
    const auth = new DashboardAuth();
    assert.equal(auth.enabled, false);
    // Local-default profile: loopback listener without credentials trusts the owner.
    assert.equal(auth.authenticate(request()), true);
    assert.equal(auth.isProtectedRequest(request()), false);
    // Remote requests stay fail-closed without a token.
    assert.equal(auth.authenticate(request(undefined, 'dashboard.example')), false);
    assert.equal(auth.isProtectedRequest(request(undefined, 'dashboard.example')), true);
    // Login is never possible without a configured token.
    assert.equal(auth.login('anything'), undefined);
  });

  it('allows only localhost in explicit non-production dev mode', () => {
    const auth = new DashboardAuth({ devAuth: '1', production: 'development' });
    assert.equal(auth.authenticate(request()), true);
    assert.equal(auth.authenticate(request(undefined, 'dashboard.example')), false);
    assert.match(auth.warning || '', /localhost/);
  });

  it('does not enable the dev bypass in production', () => {
    const auth = new DashboardAuth({ devAuth: '1', production: 'production' });
    assert.equal(auth.authenticate(request()), false);
    assert.equal(auth.warning, undefined);
  });

  it('persists sessions across DatabaseManager restarts and enforces expiry and revocation', async () => {
    const dbDir = mkdtempSync(join(tmpdir(), 'gentle-vanguard-auth-'));
    const previousDir = process.env.GENTLE_VANGUARD_DB_DIR;
    const previousFile = process.env.GENTLE_VANGUARD_DB_FILE;
    process.env.GENTLE_VANGUARD_DB_DIR = dbDir;
    process.env.GENTLE_VANGUARD_DB_FILE = 'auth-test.db';
    let now = 100;

    try {
      const { DatabaseManager } =
        await import('../../apps/web-dashboard/server/database/manager.ts');
      const firstManager = DatabaseManager.getInstance();
      const firstAuth = new DashboardAuth({
        token: 'secret',
        ttlMs: 10,
        now: () => now,
        sessionStore: firstManager.authSessions,
      });
      const session = firstAuth.login('secret');
      assert.ok(session);
      assert.equal(firstAuth.authenticate(request(`${SESSION_COOKIE}=${session}`)), true);

      DatabaseManager.resetInstance();
      const secondManager = DatabaseManager.getInstance();
      const secondAuth = new DashboardAuth({
        token: 'secret',
        ttlMs: 10,
        now: () => now,
        sessionStore: secondManager.authSessions,
      });
      assert.equal(secondAuth.authenticate(request(`${SESSION_COOKIE}=${session}`)), true);

      secondAuth.logout(request(`${SESSION_COOKIE}=${session}`));
      assert.equal(secondAuth.authenticate(request(`${SESSION_COOKIE}=${session}`)), false);

      const expiringSession = secondAuth.login('secret');
      assert.ok(expiringSession);
      now = 110;
      assert.equal(secondAuth.authenticate(request(`${SESSION_COOKIE}=${expiringSession}`)), false);
      DatabaseManager.resetInstance();
    } finally {
      if (previousDir === undefined) delete process.env.GENTLE_VANGUARD_DB_DIR;
      else process.env.GENTLE_VANGUARD_DB_DIR = previousDir;
      if (previousFile === undefined) delete process.env.GENTLE_VANGUARD_DB_FILE;
      else process.env.GENTLE_VANGUARD_DB_FILE = previousFile;
      try {
        rmSync(dbDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        return;
      }
    }
  });
});
