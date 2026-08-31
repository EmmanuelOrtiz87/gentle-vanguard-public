import Database from 'better-sqlite3';

export interface ContentItemRecord {
  id: string;
  title: string;
  brief: string;
  objective: string;
  voice: string;
  tags: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ContentVariantRecord {
  id: string;
  item_id: string;
  platform: string;
  format: string;
  body: string;
  image_prompt: string;
  image_path: string;
  spec_json: string;
  status: string;
  score: number | null;
  provider: string;
  created_at: string;
  updated_at: string;
}

export interface CalendarSlotRecord {
  id: string;
  item_id: string;
  variant_id: string | null;
  platform: string;
  scheduled_at: string;
  status: string;
  rationale: string;
  created_at: string;
  updated_at: string;
}

export interface MediaRecord {
  id: string;
  width: number | null;
  height: number | null;
  name: string;
  path: string;
  mime: string;
  size: number;
  alt: string;
  source: string;
  created_at: string;
}

export interface ContentOSRepo {
  // Items
  createItem(
    tenantId: string,
    data: Partial<ContentItemRecord> & { id: string; title: string },
  ): void;
  getItem(id: string, tenantId: string): ContentItemRecord | null;
  listItems(tenantId: string, filter?: { status?: string; limit?: number }): ContentItemRecord[];
  updateItem(
    id: string,
    tenantId: string,
    patch: Partial<
      Pick<ContentItemRecord, 'title' | 'brief' | 'objective' | 'voice' | 'tags' | 'status'>
    >,
  ): void;
  deleteItem(id: string, tenantId: string): void;

  // Variants
  createVariant(
    tenantId: string,
    data: Omit<ContentVariantRecord, 'created_at' | 'updated_at'>,
  ): void;
  getVariant(id: string, tenantId: string): ContentVariantRecord | null;
  listVariantsByItem(itemId: string, tenantId: string): ContentVariantRecord[];
  updateVariant(
    id: string,
    tenantId: string,
    patch: Partial<
      Pick<ContentVariantRecord, 'body' | 'image_prompt' | 'image_path' | 'status' | 'score'>
    >,
  ): void;

  // Calendar
  createSlot(tenantId: string, data: Omit<CalendarSlotRecord, 'created_at' | 'updated_at'>): void;
  listSlots(
    tenantId: string,
    filter?: { from?: string; to?: string; platform?: string },
  ): CalendarSlotRecord[];
  updateSlot(
    id: string,
    tenantId: string,
    patch: Partial<Pick<CalendarSlotRecord, 'status' | 'scheduled_at' | 'variant_id'>>,
  ): void;

  // Media
  createMedia(tenantId: string, data: Omit<MediaRecord, 'created_at'>): void;
  listMedia(tenantId: string, limit?: number): MediaRecord[];

  // Publish log
  logPublish(
    tenantId: string,
    variantId: string,
    platform: string,
    mode: string,
    action: string,
    payload?: unknown,
  ): void;
}

export class SqliteContentOSRepo implements ContentOSRepo {
  constructor(private db: Database.Database) {}

  createItem(
    tenantId: string,
    data: Partial<ContentItemRecord> & { id: string; title: string },
  ): void {
    this.db
      .prepare(
        `INSERT INTO content_items (id, tenant_id, title, brief, objective, voice, tags, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.id,
        tenantId,
        data.title,
        data.brief ?? '',
        data.objective ?? '',
        data.voice ?? '',
        data.tags ?? '[]',
        data.status ?? 'idea',
      );
  }

  getItem(id: string, tenantId: string): ContentItemRecord | null {
    return (
      (this.db
        .prepare('SELECT * FROM content_items WHERE id = ? AND tenant_id = ?')
        .get(id, tenantId) as ContentItemRecord | undefined) ?? null
    );
  }

  listItems(
    tenantId: string,
    filter: { status?: string; limit?: number } = {},
  ): ContentItemRecord[] {
    const limit = filter.limit ?? 100;
    if (filter.status) {
      return this.db
        .prepare(
          'SELECT * FROM content_items WHERE tenant_id = ? AND status = ? ORDER BY updated_at DESC LIMIT ?',
        )
        .all(tenantId, filter.status, limit) as ContentItemRecord[];
    }
    return this.db
      .prepare('SELECT * FROM content_items WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT ?')
      .all(tenantId, limit) as ContentItemRecord[];
  }

  updateItem(
    id: string,
    tenantId: string,
    patch: Partial<
      Pick<ContentItemRecord, 'title' | 'brief' | 'objective' | 'voice' | 'tags' | 'status'>
    >,
  ): void {
    const keys = Object.keys(patch).filter((k) => k !== 'id');
    if (!keys.length) return;
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => (patch as Record<string, unknown>)[k]);
    this.db
      .prepare(
        `UPDATE content_items SET ${sets}, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
      )
      .run(...values, id, tenantId);
  }

  deleteItem(id: string, tenantId: string): void {
    this.db.prepare('DELETE FROM content_items WHERE id = ? AND tenant_id = ?').run(id, tenantId);
  }

  createVariant(
    tenantId: string,
    data: Omit<ContentVariantRecord, 'created_at' | 'updated_at'>,
  ): void {
    this.db
      .prepare(
        `INSERT INTO content_variants
         (id, tenant_id, item_id, platform, format, body, image_prompt, image_path, spec_json, status, score, provider)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.id,
        tenantId,
        data.item_id,
        data.platform,
        data.format,
        data.body,
        data.image_prompt ?? '',
        data.image_path ?? '',
        data.spec_json ?? '{}',
        data.status ?? 'generated',
        data.score ?? null,
        data.provider ?? '',
      );
  }

  getVariant(id: string, tenantId: string): ContentVariantRecord | null {
    return (
      (this.db
        .prepare('SELECT * FROM content_variants WHERE id = ? AND tenant_id = ?')
        .get(id, tenantId) as ContentVariantRecord | undefined) ?? null
    );
  }

  listVariantsByItem(itemId: string, tenantId: string): ContentVariantRecord[] {
    return this.db
      .prepare(
        'SELECT * FROM content_variants WHERE item_id = ? AND tenant_id = ? ORDER BY platform',
      )
      .all(itemId, tenantId) as ContentVariantRecord[];
  }

  updateVariant(
    id: string,
    tenantId: string,
    patch: Partial<
      Pick<ContentVariantRecord, 'body' | 'image_prompt' | 'image_path' | 'status' | 'score'>
    >,
  ): void {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => (patch as Record<string, unknown>)[k]);
    const wasEdit = keys.some((k) => ['body', 'image_prompt', 'image_path'].includes(k));
    this.db
      .prepare(
        `UPDATE content_variants SET ${sets}, status = CASE WHEN ? = 1 THEN 'edited' ELSE status END, updated_at = datetime('now')
         WHERE id = ? AND tenant_id = ?`,
      )
      .run(...values, wasEdit ? 1 : 0, id, tenantId);
  }

  createSlot(tenantId: string, data: Omit<CalendarSlotRecord, 'created_at' | 'updated_at'>): void {
    this.db
      .prepare(
        `INSERT INTO calendar_slots (id, tenant_id, item_id, variant_id, platform, scheduled_at, status, rationale)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.id,
        tenantId,
        data.item_id,
        data.variant_id ?? null,
        data.platform,
        data.scheduled_at,
        data.status ?? 'proposed',
        data.rationale ?? '',
      );
  }

  listSlots(
    tenantId: string,
    filter: { from?: string; to?: string; platform?: string } = {},
  ): CalendarSlotRecord[] {
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
    if (filter.platform) {
      clauses.push('platform = ?');
      values.push(filter.platform);
    }
    return this.db
      .prepare(`SELECT * FROM calendar_slots WHERE ${clauses.join(' AND ')} ORDER BY scheduled_at`)
      .all(...values) as CalendarSlotRecord[];
  }

  updateSlot(
    id: string,
    tenantId: string,
    patch: Partial<Pick<CalendarSlotRecord, 'status' | 'scheduled_at' | 'variant_id'>>,
  ): void {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => (patch as Record<string, unknown>)[k]);
    this.db
      .prepare(
        `UPDATE calendar_slots SET ${sets}, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
      )
      .run(...values, id, tenantId);
  }

  createMedia(tenantId: string, data: Omit<MediaRecord, 'created_at'>): void {
    this.db
      .prepare(
        `INSERT INTO media_library (id, tenant_id, name, path, mime, size, width, height, alt, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.id,
        tenantId,
        data.name,
        data.path,
        data.mime,
        data.size,
        data.width ?? null,
        data.height ?? null,
        data.alt ?? '',
        data.source ?? 'upload',
      );
  }

  listMedia(tenantId: string, limit = 200): MediaRecord[] {
    return this.db
      .prepare('SELECT * FROM media_library WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(tenantId, limit) as MediaRecord[];
  }

  logPublish(
    tenantId: string,
    variantId: string,
    platform: string,
    mode: string,
    action: string,
    payload?: unknown,
  ): void {
    this.db
      .prepare(
        'INSERT INTO publish_log (tenant_id, variant_id, platform, mode, action, payload) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(tenantId, variantId, platform, mode, action, payload ? JSON.stringify(payload) : null);
  }
}
