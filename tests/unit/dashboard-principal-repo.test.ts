import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { AuthSessionRepo } from '../../apps/web-dashboard/server/database/repositories/AuthSessionRepo';
import {
  DASHBOARD_ROLES,
  PrincipalRepo,
  isDashboardRole,
} from '../../apps/web-dashboard/server/database/repositories/PrincipalRepo';
import { MigrationRunner } from '../../apps/web-dashboard/server/database/repositories/MigrationRunner';

const DEFAULT_TENANT = 'gentle-vanguard';

function createDatabase(): Database.Database {
  const db = new Database(':memory:');
  new MigrationRunner(db).runMigrations();
  return db;
}

test('migration 014 adds principal binding columns to auth sessions', () => {
  const db = createDatabase();
  for (const column of ['principal_id', 'csrf_hash']) {
    assert.ok(
      db.prepare(`SELECT 1 FROM pragma_table_info('dashboard_auth_sessions') WHERE name = ?`).get(column),
      `expected column ${column}`,
    );
  }
  assert.ok(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_dashboard_auth_sessions_principal'")
      .get(),
  );
});

test('findOrCreateBySubject is idempotent per subject', () => {
  const repo = new PrincipalRepo(createDatabase());
  const first = repo.findOrCreateBySubject('dashboard-operator', 'Operator');
  const second = repo.findOrCreateBySubject('dashboard-operator');
  assert.equal(first.id, second.id);
  assert.equal(first.subject, 'dashboard-operator');
  // Second call is a lookup: it returns the persisted record unchanged.
  assert.equal(second.displayName, 'Operator');
  assert.throws(() => repo.findOrCreateBySubject('   '));
});

test('membership upsert, role lookup and tenant scoping', () => {
  const db = createDatabase();
  db.exec("INSERT INTO tenants (id, name) VALUES ('other-tenant', 'Other')");
  const repo = new PrincipalRepo(db);

  const principal = repo.findOrCreateBySubject('alice');
  assert.equal(repo.getRole(DEFAULT_TENANT, principal.id), undefined);

  repo.upsertMembership(DEFAULT_TENANT, principal.id, 'viewer');
  assert.equal(repo.getRole(DEFAULT_TENANT, principal.id), 'viewer');
  repo.upsertMembership(DEFAULT_TENANT, principal.id, 'operator');
  assert.equal(repo.getRole(DEFAULT_TENANT, principal.id), 'operator');

  // Roles are tenant-scoped: other tenants are unaffected.
  repo.upsertMembership('other-tenant', principal.id, 'admin');
  assert.equal(repo.getRole('other-tenant', principal.id), 'admin');
  assert.equal(repo.getRole(DEFAULT_TENANT, principal.id), 'operator');

  assert.throws(() => repo.upsertMembership(DEFAULT_TENANT, principal.id, 'superuser' as never));

  repo.removeMembership('other-tenant', principal.id);
  assert.equal(repo.getRole('other-tenant', principal.id), undefined);
  assert.equal(repo.getRole(DEFAULT_TENANT, principal.id), 'operator');
});

test('countAdmins tracks admin memberships across tenants', () => {
  const db = createDatabase();
  db.exec("INSERT INTO tenants (id, name) VALUES ('other-tenant', 'Other')");
  const repo = new PrincipalRepo(db);
  assert.equal(repo.countAdmins(), 0);

  const a = repo.findOrCreateBySubject('a');
  const b = repo.findOrCreateBySubject('b');
  repo.upsertMembership(DEFAULT_TENANT, a.id, 'admin');
  assert.equal(repo.countAdmins(), 1);
  repo.upsertMembership('other-tenant', b.id, 'admin');
  assert.equal(repo.countAdmins(), 2);
  repo.upsertMembership(DEFAULT_TENANT, a.id, 'viewer');
  assert.equal(repo.countAdmins(), 1);
});

test('delete cascades memberships and list exposes records', () => {
  const db = createDatabase();
  const repo = new PrincipalRepo(db);
  const principal = repo.findOrCreateBySubject('temp-user');
  repo.upsertMembership(DEFAULT_TENANT, principal.id, 'operator');

  assert.deepEqual(
    repo.list().map((p) => p.subject),
    ['temp-user'],
  );
  assert.equal(repo.listMemberships(principal.id).length, 1);

  assert.equal(repo.delete(principal.id), true);
  assert.equal(repo.delete(principal.id), false);
  assert.equal(repo.list().length, 0);
  assert.equal(repo.listMemberships(principal.id).length, 0);
});

test('auth session binding stores principal and csrf hash', () => {
  const db = createDatabase();
  const sessions = new AuthSessionRepo(db);
  const principals = new PrincipalRepo(db);

  const principal = principals.findOrCreateBySubject('bound-user');
  sessions.create('session-1', Date.now() + 60_000);
  assert.equal(sessions.getPrincipalId('session-1'), undefined);

  sessions.bindSession('session-1', principal.id, 'csrf-hash-1');
  assert.equal(sessions.getPrincipalId('session-1'), principal.id);
  assert.equal(sessions.getCsrfHash('session-1'), 'csrf-hash-1');

  // Expired sessions resolve to no principal.
  sessions.create('session-expired', Date.now() - 1_000);
  sessions.bindSession('session-expired', principal.id, 'x');
  assert.equal(sessions.getPrincipalId('session-expired'), undefined);
});

test('revokeAllForPrincipal removes only that principal sessions', () => {
  const db = createDatabase();
  const sessions = new AuthSessionRepo(db);
  const principals = new PrincipalRepo(db);

  const a = principals.findOrCreateBySubject('a');
  const b = principals.findOrCreateBySubject('b');
  sessions.create('s-a1', Date.now() + 60_000);
  sessions.create('s-a2', Date.now() + 60_000);
  sessions.create('s-b1', Date.now() + 60_000);
  sessions.bindSession('s-a1', a.id);
  sessions.bindSession('s-a2', a.id);
  sessions.bindSession('s-b1', b.id);

  assert.equal(sessions.revokeAllForPrincipal(a.id), 2);
  assert.equal(sessions.hasValid('s-a1', Date.now()), false);
  assert.equal(sessions.hasValid('s-a2', Date.now()), false);
  assert.equal(sessions.hasValid('s-b1', Date.now()), true);
});

test('role helpers validate the supported role set', () => {
  assert.deepEqual([...DASHBOARD_ROLES], ['viewer', 'operator', 'admin']);
  assert.equal(isDashboardRole('admin'), true);
  assert.equal(isDashboardRole('member'), false);
  assert.equal(isDashboardRole(42), false);
});
