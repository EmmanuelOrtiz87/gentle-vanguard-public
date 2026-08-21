/**
 * BacklogRepo — Incident, bug, warning, error, and requirement management
 *
 * Tables managed: backlog_items, backlog_tags, backlog_item_tags,
 *                 backlog_comments, backlog_status_history, backlog_related_items
 */
import Database from 'better-sqlite3';

export interface BacklogItem {
  id: string;
  type: 'incident' | 'bug' | 'warning' | 'error' | 'requirement' | 'task' | 'gap';
  title: string;
  description?: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'in_progress' | 'resolved' | 'wont_fix' | 'backlog' | 'duplicate';
  source?: string;
  resolution_notes?: string;
  session_id?: string;
  trace_id?: string;
  assignee_role?: string; // dev | po | qa | ux | ops | sec | any
  estimated_hours?: number; // estimated resolution time
  actual_hours?: number; // actual time spent
  priority?: number; // 1-5 numeric priority
  target_release?: string; // target version/release
  environment?: string; // dev | staging | prod | all
  reported_by?: string; // who reported it
  impact?: string; // blocking | major | minor | cosmetic
  created_at: string;
  updated_at: string;
  resolved_at?: string;
  tags?: string[];
}

export interface BacklogTag {
  id: number;
  name: string;
  color: string;
}

export interface BacklogComment {
  id: number;
  item_id: string;
  content: string;
  author: string;
  created_at: string;
}

export interface BacklogStatusChange {
  id: number;
  item_id: string;
  from_status: string | null;
  to_status: string;
  reason: string;
  created_at: string;
}

export interface BacklogFilter {
  type?: string;
  severity?: string;
  status?: string;
  tag?: string;
  search?: string;
  session_id?: string;
  limit?: number;
  offset?: number;
}

export class BacklogRepo {
  constructor(private db: Database.Database) {}

  // ─── Items ─────────────────────────────────────────────────────────

  /** Add a new backlog item. Returns the item ID. */
  addItem(item: Omit<BacklogItem, 'created_at' | 'updated_at' | 'id'> & { id?: string }): string {
    const id =
      item.id ??
      `BL-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const stmt = this.db.prepare(`
      INSERT INTO backlog_items (id, type, title, description, severity, status, source, resolution_notes,
        session_id, trace_id, assignee_role, estimated_hours, actual_hours, priority, target_release,
        environment, reported_by, impact, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      item.type,
      item.title,
      item.description ?? '',
      item.severity,
      item.status ?? 'open',
      item.source ?? '',
      item.resolution_notes ?? '',
      item.session_id ?? null,
      item.trace_id ?? null,
      item.assignee_role ?? 'any',
      item.estimated_hours ?? null,
      item.actual_hours ?? null,
      item.priority ?? 3,
      item.target_release ?? null,
      item.environment ?? 'all',
      item.reported_by ?? null,
      item.impact ?? 'minor',
      now,
      now,
    );

    // Record initial status history
    this.recordStatusChange(id, null, item.status ?? 'open', 'Item created');

    return id;
  }

  /** Update an existing backlog item. */
  updateItem(id: string, updates: Partial<BacklogItem>): void {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const fields: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    const updatable = [
      'title',
      'description',
      'severity',
      'resolution_notes',
      'source',
      'assignee_role',
      'estimated_hours',
      'actual_hours',
      'priority',
      'target_release',
      'environment',
      'reported_by',
      'impact',
    ] as const;

    for (const key of updatable) {
      const val = (updates as any)[key];
      if (val !== undefined) {
        fields.push(`${key} = ?`);
        params.push(val);
      }
    }

    if (updates.status !== undefined) {
      const current = this.getItem(id);
      const fromStatus = current?.status ?? null;
      fields.push('status = ?');
      params.push(updates.status);
      if (updates.status === 'resolved') {
        fields.push('resolved_at = ?');
        params.push(now);
      }
      this.recordStatusChange(id, fromStatus, updates.status, updates.resolution_notes ?? '');
    }

    params.push(id);
    this.db.prepare(`UPDATE backlog_items SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  }

  /** Get a single item by ID. */
  getItem(id: string): BacklogItem | null {
    const row = this.db
      .prepare(
        `
      SELECT bi.*, GROUP_CONCAT(DISTINCT bt.name) as tags
      FROM backlog_items bi
      LEFT JOIN backlog_item_tags bit ON bi.id = bit.item_id
      LEFT JOIN backlog_tags bt ON bit.tag_id = bt.id
      WHERE bi.id = ?
      GROUP BY bi.id
    `,
      )
      .get(id) as Record<string, unknown> | undefined;

    if (!row) return null;
    return this.rowToItem(row);
  }

  /** List items with optional filters. */
  listItems(filter: BacklogFilter = {}): BacklogItem[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    if (filter.type) {
      conditions.push('bi.type = ?');
      params.push(filter.type);
    }
    if (filter.severity) {
      conditions.push('bi.severity = ?');
      params.push(filter.severity);
    }
    if (filter.status) {
      conditions.push('bi.status = ?');
      params.push(filter.status);
    }
    if (filter.session_id) {
      conditions.push('bi.session_id = ?');
      params.push(filter.session_id);
    }
    if (filter.search) {
      conditions.push('(bi.title LIKE ? OR bi.description LIKE ?)');
      params.push(`%${filter.search}%`, `%${filter.search}%`);
    }
    if (filter.tag) {
      conditions.push(
        'bi.id IN (SELECT bit.item_id FROM backlog_item_tags bit JOIN backlog_tags bt ON bit.tag_id = bt.id WHERE bt.name = ?)',
      );
      params.push(filter.tag);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db
      .prepare(
        `
      SELECT bi.*, GROUP_CONCAT(DISTINCT bt.name) as tags
      FROM backlog_items bi
      LEFT JOIN backlog_item_tags bit ON bi.id = bit.item_id
      LEFT JOIN backlog_tags bt ON bit.tag_id = bt.id
      ${where}
      GROUP BY bi.id
      ORDER BY
        CASE bi.severity
          WHEN 'critical' THEN 0 WHEN 'high' THEN 1
          WHEN 'medium' THEN 2 WHEN 'low' THEN 3
        END,
        bi.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(...params, limit, offset) as Record<string, unknown>[];

    return rows.map((r) => this.rowToItem(r));
  }

  /** Count items matching filter. */
  countItems(filter: Omit<BacklogFilter, 'limit' | 'offset'> = {}): number {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.type) {
      conditions.push('type = ?');
      params.push(filter.type);
    }
    if (filter.severity) {
      conditions.push('severity = ?');
      params.push(filter.severity);
    }
    if (filter.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter.tag) {
      conditions.push(
        'id IN (SELECT bit.item_id FROM backlog_item_tags bit JOIN backlog_tags bt ON bit.tag_id = bt.id WHERE bt.name = ?)',
      );
      params.push(filter.tag);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const row = this.db
      .prepare(`SELECT COUNT(*) as count FROM backlog_items bi ${where}`)
      .get(...params) as { count: number };
    return row.count;
  }

  /** Delete an item and all related data (cascading). */
  deleteItem(id: string): void {
    this.db.prepare('DELETE FROM backlog_items WHERE id = ?').run(id);
  }

  /** Search for similar items by title/description (dedup prevention). */
  searchSimilar(query: string, limit = 5): BacklogItem[] {
    const rows = this.db
      .prepare(
        `
      SELECT bi.*, GROUP_CONCAT(DISTINCT bt.name) as tags
      FROM backlog_items bi
      LEFT JOIN backlog_item_tags bit ON bi.id = bit.item_id
      LEFT JOIN backlog_tags bt ON bit.tag_id = bt.id
      WHERE bi.title LIKE ? OR bi.description LIKE ?
      GROUP BY bi.id
      ORDER BY
        CASE
          WHEN bi.title LIKE ? THEN 0
          WHEN bi.description LIKE ? THEN 1
          ELSE 2
        END,
        bi.created_at DESC
      LIMIT ?
    `,
      )
      .all(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, limit) as Record<
      string,
      unknown
    >[];

    return rows.map((r) => this.rowToItem(r));
  }

  /** Get summary stats for dashboard/reporting. */
  getStats(): Record<string, unknown> {
    const total = (
      this.db.prepare('SELECT COUNT(*) as c FROM backlog_items').get() as { c: number }
    ).c;
    const byStatus = this.db
      .prepare(
        `
      SELECT status, COUNT(*) as count FROM backlog_items GROUP BY status
    `,
      )
      .all() as Array<{ status: string; count: number }>;
    const bySeverity = this.db
      .prepare(
        `
      SELECT severity, COUNT(*) as count FROM backlog_items GROUP BY severity
    `,
      )
      .all() as Array<{ severity: string; count: number }>;
    const byType = this.db
      .prepare(
        `
      SELECT type, COUNT(*) as count FROM backlog_items GROUP BY type
    `,
      )
      .all() as Array<{ type: string; count: number }>;
    const openCount = (
      this.db
        .prepare(
          "SELECT COUNT(*) as c FROM backlog_items WHERE status NOT IN ('resolved','wont_fix','duplicate')",
        )
        .get() as { c: number }
    ).c;

    return { total, open: openCount, byStatus, bySeverity, byType };
  }

  // ─── Tags ──────────────────────────────────────────────────────────

  /** Get or create a tag by name. */
  ensureTag(name: string, color = '#00bfff'): number {
    const existing = this.db.prepare('SELECT id FROM backlog_tags WHERE name = ?').get(name) as
      { id: number } | undefined;
    if (existing) return existing.id;
    const result = this.db
      .prepare('INSERT INTO backlog_tags (name, color) VALUES (?, ?)')
      .run(name, color);
    return Number(result.lastInsertRowid);
  }

  /** Add a tag to an item. */
  addTagToItem(itemId: string, tagName: string, tagColor = '#00bfff'): void {
    const tagId = this.ensureTag(tagName, tagColor);
    this.db
      .prepare('INSERT OR IGNORE INTO backlog_item_tags (item_id, tag_id) VALUES (?, ?)')
      .run(itemId, tagId);
  }

  /** Remove a tag from an item. */
  removeTagFromItem(itemId: string, tagName: string): void {
    this.db
      .prepare(
        `
      DELETE FROM backlog_item_tags WHERE item_id = ? AND tag_id = (SELECT id FROM backlog_tags WHERE name = ?)
    `,
      )
      .run(itemId, tagName);
  }

  /** List all tags. */
  listTags(): BacklogTag[] {
    return this.db.prepare('SELECT * FROM backlog_tags ORDER BY name').all() as BacklogTag[];
  }

  // ─── Comments ──────────────────────────────────────────────────────

  /** Add a comment to an item. */
  addComment(itemId: string, content: string, author = 'system'): number {
    const result = this.db
      .prepare('INSERT INTO backlog_comments (item_id, content, author) VALUES (?, ?, ?)')
      .run(itemId, content, author);
    return Number(result.lastInsertRowid);
  }

  /** Get comments for an item. */
  getComments(itemId: string): BacklogComment[] {
    return this.db
      .prepare('SELECT * FROM backlog_comments WHERE item_id = ? ORDER BY created_at ASC')
      .all(itemId) as BacklogComment[];
  }

  // ─── Status History ────────────────────────────────────────────────

  private recordStatusChange(
    itemId: string,
    from: string | null,
    to: string,
    reason: string,
  ): void {
    this.db
      .prepare(
        'INSERT INTO backlog_status_history (item_id, from_status, to_status, reason) VALUES (?, ?, ?, ?)',
      )
      .run(itemId, from, to, reason);
  }

  /** Get status history for an item. */
  getStatusHistory(itemId: string): BacklogStatusChange[] {
    return this.db
      .prepare('SELECT * FROM backlog_status_history WHERE item_id = ? ORDER BY created_at ASC')
      .all(itemId) as BacklogStatusChange[];
  }

  // ─── Related Items ─────────────────────────────────────────────────

  /** Link two items. */
  relateItems(itemId: string, relatedItemId: string, relationType: string): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO backlog_related_items (item_id, related_item_id, relation_type) VALUES (?, ?, ?)',
      )
      .run(itemId, relatedItemId, relationType);
  }

  /** Get related items. */
  getRelatedItems(itemId: string): Array<{ related_item_id: string; relation_type: string }> {
    return this.db
      .prepare('SELECT related_item_id, relation_type FROM backlog_related_items WHERE item_id = ?')
      .all(itemId) as Array<{ related_item_id: string; relation_type: string }>;
  }

  // ─── Pruning ───────────────────────────────────────────────────────

  /** Prune old resolved items (older than N days). Default: 365 days */
  pruneResolved(days = 365): number {
    const cutoff = new Date(Date.now() - days * 86400000)
      .toISOString()
      .replace('T', ' ')
      .substring(0, 19);
    const result = this.db
      .prepare(
        "DELETE FROM backlog_items WHERE status IN ('resolved','wont_fix','duplicate') AND updated_at < ?",
      )
      .run(cutoff);
    return result.changes;
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private rowToItem(row: Record<string, unknown>): BacklogItem {
    return {
      id: row.id as string,
      type: row.type as BacklogItem['type'],
      title: row.title as string,
      description: row.description as string,
      severity: row.severity as BacklogItem['severity'],
      status: row.status as BacklogItem['status'],
      source: row.source as string,
      resolution_notes: row.resolution_notes as string,
      session_id: row.session_id as string | undefined,
      trace_id: row.trace_id as string | undefined,
      assignee_role: row.assignee_role as string | undefined,
      estimated_hours: row.estimated_hours as number | undefined,
      actual_hours: row.actual_hours as number | undefined,
      priority: row.priority as number | undefined,
      target_release: row.target_release as string | undefined,
      environment: row.environment as string | undefined,
      reported_by: row.reported_by as string | undefined,
      impact: row.impact as string | undefined,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      resolved_at: row.resolved_at as string | undefined,
      tags: row.tags ? (row.tags as string).split(',').filter(Boolean) : [],
    };
  }
}
