#!/usr/bin/env node
/**
 * src/ops/tenant-audit.ts — Auditor estático de las tablas multi-tenant del CRM.
 *
 * Para cada tabla que tiene `tenant_id`, verifica que TODOS los índices compuestos
 * tienen `tenant_id` LEADING (critical para performance — trailing degrada a full scan).
 * Output: tabla con violaciones + commits de fix sugeridos.
 *
 * Uso:
 *   npx tsx src/ops/tenant-audit.ts                      # default: apps/academy-crm/data/crm.db
 *   npx tsx src/ops/tenant-audit.ts --db <path>          # custom DB path
 *   npx tsx src/ops/tenant-audit.ts --allow-exceptions    # imprime JSON para scripting
 *
 * Exit code: 0 si todas las tablas cumplen, 1 si hay violaciones.
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { checkTenantIndexes } from '../tenant/helper.js';

const DEFAULT_DB = resolve(process.cwd(), 'apps/academy-crm/.runtime/crm.db');

function getArgs(): { dbPath: string; json: boolean } {
  const argv = process.argv.slice(2);
  let dbPath = DEFAULT_DB;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db' && argv[i + 1]) dbPath = resolve(argv[++i]);
    else if (argv[i] === '--allow-exceptions') json = true;
  }
  return { dbPath, json };
}

function main(): void {
  const { dbPath, json } = getArgs();
  if (!existsSync(dbPath)) {
    console.error(`DB no encontrada: ${dbPath}`);
    process.exit(2);
  }
  const db = new Database(dbPath, { readonly: true });
  // Todas las tablas que tienen tenant_id
  const tables = (db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    AND name NOT LIKE '%_seq'
    ORDER BY name
  `).all() as Array<{ name: string }>).map((r) => r.name);

  const report: Array<{
    table: string;
    hasTenantColumn: boolean;
    totalIndexes: number;
    leadingCount: number;
    violations: Array<{ indexName: string; columns: string[] }>;
  }> = [];

  for (const table of tables) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    const hasTenantColumn = cols.some((c) => c.name === 'tenant_id');
    if (!hasTenantColumn) continue;
    const results = checkTenantIndexes(db, table);
    const violations = results
      .filter((r) => !r.leadingIsTenant)
      .map((r) => ({ indexName: r.indexName, columns: r.columns }));
    report.push({
      table,
      hasTenantColumn,
      totalIndexes: results.length,
      leadingCount: results.filter((r) => r.leadingIsTenant).length,
      violations,
    });
  }

  db.close();

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.some((r) => r.violations.length > 0) ? 1 : 0);
  }

  // Human-readable output
  console.log(`\n=== Tenant Index Audit ===`);
  console.log(`DB: ${dbPath}\n`);
  if (report.length === 0) {
    console.log('No se encontraron tablas con tenant_id.');
    return;
  }
  console.log(`Tablas con tenant_id: ${report.length}\n`);
  console.log('TABLA'.padEnd(36) + 'IDX'.padEnd(8) + 'LEADING'.padEnd(12) + 'VIOLATIONS');
  console.log('-'.repeat(80));
  let totalViolations = 0;
  for (const r of report) {
    console.log(
      r.table.padEnd(36) +
      String(r.totalIndexes).padEnd(8) +
      String(r.leadingCount).padEnd(12) +
      (r.violations.length > 0 ? `${r.violations.length} VIOLATION(S)` : 'OK')
    );
    for (const v of r.violations) {
      console.log(`    ⚠ ${v.indexName} (cols: ${v.columns.join(', ')})`);
      if (v.columns.length === 1) {
        // Single-column non-tenant: el fix es COMPOUND con tenant_id LEADING
        const col = v.columns[0];
        console.log(`      → Fix: DROP INDEX ${v.indexName};`);
        console.log(`              CREATE INDEX ${v.indexName} ON ${r.table}(tenant_id, ${col});`);
      } else {
        // Compound sin LEADING: ya tiene cols, solo prepender tenant_id
        console.log(`      → Fix: DROP INDEX ${v.indexName};`);
        console.log(`              CREATE INDEX ${v.indexName} ON ${r.table}(tenant_id, ${v.columns.join(', ')});`);
      }
      totalViolations++;
    }
  }
  console.log('-'.repeat(80));
  console.log(`Total: ${totalViolations} violation(s) en ${report.length} tabla(s).`);
  if (totalViolations > 0) {
    console.log('\n⚠ ALGUNOS índices no tienen tenant_id LEADING — queries multi-tenant degradan a full scan.');
    process.exit(1);
  }
  console.log('\n✓ Todos los índices compuestos tienen tenant_id LEADING.');
}

try {
  main();
} catch (err) {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  process.exit(2);
}