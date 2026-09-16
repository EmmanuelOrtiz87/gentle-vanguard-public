import Database from 'better-sqlite3';

/**
 * Academy CRM — Contacts + Deals + Sessions para el ciclo de venta de la
 * Academy (cursos, ebooks, toolkits, mentorías, consultorías).
 *
 * Convenciones:
 * - `tenant_id` siempre 'gentle-vanguard' en single-tenant; el repo acepta el
 *   parámetro para mantener simetría con el resto de la Nexus.
 * - `status` de los deals sigue el pipeline:
 *     lead → contacted → quoted → sold → delivered → paid
 *   (lost / cancelled son terminales).
 * - `crm_deal_status_history` registra TODA transición (audit trail).
 * - Montos en `currency` (default USD). close_date/paid_date se guardan
 *   como ISO 8601 (YYYY-MM-DD HH:MM:SS).
 */

// ─── Tipos públicos ─────────────────────────────────────────────────────

export type DealStatus =
  'lead' | 'contacted' | 'quoted' | 'sold' | 'delivered' | 'paid' | 'lost' | 'cancelled';

export type ContactAudience = 'personas' | 'estudiantes' | 'empresas' | 'mixed' | 'unknown';

export type ProductType =
  | 'ebook-micro'
  | 'ebook-premium'
  | 'toolkit'
  | 'course-base'
  | 'course-mentor'
  | 'program-custom'
  | 'mentor-individual'
  | 'other';

export type SessionType =
  'mentor' | 'course-mentor' | 'consultoria' | 'demo' | 'onboarding' | 'other';

export interface CrmContactRecord {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  audience: ContactAudience;
  source: string;
  notes: string;
  lead_synced: number; // 0/1
  lead_audience: string;
  created_at: string;
  updated_at: string;
}

export interface CrmDealRecord {
  id: string;
  tenant_id: string;
  contact_id: string;
  product_type: ProductType;
  product_id: string;
  product_label: string;
  amount: number;
  currency: string;
  status: DealStatus;
  close_date: string | null;
  paid_date: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface CrmSessionRecord {
  id: string;
  tenant_id: string;
  deal_id: string | null;
  contact_id: string;
  title: string;
  type: SessionType;
  duration_minutes: number;
  scheduled_at: string;
  completed: number; // 0/1
  completion_notes: string;
  created_at: string;
  updated_at: string;
}

export interface CrmDealStatusHistoryRecord {
  id: number;
  tenant_id: string;
  deal_id: string;
  from_status: DealStatus | null;
  to_status: DealStatus;
  reason: string;
  created_at: string;
}

export interface CrmEventRecord {
  id: number;
  tenant_id: string;
  kind: string;
  contact_id: string | null;
  deal_id: string | null;
  payload: string;
  source: string;
  created_at: string;
}

// ─── Repo interface ──────────────────────────────────────────────────────

export interface AcademyCRMRepo {
  // Contacts
  createContact(tenantId: string, data: Omit<CrmContactRecord, 'created_at' | 'updated_at'>): void;
  getContact(id: string, tenantId: string): CrmContactRecord | null;
  listContacts(
    tenantId: string,
    filter?: { audience?: string; search?: string; limit?: number },
  ): CrmContactRecord[];
  updateContact(
    id: string,
    tenantId: string,
    patch: Partial<
      Pick<
        CrmContactRecord,
        'name' | 'email' | 'phone' | 'company' | 'audience' | 'notes' | 'lead_audience'
      >
    >,
  ): void;
  deleteContact(id: string, tenantId: string): void;
  importFromLeads(
    tenantId: string,
    leads: Array<{ name: string; email: string; audience: string; ts?: number }>,
  ): { created: number; merged: number };

  // Deals
  createDeal(tenantId: string, data: Omit<CrmDealRecord, 'created_at' | 'updated_at'>): void;
  getDeal(id: string, tenantId: string): CrmDealRecord | null;
  listDeals(
    tenantId: string,
    filter?: {
      status?: DealStatus;
      contact_id?: string;
      from?: string;
      to?: string;
      limit?: number;
    },
  ): CrmDealRecord[];
  updateDeal(
    id: string,
    tenantId: string,
    patch: Partial<
      Pick<
        CrmDealRecord,
        | 'product_type'
        | 'product_id'
        | 'product_label'
        | 'amount'
        | 'currency'
        | 'status'
        | 'close_date'
        | 'paid_date'
        | 'notes'
      >
    >,
  ): void;
  transitionDeal(id: string, tenantId: string, to: DealStatus, reason?: string): void;
  deleteDeal(id: string, tenantId: string): void;
  dealStatusHistory(dealId: string, tenantId: string): CrmDealStatusHistoryRecord[];

  // Sessions
  createSession(tenantId: string, data: Omit<CrmSessionRecord, 'created_at' | 'updated_at'>): void;
  getSession(id: string, tenantId: string): CrmSessionRecord | null;
  listSessions(
    tenantId: string,
    filter?: {
      from?: string;
      to?: string;
      contact_id?: string;
      deal_id?: string;
      completed?: boolean;
      limit?: number;
    },
  ): CrmSessionRecord[];
  updateSession(
    id: string,
    tenantId: string,
    patch: Partial<
      Pick<
        CrmSessionRecord,
        'title' | 'type' | 'duration_minutes' | 'scheduled_at' | 'completion_notes'
      >
    >,
  ): void;
  completeSession(id: string, tenantId: string, notes?: string): void;
  deleteSession(id: string, tenantId: string): void;

  // Stats
  dashboard(tenantId: string): {
    contacts: { total: number; by_audience: Record<string, number> };
    deals: {
      total: number;
      by_status: Record<string, number>;
      pipeline_value_usd: number;
      won_value_usd: number;
    };
    sessions: { upcoming: number; completed_this_month: number; total_minutes_this_month: number };
  };
  closeReport(
    tenantId: string,
    from: string,
    to: string,
  ): {
    deals_paid: number;
    revenue_usd: number;
    deals_sold: number;
    deals_delivered: number;
    deals_lost: number;
    sessions_completed: number;
    sessions_minutes: number;
    by_product: Record<string, { deals: number; revenue_usd: number }>;
    by_day: Array<{ day: string; deals_paid: number; revenue_usd: number }>;
  };

  // Events (audit log de interacciones)
  logEvent(
    tenantId: string,
    kind: string,
    payload: { contact_id?: string; deal_id?: string; [k: string]: unknown },
    source?: string,
  ): void;
  listEvents(
    tenantId: string,
    filter?: { kind?: string; from?: string; to?: string; limit?: number },
  ): CrmEventRecord[];
}

// ─── Implementación SQLite ──────────────────────────────────────────────

export class SqliteAcademyCRMRepo implements AcademyCRMRepo {
  constructor(private db: Database.Database) {}

  // ─── Contacts ────────────────────────────────────────────────────────

  createContact(tenantId: string, data: Omit<CrmContactRecord, 'created_at' | 'updated_at'>): void {
    this.db
      .prepare(
        `INSERT INTO crm_contacts
         (id, tenant_id, name, email, phone, company, audience, source, notes, lead_synced, lead_audience)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.id,
        tenantId,
        data.name,
        data.email ?? '',
        data.phone ?? '',
        data.company ?? '',
        data.audience ?? 'personas',
        data.source ?? 'manual',
        data.notes ?? '',
        data.lead_synced ?? 0,
        data.lead_audience ?? '',
      );
  }

  getContact(id: string, tenantId: string): CrmContactRecord | null {
    return (
      (this.db
        .prepare('SELECT * FROM crm_contacts WHERE id = ? AND tenant_id = ?')
        .get(id, tenantId) as CrmContactRecord | undefined) ?? null
    );
  }

  listContacts(
    tenantId: string,
    filter: { audience?: string; search?: string; limit?: number } = {},
  ): CrmContactRecord[] {
    const clauses = ['tenant_id = ?'];
    const values: unknown[] = [tenantId];
    if (filter.audience) {
      clauses.push('audience = ?');
      values.push(filter.audience);
    }
    if (filter.search) {
      const q = `%${filter.search.toLowerCase()}%`;
      clauses.push('(LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(company) LIKE ?)');
      values.push(q, q, q);
    }
    const limit = filter.limit ?? 200;
    return this.db
      .prepare(
        `SELECT * FROM crm_contacts WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(...values, limit) as CrmContactRecord[];
  }

  updateContact(
    id: string,
    tenantId: string,
    patch: Partial<
      Pick<
        CrmContactRecord,
        'name' | 'email' | 'phone' | 'company' | 'audience' | 'notes' | 'lead_audience'
      >
    >,
  ): void {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => (patch as Record<string, unknown>)[k]);
    this.db
      .prepare(
        `UPDATE crm_contacts SET ${sets}, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
      )
      .run(...values, id, tenantId);
  }

  deleteContact(id: string, tenantId: string): void {
    // FK CASCADE hace el trabajo en crm_deals, crm_sessions, etc.
    this.db.prepare('DELETE FROM crm_contacts WHERE id = ? AND tenant_id = ?').run(id, tenantId);
  }

  importFromLeads(
    tenantId: string,
    leads: Array<{ name: string; email: string; audience: string; ts?: number }>,
  ): { created: number; merged: number } {
    let created = 0;
    let merged = 0;
    const tx = this.db.transaction(() => {
      for (const lead of leads) {
        if (!lead.email) continue; // leads sin email no son importables
        const audience = (
          ['personas', 'estudiantes', 'empresas'].includes(lead.audience)
            ? lead.audience
            : 'personas'
        ) as ContactAudience;
        const existing = this.db
          .prepare('SELECT id FROM crm_contacts WHERE tenant_id = ? AND email = ?')
          .get(tenantId, lead.email) as { id: string } | undefined;
        if (existing) {
          // Merge: actualiza lead_audience y marca synced
          this.db
            .prepare(
              `UPDATE crm_contacts
               SET lead_synced = 1, lead_audience = ?, updated_at = datetime('now')
               WHERE id = ? AND tenant_id = ?`,
            )
            .run(audience, existing.id, tenantId);
          merged++;
        } else {
          this.db
            .prepare(
              `INSERT INTO crm_contacts
               (id, tenant_id, name, email, audience, source, lead_synced, lead_audience)
               VALUES (lower(hex(randomblob(8))), ?, ?, ?, ?, 'lead', 1, ?)`,
            )
            .run(tenantId, lead.name, lead.email, audience, audience);
          created++;
        }
      }
    });
    tx();
    return { created, merged };
  }

  // ─── Deals ───────────────────────────────────────────────────────────

  createDeal(tenantId: string, data: Omit<CrmDealRecord, 'created_at' | 'updated_at'>): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO crm_deals
           (id, tenant_id, contact_id, product_type, product_id, product_label, amount, currency, status, close_date, paid_date, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          data.id,
          tenantId,
          data.contact_id,
          data.product_type,
          data.product_id ?? '',
          data.product_label,
          data.amount,
          data.currency ?? 'USD',
          data.status ?? 'lead',
          data.close_date ?? null,
          data.paid_date ?? null,
          data.notes ?? '',
        );
      // Registrar en history el estado inicial
      this.db
        .prepare(
          `INSERT INTO crm_deal_status_history (tenant_id, deal_id, from_status, to_status, reason)
           VALUES (?, ?, NULL, ?, 'created')`,
        )
        .run(tenantId, data.id, data.status ?? 'lead');
    });
    tx();
  }

  getDeal(id: string, tenantId: string): CrmDealRecord | null {
    return (
      (this.db
        .prepare('SELECT * FROM crm_deals WHERE id = ? AND tenant_id = ?')
        .get(id, tenantId) as CrmDealRecord | undefined) ?? null
    );
  }

  listDeals(
    tenantId: string,
    filter: {
      status?: DealStatus;
      contact_id?: string;
      from?: string;
      to?: string;
      limit?: number;
    } = {},
  ): CrmDealRecord[] {
    const clauses = ['tenant_id = ?'];
    const values: unknown[] = [tenantId];
    if (filter.status) {
      clauses.push('status = ?');
      values.push(filter.status);
    }
    if (filter.contact_id) {
      clauses.push('contact_id = ?');
      values.push(filter.contact_id);
    }
    if (filter.from) {
      clauses.push('created_at >= ?');
      values.push(filter.from);
    }
    if (filter.to) {
      clauses.push('created_at <= ?');
      values.push(filter.to);
    }
    const limit = filter.limit ?? 200;
    return this.db
      .prepare(
        `SELECT * FROM crm_deals WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(...values, limit) as CrmDealRecord[];
  }

  updateDeal(
    id: string,
    tenantId: string,
    patch: Partial<
      Pick<
        CrmDealRecord,
        | 'product_type'
        | 'product_id'
        | 'product_label'
        | 'amount'
        | 'currency'
        | 'status'
        | 'close_date'
        | 'paid_date'
        | 'notes'
      >
    >,
  ): void {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => (patch as Record<string, unknown>)[k]);
    this.db
      .prepare(
        `UPDATE crm_deals SET ${sets}, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
      )
      .run(...values, id, tenantId);
  }

  transitionDeal(id: string, tenantId: string, to: DealStatus, reason = ''): void {
    const deal = this.getDeal(id, tenantId);
    if (!deal) return;
    if (deal.status === to) return;
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE crm_deals
           SET status = ?, updated_at = datetime('now'),
               close_date = CASE WHEN ? IN ('sold','paid') AND close_date IS NULL THEN datetime('now') ELSE close_date END,
               paid_date = CASE WHEN ? = 'paid' AND paid_date IS NULL THEN datetime('now') ELSE paid_date END
           WHERE id = ? AND tenant_id = ?`,
        )
        .run(to, to, to, id, tenantId);
      this.db
        .prepare(
          `INSERT INTO crm_deal_status_history (tenant_id, deal_id, from_status, to_status, reason)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(tenantId, id, deal.status, to, reason);
    });
    tx();
  }

  deleteDeal(id: string, tenantId: string): void {
    this.db.prepare('DELETE FROM crm_deals WHERE id = ? AND tenant_id = ?').run(id, tenantId);
  }

  dealStatusHistory(dealId: string, tenantId: string): CrmDealStatusHistoryRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM crm_deal_status_history WHERE deal_id = ? AND tenant_id = ? ORDER BY created_at ASC`,
      )
      .all(dealId, tenantId) as CrmDealStatusHistoryRecord[];
  }

  // ─── Sessions ────────────────────────────────────────────────────────

  createSession(tenantId: string, data: Omit<CrmSessionRecord, 'created_at' | 'updated_at'>): void {
    this.db
      .prepare(
        `INSERT INTO crm_sessions
         (id, tenant_id, deal_id, contact_id, title, type, duration_minutes, scheduled_at, completed, completion_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.id,
        tenantId,
        data.deal_id ?? null,
        data.contact_id,
        data.title,
        data.type,
        data.duration_minutes,
        data.scheduled_at,
        data.completed ?? 0,
        data.completion_notes ?? '',
      );
  }

  getSession(id: string, tenantId: string): CrmSessionRecord | null {
    return (
      (this.db
        .prepare('SELECT * FROM crm_sessions WHERE id = ? AND tenant_id = ?')
        .get(id, tenantId) as CrmSessionRecord | undefined) ?? null
    );
  }

  listSessions(
    tenantId: string,
    filter: {
      from?: string;
      to?: string;
      contact_id?: string;
      deal_id?: string;
      completed?: boolean;
      limit?: number;
    } = {},
  ): CrmSessionRecord[] {
    const clauses = ['tenant_id = ?'];
    const values: unknown[] = [tenantId];
    if (filter.from) {
      clauses.push('scheduled_at >= ?');
      values.push(filter.from);
    }
    if (filter.to) {
      clauses.push('scheduled_at <= ?');
      values.push(filter.to);
    }
    if (filter.contact_id) {
      clauses.push('contact_id = ?');
      values.push(filter.contact_id);
    }
    if (filter.deal_id) {
      clauses.push('deal_id = ?');
      values.push(filter.deal_id);
    }
    if (typeof filter.completed === 'boolean') {
      clauses.push('completed = ?');
      values.push(filter.completed ? 1 : 0);
    }
    const limit = filter.limit ?? 200;
    return this.db
      .prepare(
        `SELECT * FROM crm_sessions WHERE ${clauses.join(' AND ')} ORDER BY scheduled_at ASC LIMIT ?`,
      )
      .all(...values, limit) as CrmSessionRecord[];
  }

  updateSession(
    id: string,
    tenantId: string,
    patch: Partial<
      Pick<
        CrmSessionRecord,
        'title' | 'type' | 'duration_minutes' | 'scheduled_at' | 'completion_notes'
      >
    >,
  ): void {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => (patch as Record<string, unknown>)[k]);
    this.db
      .prepare(
        `UPDATE crm_sessions SET ${sets}, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
      )
      .run(...values, id, tenantId);
  }

  completeSession(id: string, tenantId: string, notes = ''): void {
    this.db
      .prepare(
        `UPDATE crm_sessions SET completed = 1, completion_notes = ?, updated_at = datetime('now')
         WHERE id = ? AND tenant_id = ?`,
      )
      .run(notes, id, tenantId);
  }

  deleteSession(id: string, tenantId: string): void {
    this.db.prepare('DELETE FROM crm_sessions WHERE id = ? AND tenant_id = ?').run(id, tenantId);
  }

  // ─── Stats ───────────────────────────────────────────────────────────

  dashboard(tenantId: string) {
    // Contacts
    const contactsTotal = (
      this.db
        .prepare('SELECT COUNT(*) as c FROM crm_contacts WHERE tenant_id = ?')
        .get(tenantId) as { c: number }
    ).c;
    const byAudienceRows = this.db
      .prepare(
        'SELECT audience, COUNT(*) as c FROM crm_contacts WHERE tenant_id = ? GROUP BY audience',
      )
      .all(tenantId) as Array<{ audience: string; c: number }>;
    const by_audience: Record<string, number> = {};
    for (const r of byAudienceRows) by_audience[r.audience] = r.c;

    // Deals
    const dealsTotal = (
      this.db.prepare('SELECT COUNT(*) as c FROM crm_deals WHERE tenant_id = ?').get(tenantId) as {
        c: number;
      }
    ).c;
    const byStatusRows = this.db
      .prepare('SELECT status, COUNT(*) as c FROM crm_deals WHERE tenant_id = ? GROUP BY status')
      .all(tenantId) as Array<{ status: string; c: number }>;
    const by_status: Record<string, number> = {};
    for (const r of byStatusRows) by_status[r.status] = r.c;

    const pipelineRows = this.db
      .prepare(
        `SELECT COALESCE(SUM(amount),0) as v
         FROM crm_deals
         WHERE tenant_id = ? AND status IN ('lead','contacted','quoted','sold','delivered')`,
      )
      .get(tenantId) as { v: number };
    const wonRows = this.db
      .prepare(
        `SELECT COALESCE(SUM(amount),0) as v
         FROM crm_deals
         WHERE tenant_id = ? AND status = 'paid'`,
      )
      .get(tenantId) as { v: number };

    // Sessions
    const now = new Date();
    const yyyymm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthStart = `${yyyymm}-01 00:00:00`;
    const monthEnd = `${yyyymm}-31 23:59:59`;
    const upcoming = (
      this.db
        .prepare(
          `SELECT COUNT(*) as c FROM crm_sessions
         WHERE tenant_id = ? AND completed = 0 AND scheduled_at >= datetime('now')`,
        )
        .get(tenantId) as { c: number }
    ).c;
    const completedMonth = this.db
      .prepare(
        `SELECT COUNT(*) as c, COALESCE(SUM(duration_minutes),0) as m
         FROM crm_sessions
         WHERE tenant_id = ? AND completed = 1
           AND scheduled_at >= ? AND scheduled_at <= ?`,
      )
      .get(tenantId, monthStart, monthEnd) as { c: number; m: number };

    return {
      contacts: { total: contactsTotal, by_audience },
      deals: {
        total: dealsTotal,
        by_status,
        pipeline_value_usd: pipelineRows.v,
        won_value_usd: wonRows.v,
      },
      sessions: {
        upcoming,
        completed_this_month: completedMonth.c,
        total_minutes_this_month: completedMonth.m,
      },
    };
  }

  closeReport(tenantId: string, from: string, to: string) {
    // Resumen
    const summary = this.db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as deals_paid,
           COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) as revenue_usd,
           SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as deals_sold,
           SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as deals_delivered,
           SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as deals_lost
         FROM crm_deals
         WHERE tenant_id = ?
           AND (paid_date >= ? AND paid_date <= ?
                OR (paid_date IS NULL AND created_at >= ? AND created_at <= ?))`,
      )
      .get(tenantId, from, to, from, to) as {
      deals_paid: number;
      revenue_usd: number;
      deals_sold: number;
      deals_delivered: number;
      deals_lost: number;
    };

    // Sesiones del período
    const sessionStats = this.db
      .prepare(
        `SELECT COUNT(*) as c, COALESCE(SUM(duration_minutes),0) as m
         FROM crm_sessions
         WHERE tenant_id = ? AND completed = 1
           AND scheduled_at >= ? AND scheduled_at <= ?`,
      )
      .get(tenantId, from, to) as { c: number; m: number };

    // Por producto
    const byProductRows = this.db
      .prepare(
        `SELECT product_type,
                COUNT(*) as deals,
                COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) as revenue_usd
         FROM crm_deals
         WHERE tenant_id = ?
           AND (paid_date >= ? AND paid_date <= ?
                OR (paid_date IS NULL AND created_at >= ? AND created_at <= ?))
         GROUP BY product_type`,
      )
      .all(tenantId, from, to, from, to) as Array<{
      product_type: string;
      deals: number;
      revenue_usd: number;
    }>;
    const by_product: Record<string, { deals: number; revenue_usd: number }> = {};
    for (const r of byProductRows)
      by_product[r.product_type] = { deals: r.deals, revenue_usd: r.revenue_usd };

    // Por día
    const byDayRows = this.db
      .prepare(
        `SELECT substr(paid_date, 1, 10) as day,
                COUNT(*) as deals_paid,
                COALESCE(SUM(amount), 0) as revenue_usd
         FROM crm_deals
         WHERE tenant_id = ? AND status = 'paid'
           AND paid_date >= ? AND paid_date <= ?
         GROUP BY day
         ORDER BY day`,
      )
      .all(tenantId, from, to) as Array<{ day: string; deals_paid: number; revenue_usd: number }>;

    return {
      deals_paid: summary.deals_paid || 0,
      revenue_usd: summary.revenue_usd || 0,
      deals_sold: summary.deals_sold || 0,
      deals_delivered: summary.deals_delivered || 0,
      deals_lost: summary.deals_lost || 0,
      sessions_completed: sessionStats.c || 0,
      sessions_minutes: sessionStats.m || 0,
      by_product,
      by_day: byDayRows,
    };
  }

  // ─── Events ──────────────────────────────────────────────────────────

  logEvent(
    tenantId: string,
    kind: string,
    payload: { contact_id?: string; deal_id?: string; [k: string]: unknown },
    source = 'academy-web',
  ): void {
    this.db
      .prepare(
        `INSERT INTO crm_events (tenant_id, kind, contact_id, deal_id, payload, source)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        tenantId,
        kind,
        payload.contact_id ?? null,
        payload.deal_id ?? null,
        JSON.stringify(payload),
        source,
      );
  }

  listEvents(
    tenantId: string,
    filter: { kind?: string; from?: string; to?: string; limit?: number } = {},
  ): CrmEventRecord[] {
    const clauses = ['tenant_id = ?'];
    const values: unknown[] = [tenantId];
    if (filter.kind) {
      clauses.push('kind = ?');
      values.push(filter.kind);
    }
    if (filter.from) {
      clauses.push('created_at >= ?');
      values.push(filter.from);
    }
    if (filter.to) {
      clauses.push('created_at <= ?');
      values.push(filter.to);
    }
    const limit = filter.limit ?? 100;
    return this.db
      .prepare(
        `SELECT * FROM crm_events WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...values, limit) as CrmEventRecord[];
  }
}
