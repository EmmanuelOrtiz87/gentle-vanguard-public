import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';

/**
 * Roles supported by the dashboard RBAC policy (version 1).
 * Ordered from least to most privileged.
 */
export const DASHBOARD_ROLES = ['viewer', 'operator', 'admin'] as const;
export type DashboardRole = (typeof DASHBOARD_ROLES)[number];

export function isDashboardRole(value: unknown): value is DashboardRole {
  return typeof value === 'string' && (DASHBOARD_ROLES as readonly string[]).includes(value);
}

export interface PrincipalRecord {
  id: string;
  subject: string;
  displayName?: string;
  createdAt: string;
}

export interface MembershipRecord {
  tenantId: string;
  principalId: string;
  role: DashboardRole;
  createdAt: string;
}

interface PrincipalRow {
  id: string;
  subject: string;
  display_name: string | null;
  created_at: string;
}

interface MembershipRow {
  tenant_id: string;
  principal_id: string;
  role: string;
  created_at: string;
}

function toPrincipal(row: PrincipalRow): PrincipalRecord {
  return {
    id: row.id,
    subject: row.subject,
    displayName: row.display_name || undefined,
    createdAt: row.created_at,
  };
}

/**
 * Tenant-scoped principal and membership persistence for dashboard RBAC.
 * Backed by the `principals` / `memberships` tables (migration 009).
 */
export class PrincipalRepo {
  constructor(private db: Database.Database) {}

  findOrCreateBySubject(subject: string, displayName?: string): PrincipalRecord {
    const trimmed = subject.trim();
    if (!trimmed) throw new Error('Principal subject is required');
    const existing = this.db
      .prepare('SELECT * FROM principals WHERE subject = ?')
      .get(trimmed) as PrincipalRow | undefined;
    if (existing) return toPrincipal(existing);
    const id = randomBytes(16).toString('hex');
    this.db
      .prepare('INSERT INTO principals (id, subject, display_name) VALUES (?, ?, ?)')
      .run(id, trimmed, displayName?.trim() || null);
    return { id, subject: trimmed, displayName: displayName?.trim() || undefined, createdAt: new Date().toISOString() };
  }

  getById(id: string): PrincipalRecord | undefined {
    const row = this.db.prepare('SELECT * FROM principals WHERE id = ?').get(id) as
      | PrincipalRow
      | undefined;
    return row ? toPrincipal(row) : undefined;
  }

  list(): PrincipalRecord[] {
    const rows = this.db.prepare('SELECT * FROM principals ORDER BY created_at, subject').all() as PrincipalRow[];
    return rows.map(toPrincipal);
  }

  /** Delete a principal; memberships cascade via FK. Returns true when a row was removed. */
  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM principals WHERE id = ?').run(id);
    return result.changes > 0;
  }

  getRole(tenantId: string, principalId: string): DashboardRole | undefined {
    const row = this.db
      .prepare('SELECT role FROM memberships WHERE tenant_id = ? AND principal_id = ?')
      .get(tenantId, principalId) as { role?: string } | undefined;
    return isDashboardRole(row?.role) ? row!.role : undefined;
  }

  upsertMembership(tenantId: string, principalId: string, role: DashboardRole): void {
    if (!isDashboardRole(role)) throw new Error(`Invalid dashboard role: ${role}`);
    this.db
      .prepare(
        `INSERT INTO memberships (tenant_id, principal_id, role)
         VALUES (?, ?, ?)
         ON CONFLICT(tenant_id, principal_id) DO UPDATE SET role = excluded.role`,
      )
      .run(tenantId, principalId, role);
  }

  removeMembership(tenantId: string, principalId: string): void {
    this.db
      .prepare('DELETE FROM memberships WHERE tenant_id = ? AND principal_id = ?')
      .run(tenantId, principalId);
  }

  listMemberships(principalId?: string): MembershipRecord[] {
    const rows = (
      principalId
        ? this.db
            .prepare('SELECT * FROM memberships WHERE principal_id = ? ORDER BY tenant_id')
            .all(principalId)
        : this.db.prepare('SELECT * FROM memberships ORDER BY tenant_id, principal_id').all()
    ) as MembershipRow[];
    return rows
      .map((row) => ({
        tenantId: row.tenant_id,
        principalId: row.principal_id,
        role: isDashboardRole(row.role) ? row.role : 'viewer',
        createdAt: row.created_at,
      }));
  }

  /** Number of principals holding the admin role in any tenant. */
  countAdmins(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM memberships WHERE role = 'admin'")
      .get() as { n: number };
    return row.n;
  }
}
