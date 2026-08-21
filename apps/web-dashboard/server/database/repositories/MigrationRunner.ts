import Database from 'better-sqlite3';

const MIGRATIONS: Array<{ id: string; sql: string }> = [
  {
    id: '001_initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS metric_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        tokens_used INTEGER DEFAULT 0,
        tokens_limit INTEGER DEFAULT 120000,
        cost REAL DEFAULT 0,
        sessions_total INTEGER DEFAULT 0,
        sessions_active INTEGER DEFAULT 0,
        sessions_today INTEGER DEFAULT 0,
        latency_avg REAL DEFAULT 0,
        latency_p50 REAL DEFAULT 0,
        latency_p95 REAL DEFAULT 0,
        commits INTEGER DEFAULT 0,
        mcp_calls INTEGER DEFAULT 0,
        mcp_skills INTEGER DEFAULT 0,
        health_status TEXT DEFAULT 'unknown'
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent TEXT NOT NULL,
        status TEXT DEFAULT 'idle',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        tokens_used INTEGER DEFAULT 0,
        cost REAL DEFAULT 0,
        message_count INTEGER DEFAULT 0,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS traces (
        span_id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        parent_span_id TEXT,
        name TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        duration INTEGER,
        status TEXT DEFAULT 'running',
        model TEXT,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        cost REAL DEFAULT 0,
        session_id TEXT,
        attributes TEXT
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        payload TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        rule TEXT,
        severity TEXT,
        triggered INTEGER DEFAULT 0,
        actual REAL,
        threshold REAL,
        transition TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id TEXT NOT NULL,
        span_id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL CHECK(type IN ('up', 'down')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_metric_snapshots_ts ON metric_snapshots(timestamp);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent);
      CREATE INDEX IF NOT EXISTS idx_traces_trace_id ON traces(trace_id);
      CREATE INDEX IF NOT EXISTS idx_traces_session_id ON traces(session_id);
      CREATE INDEX IF NOT EXISTS idx_traces_status ON traces(status);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
      CREATE INDEX IF NOT EXISTS idx_alerts_name ON alerts(name);
      CREATE INDEX IF NOT EXISTS idx_feedback_span ON feedback(span_id);
    `,
  },
  {
    id: '002_stack_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS response_cache (
        key TEXT PRIMARY KEY,
        response TEXT NOT NULL,
        model TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT,
        hit_count INTEGER DEFAULT 0,
        tokens_saved INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS contract_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_id TEXT NOT NULL,
        session_id TEXT,
        status TEXT NOT NULL CHECK(status IN ('pass', 'fail', 'error', 'pending')),
        result TEXT,
        duration_ms INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS skill_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        skill_id TEXT NOT NULL,
        session_id TEXT,
        count INTEGER DEFAULT 1,
        tokens_used INTEGER DEFAULT 0,
        cost REAL DEFAULT 0,
        last_used TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(skill_id, session_id)
      );

      CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,
        cost REAL DEFAULT 0,
        model TEXT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS routing_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT NOT NULL,
        target TEXT NOT NULL,
        priority INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1,
        hit_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_response_cache_expires ON response_cache(expires_at);
      CREATE INDEX IF NOT EXISTS idx_contract_results_session ON contract_results(session_id);
      CREATE INDEX IF NOT EXISTS idx_contract_results_status ON contract_results(status);
      CREATE INDEX IF NOT EXISTS idx_skill_usage_skill ON skill_usage(skill_id);
      CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id);
      CREATE INDEX IF NOT EXISTS idx_token_usage_ts ON token_usage(timestamp);
      CREATE INDEX IF NOT EXISTS idx_routing_rules_pattern ON routing_rules(pattern);
    `,
  },
  {
    id: '003_session_scoring',
    sql: `
      CREATE TABLE IF NOT EXISTS session_scoring (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        quality_score REAL DEFAULT 100,
        success_rate REAL DEFAULT 100,
        total_delegations INTEGER DEFAULT 0,
        total_corrections INTEGER DEFAULT 0,
        total_proactive INTEGER DEFAULT 0,
        proactive_hits INTEGER DEFAULT 0,
        total_cloud_calls INTEGER DEFAULT 0,
        total_checkpoints INTEGER DEFAULT 0,
        total_tracing_spans INTEGER DEFAULT 0,
        total_audit_events INTEGER DEFAULT 0,
        summary_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_session_scoring_session ON session_scoring(session_id);
    `,
  },
  {
    id: '004_error_memory',
    sql: `
      CREATE TABLE IF NOT EXISTS error_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bug TEXT NOT NULL,
        root_cause TEXT,
        fix TEXT,
        file TEXT,
        pattern TEXT,
        severity TEXT DEFAULT 'medium',
        session_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS error_embeddings (
        error_id INTEGER NOT NULL,
        embedding TEXT NOT NULL,
        FOREIGN KEY (error_id) REFERENCES error_memory(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_error_memory_pattern ON error_memory(pattern);
      CREATE INDEX IF NOT EXISTS idx_error_memory_file ON error_memory(file);
      CREATE INDEX IF NOT EXISTS idx_error_memory_severity ON error_memory(severity);
      CREATE INDEX IF NOT EXISTS idx_error_memory_created ON error_memory(created_at);
    `,
  },
  {
    id: '005_semantic_cache',
    sql: `
      ALTER TABLE response_cache ADD COLUMN input_text TEXT DEFAULT '';
      ALTER TABLE response_cache ADD COLUMN input_embedding TEXT DEFAULT '{}';
    `,
  },
  {
    id: '006_backlog_system',
    sql: `
      CREATE TABLE IF NOT EXISTS backlog_items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('incident','bug','warning','error','requirement','task','gap')),
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        severity TEXT NOT NULL CHECK(severity IN ('critical','high','medium','low')) DEFAULT 'medium',
        status TEXT NOT NULL CHECK(status IN ('open','in_progress','resolved','wont_fix','backlog','duplicate')) DEFAULT 'open',
        source TEXT DEFAULT '',
        resolution_notes TEXT DEFAULT '',
        session_id TEXT,
        trace_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT
      );

      CREATE TABLE IF NOT EXISTS backlog_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT DEFAULT '#00bfff'
      );

      CREATE TABLE IF NOT EXISTS backlog_item_tags (
        item_id TEXT NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (item_id, tag_id),
        FOREIGN KEY (item_id) REFERENCES backlog_items(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES backlog_tags(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS backlog_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id TEXT NOT NULL,
        content TEXT NOT NULL,
        author TEXT DEFAULT 'system',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (item_id) REFERENCES backlog_items(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS backlog_status_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        reason TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (item_id) REFERENCES backlog_items(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS backlog_related_items (
        item_id TEXT NOT NULL,
        related_item_id TEXT NOT NULL,
        relation_type TEXT NOT NULL CHECK(relation_type IN ('duplicates','blocked_by','related','supersedes','child_of','parent_of')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (item_id, related_item_id, relation_type),
        FOREIGN KEY (item_id) REFERENCES backlog_items(id) ON DELETE CASCADE,
        FOREIGN KEY (related_item_id) REFERENCES backlog_items(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_backlog_items_status ON backlog_items(status);
      CREATE INDEX IF NOT EXISTS idx_backlog_items_type ON backlog_items(type);
      CREATE INDEX IF NOT EXISTS idx_backlog_items_severity ON backlog_items(severity);
      CREATE INDEX IF NOT EXISTS idx_backlog_items_created ON backlog_items(created_at);
      CREATE INDEX IF NOT EXISTS idx_backlog_items_session ON backlog_items(session_id);
      CREATE INDEX IF NOT EXISTS idx_backlog_comments_item ON backlog_comments(item_id);
      CREATE INDEX IF NOT EXISTS idx_backlog_status_history_item ON backlog_status_history(item_id);
      CREATE INDEX IF NOT EXISTS idx_backlog_related_items_item ON backlog_related_items(item_id);
    `,
  },
  {
    id: '007_backlog_traceability',
    sql: `
      ALTER TABLE backlog_items ADD COLUMN assignee_role TEXT DEFAULT 'any';
      ALTER TABLE backlog_items ADD COLUMN estimated_hours REAL;
      ALTER TABLE backlog_items ADD COLUMN actual_hours REAL;
      ALTER TABLE backlog_items ADD COLUMN priority INTEGER DEFAULT 3;
      ALTER TABLE backlog_items ADD COLUMN target_release TEXT;
      ALTER TABLE backlog_items ADD COLUMN environment TEXT DEFAULT 'all';
      ALTER TABLE backlog_items ADD COLUMN reported_by TEXT;
      ALTER TABLE backlog_items ADD COLUMN impact TEXT DEFAULT 'minor';
    `,
  },
];

export class MigrationRunner {
  constructor(private db: Database.Database) {}

  runMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    const applied = new Set(
      this.db
        .prepare('SELECT id FROM _migrations')
        .all()
        .map((r: any) => r.id),
    );

    for (const migration of MIGRATIONS) {
      if (!applied.has(migration.id)) {
        this.db.exec(migration.sql);
        this.db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(migration.id);
        console.log(`[DB] Migration applied: ${migration.id}`);
      }
    }
    console.log(
      `[DB] ${this.db.pragma('page_count', { simple: true })} pages, ${MIGRATIONS.length} migrations`,
    );
  }
}
