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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..', '..', '..');
const DB_DIR = resolve(process.env.GENTLE_VANGUARD_DB_DIR ?? join(ROOT, '.runtime'));
const DB_PATH = join(DB_DIR, process.env.GENTLE_VANGUARD_DB_FILE ?? 'gentle-vanguard.db');

// ─── Types ────────────────────────────────────────────────────────────

export interface MetricSnapshot {
  id?: number;
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
  type: string;
  payload?: string;
  created_at: string;
}

export interface AlertRecord {
  id?: number;
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

  private constructor() {
    if (!existsSync(DB_DIR)) {
      mkdirSync(DB_DIR, { recursive: true });
    }
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

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

    this.migrations.runMigrations();
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
  hasData(): boolean {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM metric_snapshots').get() as {
      count: number;
    };
    return row.count > 0;
  }

  // ─── Backward-compatible delegates ──────────────────────────────────

  insertMetricSnapshot(data: Partial<MetricSnapshot>): void {
    this.metrics.insertMetricSnapshot(data);
  }
  getLatestMetricSnapshot(): MetricSnapshot | null {
    return this.metrics.getLatestMetricSnapshot();
  }
  getMetricHistory(limit = 20): MetricSnapshot[] {
    return this.metrics.getMetricHistory(limit);
  }
  pruneMetricSnapshots(keep = 1440): void {
    this.metrics.pruneMetricSnapshots(keep);
  }

  upsertSession(session: Partial<SessionRecord>): void {
    this.sessions.upsertSession(session);
  }
  getActiveSessions(): SessionRecord[] {
    return this.sessions.getActiveSessions();
  }
  getAllSessions(): SessionRecord[] {
    return this.sessions.getAllSessions();
  }
  getSessionsToday(): SessionRecord[] {
    return this.sessions.getSessionsToday();
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

  insertTrace(trace: Partial<TraceRecord>): void {
    this.traces.insertTrace(trace);
  }
  getTracesBySession(sessionId: string): TraceRecord[] {
    return this.traces.getTracesBySession(sessionId);
  }
  getLatencyStats(): ReturnType<TraceRepo['getLatencyStats']> {
    return this.traces.getLatencyStats();
  }
  insertFeedback(fb: Omit<FeedbackRecord, 'id' | 'created_at'>): void {
    this.traces.insertFeedback(fb);
  }
  getFeedbackStats(): ReturnType<TraceRepo['getFeedbackStats']> {
    return this.traces.getFeedbackStats();
  }

  insertEvent(type: string, payload?: unknown): void {
    this.events.insertEvent(type, payload);
  }
  getRecentEvents(limit = 50): EventRecord[] {
    return this.events.getRecentEvents(limit);
  }
  insertAlert(alert: Omit<AlertRecord, 'id' | 'created_at'>): void {
    this.events.insertAlert(alert);
  }
  getRecentAlerts(limit = 20): AlertRecord[] {
    return this.events.getRecentAlerts(limit);
  }
  getTriggeredAlerts(): AlertRecord[] {
    return this.events.getTriggeredAlerts();
  }

  getCachedResponse(key: string): ReturnType<CacheRepo['getCachedResponse']> {
    return this.cache.getCachedResponse(key);
  }
  setCachedResponse(key: string, response: string, model?: string, ttlMinutes = 30): void {
    this.cache.setCachedResponse(key, response, model, ttlMinutes);
  }
  deleteCachedResponse(key: string): void {
    this.cache.deleteCachedResponse(key);
  }
  getCacheStats(): ReturnType<CacheRepo['getCacheStats']> {
    return this.cache.getCacheStats();
  }
  saveSemanticCache(entry: Parameters<CacheRepo['saveSemanticCache']>[0]): void {
    this.cache.saveSemanticCache(entry);
  }
  findExactCache(key: string): ReturnType<CacheRepo['findExactCache']> {
    return this.cache.findExactCache(key);
  }
  getAllCacheEntries(): ReturnType<CacheRepo['getAllCacheEntries']> {
    return this.cache.getAllCacheEntries();
  }
  pruneExpiredCache(): number {
    return this.cache.pruneExpiredCache();
  }

  recordSkillUsage(skillId: string, sessionId?: string, tokensUsed = 0, cost = 0): void {
    this.skills.recordSkillUsage(skillId, sessionId, tokensUsed, cost);
  }
  getTopSkills(limit = 10): ReturnType<SkillRepo['getTopSkills']> {
    return this.skills.getTopSkills(limit);
  }
  recordTokenUsage(
    sessionId: string,
    promptTokens: number,
    completionTokens: number,
    cost: number,
    model?: string,
  ): void {
    this.skills.recordTokenUsage(sessionId, promptTokens, completionTokens, cost, model);
  }
  getTokenUsageBySession(sessionId: string): ReturnType<SkillRepo['getTokenUsageBySession']> {
    return this.skills.getTokenUsageBySession(sessionId);
  }
  upsertRoutingRule(pattern: string, target: string, priority = 0): void {
    this.skills.upsertRoutingRule(pattern, target, priority);
  }
  getEnabledRoutingRules(): ReturnType<SkillRepo['getEnabledRoutingRules']> {
    return this.skills.getEnabledRoutingRules();
  }
  recordRoutingHit(pattern: string): void {
    this.skills.recordRoutingHit(pattern);
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
