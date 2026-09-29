/**
 * Tests for src/tenant/helper.ts (multi-tenant helper, pure core).
 * Runs with `node --import tsx --test tests/unit/tenant/helper.test.ts`.
 *
 * Cubre:
 *   - whereTenant / buildWhere (pure)
 *   - runWithTenant / getCurrentTenant (context stack)
 *   - Migration helpers (real SQLite en in-memory)
 *   - checkTenantIndexes (positive + negative tests de aislamiento)
 *   - assertTenantLeading (estático + exceptions allow-list)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  whereTenant,
  whereEq,
  buildWhere,
  runWithTenant,
  getCurrentTenant,
  checkTenantIndexes,
  assertTenantLeading,
  addTenantColumn,
  backfillTenant,
  setTenantNotNull,
  addTenantIndex,
} from '../../../src/tenant/helper.js';

// ─── Pure helpers ─────────────────────────────────────────────────────────
test('whereTenant: default column + tenant_id', () => {
  const w = whereTenant('t1');
  assert.equal(w.sql, 'tenant_id = ?');
  assert.deepEqual(w.params, ['t1']);
});

test('whereTenant: column override', () => {
  const w = whereTenant('t1', { column: 'org_id' });
  assert.equal(w.sql, 'org_id = ?');
  assert.deepEqual(w.params, ['t1']);
});

test('whereTenant: paramPrefix agrega alias de tabla', () => {
  const w = whereTenant('t1', { paramPrefix: 'contacts' });
  assert.equal(w.sql, 'contacts.tenant_id = ?');
});

test('whereTenant: rechaza tenantId vacío o no-string', () => {
  assert.throws(() => whereTenant(''), /requerido/);
  assert.throws(() => whereTenant(null as never), /requerido/);
  assert.throws(() => whereTenant(undefined as never), /requerido/);
});

test('whereEq: helper para columnas simples', () => {
  const w = whereEq('id', 42);
  assert.equal(w.sql, 'id = ?');
  assert.deepEqual(w.params, [42]);
});

test('buildWhere: compone tenant + extra con AND', () => {
  const w = buildWhere(
    whereTenant('t1'),
    whereEq('status', 'active'),
    whereEq('age', 30),
  );
  assert.equal(w.sql, '(tenant_id = ?) AND (status = ?) AND (age = ?)');
  assert.deepEqual(w.params, ['t1', 'active', 30]);
});

test('buildWhere: solo tenant si no hay extras', () => {
  const w = buildWhere(whereTenant('t1'));
  assert.equal(w.sql, '(tenant_id = ?)');
  assert.deepEqual(w.params, ['t1']);
});

// ─── Context stack ────────────────────────────────────────────────────────
test('getCurrentTenant: null fuera de runWithTenant', () => {
  assert.equal(getCurrentTenant(), null);
});

test('runWithTenant: setea contexto durante la ejecución', () => {
  assert.equal(getCurrentTenant(), null);
  let captured: string | null = 'before';
  runWithTenant({} as Database.Database, 't1', () => {
    captured = getCurrentTenant();
  });
  assert.equal(captured, 't1');
  assert.equal(getCurrentTenant(), null);
});

test('runWithTenant: anida contextos en stack', () => {
  assert.equal(getCurrentTenant(), null);
  runWithTenant({} as Database.Database, 'outer', () => {
    assert.equal(getCurrentTenant(), 'outer');
    runWithTenant({} as Database.Database, 'inner', () => {
      assert.equal(getCurrentTenant(), 'inner');
    });
    assert.equal(getCurrentTenant(), 'outer');
  });
  assert.equal(getCurrentTenant(), null);
});

test('runWithTenant: rechaza tenantId vacío', () => {
  assert.throws(() => runWithTenant({} as Database.Database, '', () => 1), /requerido/);
});

test('runWithTenant: fn ejecuta aunque lance (finally limpia stack)', () => {
  assert.equal(getCurrentTenant(), null);
  assert.throws(() => {
    runWithTenant({} as Database.Database, 't1', () => {
      throw new Error('boom');
    });
  });
  assert.equal(getCurrentTenant(), null);
});

// ─── Index checks (real SQLite) ──────────────────────────────────────────
function freshDb(): Database.Database {
  const db = new Database(':memory:');
  return db;
}

test('checkTenantIndexes: tabla sin índices retorna []', () => {
  const db = freshDb();
  db.exec('CREATE TABLE x (id INTEGER)');
  assert.deepEqual(checkTenantIndexes(db, 'x'), []);
});

test('checkTenantIndexes: índice LEADING tenant_id → leadingIsTenant=true', () => {
  const db = freshDb();
  db.exec('CREATE TABLE x (id INTEGER, tenant_id TEXT)');
  db.exec('CREATE INDEX idx_lead ON x(tenant_id, id)');
  const r = checkTenantIndexes(db, 'x');
  assert.equal(r.length, 1);
  assert.equal(r[0].leadingIsTenant, true);
  assert.deepEqual(r[0].columns, ['tenant_id', 'id']);
});

test('checkTenantIndexes: índice SIN tenant_id LEADING → leadingIsTenant=false (violación)', () => {
  const db = freshDb();
  db.exec('CREATE TABLE x (id INTEGER, tenant_id TEXT)');
  db.exec('CREATE INDEX idx_trailing ON x(id, tenant_id)');
  const r = checkTenantIndexes(db, 'x');
  assert.equal(r.length, 1);
  assert.equal(r[0].leadingIsTenant, false);
});

test('assertTenantLeading: detecta violación y lanza', () => {
  const db = freshDb();
  db.exec('CREATE TABLE x (id INTEGER, tenant_id TEXT)');
  db.exec('CREATE INDEX idx_bad ON x(id)');
  assert.throws(() => assertTenantLeading(db, 'x'), /sin tenant_id LEADING/);
});

test('assertTenantLeading: pasa con índice LEADING', () => {
  const db = freshDb();
  db.exec('CREATE TABLE x (id INTEGER, tenant_id TEXT)');
  db.exec('CREATE INDEX idx_good ON x(tenant_id, id)');
  assert.doesNotThrow(() => assertTenantLeading(db, 'x'));
});

test('assertTenantLeading: allow-list exceptúa índices específicos', () => {
  const db = freshDb();
  db.exec('CREATE TABLE x (id INTEGER, tenant_id TEXT)');
  db.exec('CREATE INDEX idx_bad ON x(id)');
  // Sin allow-list → lanza
  assert.throws(() => assertTenantLeading(db, 'x'), /sin tenant_id LEADING/);
  // Con allow-list → pasa
  assert.doesNotThrow(() => assertTenantLeading(db, 'x', { allowExceptions: ['idx_bad'] }));
});

// ─── Migration helpers (real SQLite) ──────────────────────────────────────
test('addTenantColumn: agrega columna + es idempotente', () => {
  const db = freshDb();
  db.exec('CREATE TABLE contacts (id INTEGER PRIMARY KEY, name TEXT)');
  addTenantColumn({ db, table: 'contacts' });
  const cols = db.prepare('PRAGMA table_info(contacts)').all() as Array<{ name: string }>;
  const names = cols.map((c) => c.name);
  assert.ok(names.includes('tenant_id'), 'tenant_id agregada');
  assert.ok(names.includes('tenant_source'), 'tenant_source agregada');
  // Idempotente
  addTenantColumn({ db, table: 'contacts' });
  const cols2 = db.prepare('PRAGMA table_info(contacts)').all() as Array<{ name: string }>;
  assert.equal(cols2.length, cols.length, 'no duplica columnas');
});

test('backfillTenant: asigna default a filas con tenant_id NULL', () => {
  const db = freshDb();
  db.exec('CREATE TABLE contacts (id INTEGER, tenant_id TEXT, tenant_source TEXT)');
  db.exec(`INSERT INTO contacts VALUES (1, NULL, NULL), (2, NULL, NULL), (3, 'existing', 'manual')`);
  const r = backfillTenant({ db, table: 'contacts', defaultTenantId: 't1' });
  assert.equal(r.updated, 2);
  const rows = db.prepare('SELECT id, tenant_id, tenant_source FROM contacts ORDER BY id').all() as Array<{ id: number; tenant_id: string; tenant_source: string }>;
  assert.equal(rows[0].tenant_id, 't1');
  assert.equal(rows[0].tenant_source, 'migrated');
  assert.equal(rows[1].tenant_id, 't1');
  assert.equal(rows[2].tenant_id, 'existing'); // NO se sobreescribe
  assert.equal(rows[2].tenant_source, 'manual');
});

test('backfillTenant: idempotente (segunda corrida no cambia nada)', () => {
  const db = freshDb();
  db.exec('CREATE TABLE contacts (id INTEGER, tenant_id TEXT, tenant_source TEXT)');
  db.exec(`INSERT INTO contacts VALUES (1, NULL, NULL), (2, 't1', 'migrated')`);
  const r1 = backfillTenant({ db, table: 'contacts', defaultTenantId: 't1' });
  assert.equal(r1.updated, 1);
  const r2 = backfillTenant({ db, table: 'contacts', defaultTenantId: 't1' });
  assert.equal(r2.updated, 0, 'segunda corrida es no-op');
});

test('setTenantNotNull: rechaza si hay NULLs', () => {
  const db = freshDb();
  db.exec('CREATE TABLE contacts (id INTEGER, tenant_id TEXT)');
  db.exec(`INSERT INTO contacts VALUES (1, NULL), (2, 't1')`);
  assert.throws(() => setTenantNotNull({ db, table: 'contacts' }), /backfill primero/);
});

test('setTenantNotNull: pasa si no hay NULLs', () => {
  const db = freshDb();
  db.exec('CREATE TABLE contacts (id INTEGER, tenant_id TEXT)');
  db.exec(`INSERT INTO contacts VALUES (1, 't1')`);
  assert.doesNotThrow(() => setTenantNotNull({ db, table: 'contacts' }));
});

test('addTenantIndex: crea índice compuesto LEADING tenant_id', () => {
  const db = freshDb();
  db.exec('CREATE TABLE contacts (id INTEGER, name TEXT, tenant_id TEXT)');
  addTenantIndex({ db, table: 'contacts', columns: ['id'] });
  const idx = checkTenantIndexes(db, 'contacts');
  assert.equal(idx.length, 1);
  assert.equal(idx[0].leadingIsTenant, true);
  assert.deepEqual(idx[0].columns, ['tenant_id', 'id']);
});

// ─── Negative test de aislamiento (lo más importante) ─────────────────────
test('AISLAMIENTO: query con tenant distinto retorna vacío (no cross-tenant leak)', () => {
  const db = freshDb();
  db.exec(`
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      body TEXT
    )
  `);
  db.exec(`INSERT INTO notes VALUES (1, 't1', 'secret of t1'), (2, 't2', 'secret of t2')`);

  // Sin filtro: ve todo (riesgoso — solo OK en admin/migration)
  const allRows = db.prepare('SELECT * FROM notes').all() as Array<{ tenant_id: string }>;
  assert.equal(allRows.length, 2);

  // Con filtro por tenant_id: aislamiento correcto
  const t1Rows = db.prepare('SELECT * FROM notes WHERE tenant_id = ?').all('t1') as Array<{ tenant_id: string }>;
  assert.equal(t1Rows.length, 1);
  assert.equal(t1Rows[0].tenant_id, 't1');

  const t3Rows = db.prepare('SELECT * FROM notes WHERE tenant_id = ?').all('t3') as Array<{ tenant_id: string }>;
  assert.equal(t3Rows.length, 0, 'tenant inexistente → 0 filas (NO leak)');
});

test('AISLAMIENTO + helper: whereTenant + buildWhere compone seguro', () => {
  const db = freshDb();
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      body TEXT,
      from_user TEXT
    )
  `);
  db.exec(`
    INSERT INTO messages VALUES
      (1, 't1', 'msg from alice to t1', 'alice'),
      (2, 't1', 'msg from bob to t1', 'bob'),
      (3, 't2', 'msg from alice to t2', 'alice'),
      (4, 't2', 'msg from bob to t2', 'bob')
  `);
  // Alice en t1 quiere sus mensajes
  const w = buildWhere(whereTenant('t1'), whereEq('from_user', 'alice'));
  const aliceT1 = db.prepare(`SELECT * FROM messages WHERE ${w.sql}`).all(...w.params);
  assert.equal(aliceT1.length, 1);

  // Bob en t1 (otro usuario, MISMO tenant) ve los suyos
  const wBob = buildWhere(whereTenant('t1'), whereEq('from_user', 'bob'));
  const bobT1 = db.prepare(`SELECT * FROM messages WHERE ${wBob.sql}`).all(...wBob.params);
  assert.equal(bobT1.length, 1);

  // Alice en t2 NO ve los de t1
  const wAliceT2 = buildWhere(whereTenant('t2'), whereEq('from_user', 'alice'));
  const aliceT2 = db.prepare(`SELECT * FROM messages WHERE ${wAliceT2.sql}`).all(...wAliceT2.params);
  assert.equal(aliceT2.length, 1);
  // CRITICAL: aliceT2 NO debe contener el msg id=1 (que era de t1)
  assert.equal((aliceT2[0] as { id: number }).id, 3);
});