/**
 * DatabaseManager — SQLite persistence layer for Gentle-Vanguard
 *
 * Singleton that manages:
 * - SQLite connection (`.runtime/gentle-vanguard.db`)
 * - Schema migrations (tracked in `_migrations` table)
 * - CRUD helpers for metrics, sessions, traces, events, alerts, feedback
 *
 * Replaces the fragmented JSON-file persistence with a single ACID database.
 */
import Database from 'better-sqlite3';
import { join, dirname, resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { getTimeout } from '../../../../src/core/timeout-config';

import { MigrationRunner } from './repositories/MigrationRunner';
import { MetricsRepo } from './repositories/MetricsRepo';
import { SessionRepo } from './repositories/SessionRepo';
import { TraceRepo } from './repositories/TraceRepo';
import { EventRepo } from './repositories/EventRepo';
import { CacheRepo } from './repositories/CacheRepo';
import { SkillRepo } from './repositories/SkillRepo';
import { ContractRepo } from './repositories/ContractRepo';
import { ErrorMemoryRepo } from './repositories/ErrorMemoryRepo';
import { HousekeepingRepo } from './repositories/HousekeepingRepo';
import { BacklogRepo } from './repositories/BacklogRepo';
import { AuthSessionRepo } from './repositories/AuthSessionRepo';
import { TokenRepo } from './repositories/TokenRepo';
import { PrincipalRepo } from './repositories/PrincipalRepo';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..', '..', '..');
const DB_DIR = resolve(process.env.GENTLE_VANGUARD_DB_DIR ?? join(ROOT, '.runtime'));
const DB_PATH = join(DB_DIR, process.env.GENTLE_VANGUARD_DB_FILE ?? 'gentle-vanguard.db');
export const DEFAULT_TENANT_ID = 'gentle-vanguard';

// ─── Types ────────────────────────────────────────────────────────────

export interface MetricSnapshot {
  id?: number;
  tenant_id: string;
  timestamp: string;
  tokens_used: number;
  tokens_limit: number;
  cost: number;
  sessions_total: number;
  sessions_active: number;
  sessions_today: number;
  latency_avg: number;
  latency_p50: number;
  latency_p95: number;
  commits: number;
  mcp_calls: number;
  mcp_skills: number;
  health_status: string;
}

export interface SessionRecord {
  id: string;
  tenant_id: string;
  agent: string;
  status: string;
  created_at: string;
  updated_at: string;
  tokens_used: number;
  cost: number;
  message_count: number;
  metadata?: string;
}

export interface TraceRecord {
  tenant_id: string;
  span_id: string;
  trace_id: string;
  parent_span_id?: string;
  name: string;
  start_time: number;
  end_time?: number;
  duration?: number;
  status: string;
  model?: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  session_id?: string;
  attributes?: string;
}

export interface EventRecord {
  id?: number;
  tenant_id: string;
  type: string;
  payload?: string;
  created_at: string;
}

export interface AlertRecord {
  id?: number;
  tenant_id: string;
  name: string;
  rule: string;
  severity: string;
  triggered: number;
  actual: number;
  threshold: number;
  transition?: string;
  created_at: string;
}

export interface FeedbackRecord {
  id?: number;
  tenant_id: string;
  trace_id: string;
  span_id: string;
  type: 'up' | 'down';
  created_at: string;
}

export interface ContractResultRecord {
  id?: number;
  contract_id: string;
  session_id?: string;
  status: string;
  result?: string;
  duration_ms?: number;
  created_at: string;
}

// ─── DatabaseManager ──────────────────────────────────────────────────

export class DatabaseManager {
  private db: Database.Database;
  private walCheckpointTimer: NodeJS.Timeout | null = null;
  private static instance: DatabaseManager | null = null;

  // Public repos
  readonly migrations: MigrationRunner;
  readonly metrics: MetricsRepo;
  readonly sessions: SessionRepo;
  readonly traces: TraceRepo;
  readonly events: EventRepo;
  readonly cache: CacheRepo;
  readonly skills: SkillRepo;
  readonly contracts: ContractRepo;
  readonly errors: ErrorMemoryRepo;
  readonly housekeepingRepo: HousekeepingRepo;
  readonly backlog: BacklogRepo;
  readonly authSessions: AuthSessionRepo;
  readonly tokens: TokenRepo;
  readonly principals: PrincipalRepo;

  private constructor() {
    if (!existsSync(DB_DIR)) {
      mkdirSync(DB_DIR, { recursive: true });
    }
    this.db = new Database(DB_PATH);
    this.db.pragma(`busy_timeout = ${getTimeout('database.sqlite_busy_timeout_ms', 5000)}`);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    // Keep the write-ahead log bounded during the dashboard's continuous writes.
    this.db.pragma('wal_autocheckpoint = 100');

    this.migrations = new MigrationRunner(this.db);
    this.metrics = new MetricsRepo(this.db);
    this.sessions = new SessionRepo(this.db);
    this.traces = new TraceRepo(this.db);
    this.events = new EventRepo(this.db);
    this.cache = new CacheRepo(this.db);
    this.skills = new SkillRepo(this.db);
    this.contracts = new ContractRepo(this.db);
    this.errors = new ErrorMemoryRepo(this.db);
    this.backlog = new BacklogRepo(this.db);
    this.housekeepingRepo = new HousekeepingRepo(this.db);
    this.authSessions = new AuthSessionRepo(this.db);
    this.tokens = new TokenRepo(this.db);
    this.principals = new PrincipalRepo(this.db);

    this.migrations.runMigrations();
    this.checkpointWal();
    this.walCheckpointTimer = setInterval(() => this.checkpointWal(), 60_000);
    this.walCheckpointTimer.unref();
  }

  /** Read-only access to the underlying SQLite connection for stack CLIs. */
  get database(): Database.Database {
    return this.db;
  }

  /** Checkpoint WAL without making dashboard requests fail if SQLite is busy. */
  private checkpointWal(): void {
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // A concurrent writer can temporarily prevent a checkpoint; the next tick retries.
    }
  }

  /** Get or create the singleton instance */
  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  static resetInstance(): void {
    if (DatabaseManager.instance) {
      if (DatabaseManager.instance.walCheckpointTimer) {
        clearInterval(DatabaseManager.instance.walCheckpointTimer);
        DatabaseManager.instance.walCheckpointTimer = null;
      }
      try {
        DatabaseManager.instance.db.close();
      } catch {
        // ignore close errors during test cleanup
      }
      DatabaseManager.instance = null;
    }
  }

  /** Run all pending migrations (idempotent) */
  runMigrations(): void {
    this.migrations.runMigrations();
  }

  /** Get the raw Database instance (for advanced queries) */
  getDb(): Database.Database {
    return this.db;
  }

  /** Check if the DB has data */
  hasData(tenantId = DEFAULT_TENANT_ID): boolean {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM metric_snapshots WHERE tenant_id = ?')
      .get(tenantId) as {
      count: number;
    };
    return row.count > 0;
  }

  // ─── Backward-compatible delegates ──────────────────────────────────

  insertMetricSnapshot(data: Partial<MetricSnapshot>, tenantId = DEFAULT_TENANT_ID): void {
    this.metrics.insertMetricSnapshot(tenantId, data);
  }
  getLatestMetricSnapshot(tenantId = DEFAULT_TENANT_ID): MetricSnapshot | null {
    return this.metrics.getLatestMetricSnapshot(tenantId);
  }
  getMetricHistory(limit = 20, since?: string, tenantId = DEFAULT_TENANT_ID): MetricSnapshot[] {
    return this.metrics.getMetricHistory(tenantId, limit, since);
  }
  pruneMetricSnapshots(keep = 1440, tenantId = DEFAULT_TENANT_ID): void {
    this.metrics.pruneMetricSnapshots(tenantId, keep);
  }

  upsertSession(session: Partial<SessionRecord>, tenantId = DEFAULT_TENANT_ID): void {
    this.sessions.upsertSession(tenantId, session);
  }
  getActiveSessions(tenantId = DEFAULT_TENANT_ID): SessionRecord[] {
    return this.sessions.getActiveSessions(tenantId);
  }
  getAllSessions(tenantId = DEFAULT_TENANT_ID): SessionRecord[] {
    return this.sessions.getAllSessions(tenantId);
  }
  getSessionsToday(tenantId = DEFAULT_TENANT_ID): SessionRecord[] {
    return this.sessions.getSessionsToday(tenantId);
  }

  saveSessionScoring(data: Parameters<SessionRepo['saveSessionScoring']>[0]): void {
    this.sessions.saveSessionScoring(data);
  }
  getSessionScoring(sessionId: string): Record<string, unknown> | null {
    return this.sessions.getSessionScoring(sessionId);
  }
  getAllSessionScoring(limit = 20): Array<Record<string, unknown>> {
    return this.sessions.getAllSessionScoring(limit);
  }

  insertTrace(trace: Partial<TraceRecord>, tenantId = DEFAULT_TENANT_ID): void {
    this.traces.insertTrace(tenantId, trace);
  }
  getTracesBySession(sessionId: string, tenantId = DEFAULT_TENANT_ID): TraceRecord[] {
    return this.traces.getTracesBySession(tenantId, sessionId);
  }
  getLatencyStats(tenantId = DEFAULT_TENANT_ID): ReturnType<TraceRepo['getLatencyStats']> {
    return this.traces.getLatencyStats(tenantId);
  }
  /** Compatibility delegate for legacy callers; new code should use traces directly. */
  insertFeedback(
    fb: Omit<FeedbackRecord, 'id' | 'created_at' | 'tenant_id'>,
    tenantId = DEFAULT_TENANT_ID,
  ): void {
    this.traces.insertFeedback(tenantId, fb);
  }
  getFeedbackStats(tenantId = DEFAULT_TENANT_ID): ReturnType<TraceRepo['getFeedbackStats']> {
    return this.traces.getFeedbackStats(tenantId);
  }

  insertEvent(type: string, payload?: unknown, tenantId = DEFAULT_TENANT_ID): void {
    this.events.insertEvent(tenantId, type, payload);
  }
  getRecentEvents(limit = 50, tenantId = DEFAULT_TENANT_ID): EventRecord[] {
    return this.events.getRecentEvents(tenantId, limit);
  }
  insertAlert(
    alert: Omit<AlertRecord, 'id' | 'created_at' | 'tenant_id'>,
    tenantId = DEFAULT_TENANT_ID,
  ): void {
    this.events.insertAlert(tenantId, alert);
  }
  getRecentAlerts(limit = 20, tenantId = DEFAULT_TENANT_ID): AlertRecord[] {
    return this.events.getRecentAlerts(tenantId, limit);
  }
  getTriggeredAlerts(tenantId = DEFAULT_TENANT_ID): AlertRecord[] {
    return this.events.getTriggeredAlerts(tenantId);
  }

  getCachedResponse(
    key: string,
    tenantId = DEFAULT_TENANT_ID,
  ): ReturnType<CacheRepo['getCachedResponse']> {
    return this.cache.getCachedResponse(tenantId, key);
  }
  setCachedResponse(
    key: string,
    response: string,
    model?: string,
    ttlMinutes = 30,
    tenantId = DEFAULT_TENANT_ID,
  ): void {
    this.cache.setCachedResponse(tenantId, key, response, model, ttlMinutes);
  }
  deleteCachedResponse(key: string, tenantId = DEFAULT_TENANT_ID): void {
    this.cache.deleteCachedResponse(tenantId, key);
  }
  getCacheStats(tenantId = DEFAULT_TENANT_ID): ReturnType<CacheRepo['getCacheStats']> {
    return this.cache.getCacheStats(tenantId);
  }
  saveSemanticCache(
    entry: Parameters<CacheRepo['saveSemanticCache']>[0],
    tenantId = DEFAULT_TENANT_ID,
  ): void {
    this.cache.saveSemanticCache(entry, tenantId);
  }
  findExactCache(
    key: string,
    tenantId = DEFAULT_TENANT_ID,
  ): ReturnType<CacheRepo['findExactCache']> {
    return this.cache.findExactCache(key, tenantId);
  }
  getAllCacheEntries(tenantId = DEFAULT_TENANT_ID): ReturnType<CacheRepo['getAllCacheEntries']> {
    return this.cache.getAllCacheEntries(tenantId);
  }
  pruneExpiredCache(): number {
    return this.cache.pruneExpiredCache();
  }

  recordSkillUsage(
    skillId: string,
    sessionId?: string,
    tokensUsed = 0,
    cost = 0,
    tenantId = DEFAULT_TENANT_ID,
  ): void {
    this.skills.recordSkillUsage(tenantId, skillId, sessionId, tokensUsed, cost);
  }
  getTopSkills(limit = 10, tenantId = DEFAULT_TENANT_ID): ReturnType<SkillRepo['getTopSkills']> {
    return this.skills.getTopSkills(tenantId, limit);
  }
  recordTokenUsage(
    sessionId: string,
    promptTokens: number,
    completionTokens: number,
    cost: number,
    model?: string,
    tenantId = DEFAULT_TENANT_ID,
  ): void {
    this.skills.recordTokenUsage(tenantId, sessionId, promptTokens, completionTokens, cost, model);
  }
  getTokenUsageBySession(
    sessionId: string,
    tenantId = DEFAULT_TENANT_ID,
  ): ReturnType<SkillRepo['getTokenUsageBySession']> {
    return this.skills.getTokenUsageBySession(tenantId, sessionId);
  }
  upsertRoutingRule(
    pattern: string,
    target: string,
    priority = 0,
    tenantId = DEFAULT_TENANT_ID,
  ): void {
    this.skills.upsertRoutingRule(tenantId, pattern, target, priority);
  }
  getEnabledRoutingRules(
    tenantId = DEFAULT_TENANT_ID,
  ): ReturnType<SkillRepo['getEnabledRoutingRules']> {
    return this.skills.getEnabledRoutingRules(tenantId);
  }
  recordRoutingHit(pattern: string, tenantId = DEFAULT_TENANT_ID): void {
    this.skills.recordRoutingHit(tenantId, pattern);
  }
  recordRoutingOutcome(
    pattern: string,
    target: string,
    success: boolean,
    tenantId = DEFAULT_TENANT_ID,
  ): void {
    this.skills.recordRoutingOutcome(tenantId, pattern, target, success);
  }

  addBacklogItem(
    item: Parameters<BacklogRepo['addItem']>[0],
    tenantId = DEFAULT_TENANT_ID,
  ): string {
    return this.backlog.addItem(item, tenantId);
  }
  getBacklogItem(id: string, tenantId = DEFAULT_TENANT_ID): ReturnType<BacklogRepo['getItem']> {
    return this.backlog.getItem(id, tenantId);
  }
  listBacklogItems(
    filter: Parameters<BacklogRepo['listItems']>[0] = {},
    tenantId = DEFAULT_TENANT_ID,
  ): ReturnType<BacklogRepo['listItems']> {
    return this.backlog.listItems(filter, tenantId);
  }
  getBacklogStats(tenantId = DEFAULT_TENANT_ID): ReturnType<BacklogRepo['getStats']> {
    return this.backlog.getStats(tenantId);
  }

  insertContractResult(
    contractId: string,
    status: string,
    sessionId?: string,
    result?: string,
    durationMs?: number,
  ): void {
    this.contracts.insertContractResult(contractId, status, sessionId, result, durationMs);
  }
  getContractResultsBySession(sessionId: string): ContractResultRecord[] {
    return this.contracts.getContractResultsBySession(sessionId);
  }

  saveErrorMemory(data: Parameters<ErrorMemoryRepo['saveErrorMemory']>[0]): number {
    return this.errors.saveErrorMemory(data);
  }
  findErrorsByFile(file: string): Array<Record<string, unknown>> {
    return this.errors.findErrorsByFile(file);
  }
  findErrorsByPattern(pattern: string): Array<Record<string, unknown>> {
    return this.errors.findErrorsByPattern(pattern);
  }
  searchErrors(keyword: string, limit = 5): Array<Record<string, unknown>> {
    return this.errors.searchErrors(keyword, limit);
  }
  getRecentErrors(limit = 20): Array<Record<string, unknown>> {
    return this.errors.getRecentErrors(limit);
  }
  getErrorById(id: number): Record<string, unknown> | null {
    return this.errors.getErrorById(id);
  }
  pruneErrorMemory(days = 365): number {
    return this.errors.pruneErrorMemory(days);
  }

  housekeeping(): void {
    this.housekeepingRepo.housekeeping();
  }
  pruneAll(): { events: number; cache: number; tokenUsage: number; skillUsage: number } {
    return this.housekeepingRepo.pruneAll();
  }

  /** Close the database connection */
  close(): void {
    this.db.close();
    console.log('[DB] Connection closed');
  }
}
