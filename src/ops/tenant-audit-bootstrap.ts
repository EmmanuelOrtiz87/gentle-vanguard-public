#!/usr/bin/env node
/**
 * src/ops/tenant-audit-bootstrap.ts — Helper para testear el audit sobre un schema sintético.
 * Crea un DB temp con tenant_id + dos casos:
 *   - índices triviales (single-column) → OK (leadingIsTenant=true)
 *   - un índice compuesto SIN tenant_id LEADING → violation
 *
 * Uso: npx tsx src/ops/tenant-audit-bootstrap.ts
 */
import Database from 'better-sqlite3';
import { join } from 'path';
import { tmpdir } from 'os';

const dbPath = join(tmpdir(), 'gv-tenant-audit-test.db');
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE crm_contacts (
    id INTEGER PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard',
    name TEXT,
    status TEXT
  );
  CREATE TABLE crm_deals (
    id INTEGER PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard',
    contact_id INTEGER,
    status TEXT,
    amount REAL
  );
  -- Tenant-only index: trivially LEADING ✓
  CREATE INDEX idx_crm_contacts_tenant ON crm_contacts(tenant_id);
  -- Compound LEADING ✓ (audit expects this)
  CREATE INDEX idx_crm_deals_tenant_status ON crm_deals(tenant_id, status);
  -- Single column non-tenant: trivially non-tenant (audit ignores single-col)
  CREATE INDEX idx_crm_deals_contact ON crm_deals(contact_id);
  -- Compound WITHOUT tenant_id LEADING ✗ (this is the violation)
  CREATE INDEX idx_crm_deals_status_amount ON crm_deals(status, amount);
`);
db.close();
console.log(`Test DB created at: ${dbPath}`);
console.log(`Run audit: npx tsx src/ops/tenant-audit.ts --db "${dbPath}"`);