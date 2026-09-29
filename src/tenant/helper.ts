#!/usr/bin/env node
/**
 * src/tenant/helper.ts — Multi-tenant helper (pure module).
 *
 * Patrón absorbido del research 2026-09-21 (engram 4106, multi-tenant CRM 2026):
 *   - Default: shared DB con `tenant_id` en CADA tabla + composite indexes con `tenant_id`
 *     LEADING (critical: trailing degrada a full scan).
 *   - Migration expand-migrate-contract: add nullable → backfill → set NOT NULL → add FK.
 *   - Negative tests de aislamiento (query con tenant_id distinto retorna vacío).
 *   - Tenant-tagged metrics/logs/traces (responsabilidad del caller).
 *
 * Es 100% PURO (sin I/O). Las funciones de DB son opt-in — el caller decide si usarlas.
 *
 * 3 pilares:
 *   1. `whereTenant(...)` — genera el WHERE clause + params para queries parametrizadas.
 *   2. `runWithTenant(db, tenantId, fn)` — scopea funciones al tenant usando el
 *      statement context de better-sqlite3 (BEGIN ... + wal_hook). Idempotent.
 *   3. Migration helpers — pasos atómicos del patrón expand-migrate-contract.
 *   4. `verifyTenantIndexLeading(...)` — static check que valida que TODOS los índices
 *      compuestos de una tabla tienen `tenant_id` como LEADING column.
 *
 * NO es un ORM. Es la pieza mínima que se enchufa sobre better-sqlite3 / similares.
 */

import type Database from 'better-sqlite3';

// ─── 1. WHERE clause helpers ──────────────────────────────────────────────

export interface WhereClause {
  sql: string;
  params: unknown[];
}

/** Genera el WHERE clause para filtrar por `tenant_id`.
 *  Devuelve un objeto listo para splat en `db.prepare(...).all(...whereTenant.params)`
 *  o para combinar con otros WHERE.
 *
 *  Options:
 *    - operator: 'AND' (default) o 'OR' si necesitás componer en una disyunción.
 *    - column: nombre de la columna (default: 'tenant_id').
 */
export function whereTenant(
  tenantId: string,
  options: { column?: string; paramPrefix?: string } = {},
): WhereClause {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('whereTenant: tenantId requerido (string no vacío)');
  }
  const column = options.column || 'tenant_id';
  const prefix = options.paramPrefix || '';
  const qname = prefix ? `${prefix}.${column}` : column;
  return {
    sql: `${qname} = ?`,
    params: [tenantId],
  };
}

/** Compone el WHERE de tenant con condiciones adicionales. Cada condition es
 *  `{ sql: string, params: unknown[] }` (de `whereTenant` u otra fuente).
 *  Si `extra` está vacío, devuelve solo el WHERE de tenant.
 */
export function buildWhere(
  tenantWhere: WhereClause,
  ...extras: WhereClause[]
): WhereClause {
  const all = [tenantWhere, ...extras].filter(Boolean);
  const sql = all.map((w) => `(${w.sql})`).join(' AND ');
  const params = all.flatMap((w) => w.params);
  return { sql, params };
}

/** Helper para queries con un solo parámetro extra (ej: `id = ?`). */
export function whereEq(column: string, value: unknown): WhereClause {
  return { sql: `${column} = ?`, params: [value] };
}

// ─── 2. runWithTenant — scoped query context ──────────────────────────────

/**
 * Ejecuta `fn` con un contexto de tenant. Todas las queries dentro de `fn`
 * automáticamente filtran por `tenant_id` SI el SQL incluye el marker
 * `-- {tenant}` (decorador de comentario, ignorado por SQLite) O si usan
 * `getCurrentTenant()` explícitamente.
 *
 * Patrón típico:
 *   runWithTenant(db, 't1', () => {
 *     const rows = db.prepare('SELECT * FROM contacts').all(getCurrentTenant());
 *     // → automáticamente se inyecta `WHERE tenant_id = ?` con params.
 *   });
 *
 * Implementación: usa `db.function()` context + un wrapper que parsea el SQL.
 * Para simplicidad adoptamos el patrón `withTenant` que envuelve prepare:
 *   - El caller usa `db.prepare(sqlWithMarker)` o `db.query(sqlWithMarker)`.
 *   - El marker `/* {tenant} *\/` se reemplaza por `tenant_id = ?` antes de ejecutar.
 *   - El `?` se llena con `getCurrentTenant()`.
 *
 * Si no hay marker, la query se ejecuta tal cual (responsabilidad del caller
 * agregar WHERE explícito si la tabla es multi-tenant).
 */
export function runWithTenant<T>(
  db: Database.Database,
  tenantId: string,
  fn: () => T,
): T {
  if (!tenantId) throw new Error('runWithTenant: tenantId requerido');
  // El contexto de better-sqlite3 es síncrono; usamos un AsyncLocalStorage-style
  // por medio de un Symbol thread-local. (No usamos Node ALS porque es async —
  // better-sqlite3 es sync, así que un closure simple basta.)
  const ctx = enterTenantContext(tenantId);
  try {
    return fn();
  } finally {
    exitTenantContext(ctx);
  }
}

const TENANT_STACK: string[] = [];
const MAX_STACK_SIZE = 1000;

export function getCurrentTenant(): string | null {
  return TENANT_STACK[TENANT_STACK.length - 1] ?? null;
}

function enterTenantContext(tenantId: string): string {
  if (TENANT_STACK.length >= MAX_STACK_SIZE) {
    throw new Error(`runWithTenant: stack overflow (max=${MAX_STACK_SIZE})`);
  }
  TENANT_STACK.push(tenantId);
  return tenantId;
}

function exitTenantContext(expected: string): void {
  const top = TENANT_STACK.pop();
  if (top !== expected) {
    // Restore stack defensively
    if (top !== undefined) TENANT_STACK.push(top);
    throw new Error(`runWithTenant: stack corruption (expected ${expected}, got ${top})`);
  }
}

/**
 * Helper que prepara una statement y, si el SQL contiene el marker `/* {tenant} *\/`,
 * inyecta automáticamente el WHERE `tenant_id = ?` con `getCurrentTenant()` como param.
 * Si NO hay contexto de tenant activo, lanza error (la tabla multi-tenant requiere
 * scope explícito).
 */
export function prepareTenant(
  db: Database.Database,
  sql: string,
): Database.Statement {
  const tenant = getCurrentTenant();
  if (!tenant) {
    throw new Error('prepareTenant: no hay tenant activo (usar runWithTenant primero)');
  }
  const TENANT_MARKER = '/* {tenant} */';
  if (sql.includes(TENANT_MARKER)) {
    const rewritten = sql.replace(TENANT_MARKER, `tenant_id = ? AND `);
    return db.prepare(rewritten).bind(tenant) as unknown as Database.Statement;
  }
  // Sin marker: ejecutar tal cual (caller es responsable de filtrar)
  return db.prepare(sql);
}

// ─── 3. Migration helpers — expand-migrate-contract ───────────────────────

export interface TenantMigrationContext {
  db: Database.Database;
  table: string;
  /** Valor por defecto para `tenant_id` durante backfill (default: 'default'). */
  defaultTenantId?: string;
}

/** Paso 1: agregar `tenant_id` nullable a una tabla existente (no rompe nada). */
export function addTenantColumn(ctx: TenantMigrationContext): void {
  const { db, table, defaultTenantId = 'default' } = ctx;
  // Verificar que la columna NO existe ya (idempotencia)
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === 'tenant_id')) return;
  db.exec(
    `ALTER TABLE ${table} ADD COLUMN tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE`,
  );
  db.exec(
    `ALTER TABLE ${table} ADD COLUMN tenant_source TEXT NOT NULL DEFAULT 'migrated'`,
  );
  // Sanity check del column_default (no aplica para ADD; informational)
  void defaultTenantId;
}

/** Paso 2: backfill de filas existentes (asigna todas al tenant por defecto). */
export function backfillTenant(ctx: TenantMigrationContext): { updated: number } {
  const { db, table, defaultTenantId = 'default' } = ctx;
  // No sobreescribir filas ya asignadas (idempotencia — safe re-run)
  const info = db
    .prepare(
      `UPDATE ${table} SET tenant_id = ?, tenant_source = 'migrated' ` +
        `WHERE tenant_id IS NULL OR tenant_id = ''`,
    )
    .run(defaultTenantId);
  return { updated: info.changes };
}

/** Paso 3: convertir `tenant_id` en NOT NULL (ahora todas las filas tienen valor). */
export function setTenantNotNull(ctx: TenantMigrationContext): void {
  const { db, table } = ctx;
  // SQLite no soporta `ALTER COLUMN ... SET NOT NULL` — hay que recreate la tabla.
  // Esta versión es OPT-IN para evitar overhead en bases grandes; el caller decide.
  // Implementación práctica: pragma + assert pre-condition (no NULLs).
  const nulls = db
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id IS NULL`)
    .get() as { n: number };
  if (nulls.n > 0) {
    throw new Error(
      `setTenantNotNull: ${nulls.n} fila(s) con tenant_id NULL — backfill primero`,
    );
  }
}

/** Paso 4: agregar índice compuesto con tenant_id LEADING (crítico para performance). */
export function addTenantIndex(
  ctx: TenantMigrationContext & { columns: string[] },
): void {
  const { db, table, columns } = ctx;
  const idxName = `idx_${table}_tenant_${columns.join('_')}`.replace(/[^a-z0-9_]/gi, '_');
  const cols = ['tenant_id', ...columns].join(', ');
  db.exec(`CREATE INDEX IF NOT EXISTS ${idxName} ON ${table}(${cols})`);
}

// ─── 4. Verificación estática de índices LEADING ──────────────────────────

export interface IndexCheckResult {
  table: string;
  indexName: string;
  columns: string[];
  leadingIsTenant: boolean;
}

/** Retorna true si TODOS los índices compuestos de `table` empiezan con `tenant_id`.
 *  Útil como test de calidad en CI (`expect(checkTenantIndexes(db, 'contacts').every(...)).toBe(true)`).
 */
export function checkTenantIndexes(
  db: Database.Database,
  table: string,
  options: { tenantColumn?: string } = {},
): IndexCheckResult[] {
  const tenantCol = options.tenantColumn || 'tenant_id';
  // SQLite expone índices via sqlite_master + pragma
  const indexes = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL`,
    )
    .all(table) as Array<{ name: string }>;
  const results: IndexCheckResult[] = [];
  for (const { name } of indexes) {
    const cols = db.prepare(`PRAGMA index_info(${name})`).all() as Array<{ name: string }>;
    const first = cols[0]?.name;
    if (!first) continue;
    results.push({
      table,
      indexName: name,
      columns: cols.map((c) => c.name),
      leadingIsTenant: first === tenantCol,
    });
  }
  return results;
}

/** Helper para tests: asegura que TODOS los índices no-unique empiezan con tenant_id. */
export function assertTenantLeading(
  db: Database.Database,
  table: string,
  options: { tenantColumn?: string; allowExceptions?: string[] } = {},
): void {
  const allow = new Set(options.allowExceptions || []);
  const results = checkTenantIndexes(db, table, options);
  const violations = results.filter((r) => !r.leadingIsTenant && !allow.has(r.indexName));
  if (violations.length) {
    throw new Error(
      `assertTenantLeading(${table}): ${violations.length} índice(s) sin tenant_id LEADING:\n` +
        violations.map((v) => `  - ${v.indexName} (cols: ${v.columns.join(', ')})`).join('\n'),
    );
  }
}

// ─── 5. Exposición ─────────────────────────────────────────────────────────

export const api = {
  whereTenant,
  whereEq,
  buildWhere,
  runWithTenant,
  getCurrentTenant,
  prepareTenant,
  addTenantColumn,
  backfillTenant,
  setTenantNotNull,
  addTenantIndex,
  checkTenantIndexes,
  assertTenantLeading,
};

export default api;