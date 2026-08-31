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
  {
    id: '008_operational_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_metric_snapshots_timestamp_desc ON metric_snapshots(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_created_at_desc ON sessions(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_updated_at_desc ON sessions(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_traces_start_time_desc ON traces(start_time DESC);
      CREATE INDEX IF NOT EXISTS idx_traces_session_start ON traces(session_id, start_time DESC);
      CREATE INDEX IF NOT EXISTS idx_traces_trace_start ON traces(trace_id, start_time ASC);
      CREATE INDEX IF NOT EXISTS idx_events_created_type ON events(created_at DESC, type);
      CREATE INDEX IF NOT EXISTS idx_alerts_triggered_created ON alerts(triggered, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_feedback_trace ON feedback(trace_id);
      CREATE INDEX IF NOT EXISTS idx_token_usage_session_timestamp ON token_usage(session_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_token_usage_model_timestamp ON token_usage(model, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_contract_results_created ON contract_results(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_skill_usage_last_used ON skill_usage(last_used DESC);
      CREATE INDEX IF NOT EXISTS idx_error_memory_session_created ON error_memory(session_id, created_at DESC);
    `,
  },
  {
    id: '009_tenant_isolation_slice',
    sql: `
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS principals (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL UNIQUE,
        display_name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS memberships (
        tenant_id TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (tenant_id, principal_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        FOREIGN KEY (principal_id) REFERENCES principals(id) ON DELETE CASCADE
      );

      INSERT INTO tenants (id, name)
      VALUES ('gentle-vanguard', 'Gentle Vanguard')
      ON CONFLICT(id) DO NOTHING;

      ALTER TABLE metric_snapshots ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard';
      ALTER TABLE sessions ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard';
      ALTER TABLE events ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard';

      UPDATE metric_snapshots SET tenant_id = 'gentle-vanguard' WHERE tenant_id IS NULL OR tenant_id = '';
      UPDATE sessions SET tenant_id = 'gentle-vanguard' WHERE tenant_id IS NULL OR tenant_id = '';
      UPDATE events SET tenant_id = 'gentle-vanguard' WHERE tenant_id IS NULL OR tenant_id = '';

      CREATE INDEX IF NOT EXISTS idx_metric_snapshots_tenant_timestamp
        ON metric_snapshots(tenant_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_tenant_updated
        ON sessions(tenant_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_events_tenant_created
        ON events(tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memberships_principal
        ON memberships(principal_id, tenant_id);
    `,
  },
  {
    id: '010_dashboard_auth_sessions',
    sql: `
      CREATE TABLE IF NOT EXISTS dashboard_auth_sessions (
        id_hash TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard'
      );
      CREATE INDEX IF NOT EXISTS idx_dashboard_auth_sessions_expires_at
        ON dashboard_auth_sessions(expires_at);
    `,
  },
  {
    id: '011_observability_tenant_isolation',
    sql: `
      ALTER TABLE traces ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard';
      ALTER TABLE token_usage ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard';
      ALTER TABLE alerts ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard';
      CREATE TABLE feedback_tenant (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id TEXT NOT NULL,
        span_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('up', 'down')),
        tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(span_id, tenant_id)
      );
      INSERT INTO feedback_tenant (id, trace_id, span_id, type, created_at)
        SELECT id, trace_id, span_id, type, created_at FROM feedback;
      DROP TABLE feedback;
      ALTER TABLE feedback_tenant RENAME TO feedback;
      CREATE TABLE response_cache_tenant (
        key TEXT NOT NULL,
        response TEXT NOT NULL,
        model TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT,
        hit_count INTEGER DEFAULT 0,
        tokens_saved INTEGER DEFAULT 0,
        input_text TEXT DEFAULT '',
        input_embedding TEXT DEFAULT '{}',
        tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard',
        PRIMARY KEY (key, tenant_id)
      );
      INSERT INTO response_cache_tenant
        (key, response, model, created_at, expires_at, hit_count, tokens_saved, input_text, input_embedding)
        SELECT key, response, model, created_at, expires_at, hit_count, tokens_saved,
               COALESCE(input_text, ''), COALESCE(input_embedding, '{}') FROM response_cache;
      DROP TABLE response_cache;
      ALTER TABLE response_cache_tenant RENAME TO response_cache;

      CREATE TABLE IF NOT EXISTS token_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
         message_id TEXT NOT NULL,
        session_id TEXT,
        agent TEXT,
        model TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        reasoning_tokens INTEGER,
        cache_read_tokens INTEGER,
        cache_write_tokens INTEGER,
        cost REAL,
        created_at TEXT,
         tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard',
         UNIQUE(message_id, tenant_id)
      );

      UPDATE traces SET tenant_id = 'gentle-vanguard' WHERE tenant_id IS NULL OR tenant_id = '';
      UPDATE token_usage SET tenant_id = 'gentle-vanguard' WHERE tenant_id IS NULL OR tenant_id = '';
      UPDATE alerts SET tenant_id = 'gentle-vanguard' WHERE tenant_id IS NULL OR tenant_id = '';
      UPDATE feedback SET tenant_id = 'gentle-vanguard' WHERE tenant_id IS NULL OR tenant_id = '';
      UPDATE response_cache SET tenant_id = 'gentle-vanguard' WHERE tenant_id IS NULL OR tenant_id = '';
      UPDATE token_transactions SET tenant_id = 'gentle-vanguard' WHERE tenant_id IS NULL OR tenant_id = '';

      CREATE INDEX IF NOT EXISTS idx_traces_tenant_start ON traces(tenant_id, start_time DESC);
      CREATE INDEX IF NOT EXISTS idx_token_usage_tenant_timestamp ON token_usage(tenant_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_token_transactions_tenant_created ON token_transactions(tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_alerts_tenant_created ON alerts(tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_feedback_tenant_created ON feedback(tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_response_cache_tenant_expires ON response_cache(tenant_id, expires_at);
    `,
  },
  {
    id: '012_backlog_routing_skill_tenant_isolation',
    sql: `
      ALTER TABLE backlog_items ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard';
      UPDATE backlog_items SET tenant_id = 'gentle-vanguard' WHERE tenant_id IS NULL OR tenant_id = '';

      CREATE TABLE skill_usage_tenant (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        skill_id TEXT NOT NULL,
        session_id TEXT,
        count INTEGER DEFAULT 1,
        tokens_used INTEGER DEFAULT 0,
        cost REAL DEFAULT 0,
        last_used TEXT NOT NULL DEFAULT (datetime('now')),
        tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard',
        UNIQUE(skill_id, session_id, tenant_id)
      );
      INSERT INTO skill_usage_tenant
        (id, skill_id, session_id, count, tokens_used, cost, last_used)
        SELECT id, skill_id, session_id, count, tokens_used, cost, last_used FROM skill_usage;
      DROP TABLE skill_usage;
      ALTER TABLE skill_usage_tenant RENAME TO skill_usage;

      CREATE TABLE routing_rules_tenant (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT NOT NULL,
        target TEXT NOT NULL,
        priority INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1,
        hit_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard',
        UNIQUE(pattern, tenant_id)
      );
      INSERT INTO routing_rules_tenant
        (id, pattern, target, priority, enabled, hit_count, created_at, updated_at)
        SELECT id, pattern, target, priority, enabled, hit_count, created_at, updated_at FROM routing_rules;
      DROP TABLE routing_rules;
      ALTER TABLE routing_rules_tenant RENAME TO routing_rules;

      CREATE INDEX IF NOT EXISTS idx_backlog_items_tenant_created
        ON backlog_items(tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_backlog_items_tenant_status
        ON backlog_items(tenant_id, status);
      CREATE INDEX IF NOT EXISTS idx_skill_usage_tenant_skill
        ON skill_usage(tenant_id, skill_id);
      CREATE INDEX IF NOT EXISTS idx_skill_usage_tenant_last_used
        ON skill_usage(tenant_id, last_used DESC);
      CREATE INDEX IF NOT EXISTS idx_skill_usage_skill ON skill_usage(skill_id);
      CREATE INDEX IF NOT EXISTS idx_skill_usage_last_used ON skill_usage(last_used DESC);
      CREATE INDEX IF NOT EXISTS idx_routing_rules_tenant_enabled
        ON routing_rules(tenant_id, enabled, priority DESC, hit_count DESC);
      CREATE INDEX IF NOT EXISTS idx_routing_rules_tenant_pattern
        ON routing_rules(tenant_id, pattern);
      CREATE INDEX IF NOT EXISTS idx_routing_rules_pattern ON routing_rules(pattern);
    `,
  },
  {
    id: '013_token_transaction_tenant_key',
    sql: `
      CREATE TABLE token_transactions_tenant (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        session_id TEXT,
        agent TEXT,
        model TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        reasoning_tokens INTEGER,
        cache_read_tokens INTEGER,
        cache_write_tokens INTEGER,
        cost REAL,
        created_at TEXT,
        tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard',
        UNIQUE(message_id, tenant_id)
      );
      INSERT INTO token_transactions_tenant
        (id, message_id, session_id, agent, model, input_tokens, output_tokens,
         reasoning_tokens, cache_read_tokens, cache_write_tokens, cost, created_at, tenant_id)
        SELECT id, message_id, session_id, agent, model, input_tokens, output_tokens,
               reasoning_tokens, cache_read_tokens, cache_write_tokens, cost, created_at, tenant_id
        FROM token_transactions;
      DROP TABLE token_transactions;
      ALTER TABLE token_transactions_tenant RENAME TO token_transactions;
      CREATE INDEX IF NOT EXISTS idx_token_transactions_tenant_created
        ON token_transactions(tenant_id, created_at DESC);
    `,
  },
  {
    id: '014_rbac_session_binding',
    sql: `
      ALTER TABLE dashboard_auth_sessions ADD COLUMN principal_id TEXT;
      ALTER TABLE dashboard_auth_sessions ADD COLUMN csrf_hash TEXT;
      CREATE INDEX IF NOT EXISTS idx_dashboard_auth_sessions_principal
        ON dashboard_auth_sessions(principal_id);
    `,
  },
  {
    id: '015_routing_outcome_metrics',
    sql: `
      UPDATE routing_rules
      SET success_rate = CASE WHEN hit_count > 0 THEN success_count * 100.0 / hit_count ELSE 0 END;
      CREATE INDEX IF NOT EXISTS idx_routing_rules_tenant_success
        ON routing_rules(tenant_id, enabled, success_rate DESC, hit_count DESC);
    `,
  },
  {
    id: '016_token_savings',
    sql: `
      CREATE TABLE IF NOT EXISTS token_savings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT,
        session_id TEXT,
        category TEXT,
        saved_tokens INTEGER,
        source TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard',
        UNIQUE(message_id, category, tenant_id)
      );
      CREATE INDEX IF NOT EXISTS idx_token_savings_tenant_created
        ON token_savings(tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_token_savings_tenant_category
        ON token_savings(tenant_id, category);
    `,
  },
  {
    id: '017_cache_telemetry',
    sql: `
      ALTER TABLE metric_snapshots ADD COLUMN cache_hits INTEGER DEFAULT 0;
      ALTER TABLE metric_snapshots ADD COLUMN cache_misses INTEGER DEFAULT 0;
      ALTER TABLE metric_snapshots ADD COLUMN cache_hit_rate REAL DEFAULT 0;
      ALTER TABLE response_cache ADD COLUMN last_access TEXT;
      CREATE INDEX IF NOT EXISTS idx_response_cache_last_access
        ON response_cache(COALESCE(last_access, created_at));
    `,
  },
  {
    id: '018_content_os',
    sql: `
      CREATE TABLE IF NOT EXISTS content_items (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard',
        title TEXT NOT NULL,
        brief TEXT NOT NULL DEFAULT '',
        objective TEXT DEFAULT '',
        voice TEXT DEFAULT '',
        tags TEXT DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'idea'
          CHECK(status IN ('idea','draft','ready','scheduled','published','archived')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS content_variants (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard',
        item_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        format TEXT NOT NULL DEFAULT 'text' CHECK(format IN ('text','image','text_image')),
        body TEXT NOT NULL DEFAULT '',
        image_prompt TEXT DEFAULT '',
        image_path TEXT DEFAULT '',
        spec_json TEXT DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'generated'
          CHECK(status IN ('generated','edited','approved','rejected','published')),
        score REAL,
        provider TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (item_id) REFERENCES content_items(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS media_library (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard',
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER DEFAULT 0,
        width INTEGER,
        height INTEGER,
        alt TEXT DEFAULT '',
        source TEXT NOT NULL DEFAULT 'upload' CHECK(source IN ('upload','generated')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS calendar_slots (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard',
        item_id TEXT NOT NULL,
        variant_id TEXT,
        platform TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'proposed'
          CHECK(status IN ('proposed','confirmed','published','skipped')),
        rationale TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (item_id) REFERENCES content_items(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS publish_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard',
        variant_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'assisted' CHECK(mode IN ('assisted','api','manual')),
        action TEXT NOT NULL,
        payload TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_content_items_tenant_status
        ON content_items(tenant_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_content_variants_item
        ON content_variants(item_id, platform);
      CREATE INDEX IF NOT EXISTS idx_calendar_slots_item
        ON calendar_slots(item_id, scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_calendar_slots_tenant_sched
        ON calendar_slots(tenant_id, scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_publish_log_variant
        ON publish_log(variant_id, created_at DESC);
    `,
  },
];

export class MigrationRunner {
  constructor(private db: Database.Database) {}

  runMigrations(): void {
    this.db.transaction(() => {
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
          if (migration.id === '011_observability_tenant_isolation') {
            const table = this.db
              .prepare(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'token_transactions'",
              )
              .get();
            const column = table
              ? this.db
                  .prepare(
                    "SELECT 1 FROM pragma_table_info('token_transactions') WHERE name = 'tenant_id'",
                  )
                  .get()
              : true;
            if (table && !column) {
              this.db.exec(
                "ALTER TABLE token_transactions ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard'",
              );
            }
          }
          if (migration.id === '015_routing_outcome_metrics') {
            const columns = new Set(
              this.db
                .prepare("SELECT name FROM pragma_table_info('routing_rules')")
                .all()
                .map((row: any) => row.name),
            );
            if (!columns.has('success_count')) {
              this.db.exec(
                'ALTER TABLE routing_rules ADD COLUMN success_count INTEGER NOT NULL DEFAULT 0',
              );
            }
            if (!columns.has('success_rate')) {
              this.db.exec(
                'ALTER TABLE routing_rules ADD COLUMN success_rate REAL NOT NULL DEFAULT 0',
              );
            }
          }
          if (migration.id === '016_token_savings') {
            const table = this.db
              .prepare(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'token_savings'",
              )
              .get();
            const column = table
              ? this.db
                  .prepare(
                    "SELECT 1 FROM pragma_table_info('token_savings') WHERE name = 'tenant_id'",
                  )
                  .get()
              : true;
            if (table && !column) {
              this.db.exec(
                "ALTER TABLE token_savings ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard'",
              );
            }
          }
          this.db.exec(migration.sql);
          this.db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(migration.id);
          console.log(`[DB] Migration applied: ${migration.id}`);
        }
      }
    })();
    console.log(
      `[DB] ${this.db.pragma('page_count', { simple: true })} pages, ${MIGRATIONS.length} migrations`,
    );
  }
}
