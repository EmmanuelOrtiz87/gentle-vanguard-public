/**
 * Skill usage recorder — writes real skill usage into the Nexus `skill_usage`
 * table (upsert keyed on skill_id + session_id + tenant_id, same semantics as
 * apps/web-dashboard SkillRepo.recordSkillUsage).
 *
 * Design:
 * - Failure-tolerant: any DB error is swallowed (recording must never break a
 *   skill serve path); best-effort single inserts.
 * - Library-only: wired at the skill-loader match/serve point; the skill-loader
 *   CLI explicitly disables recording so stdout paths stay untouched.
 * - `source` is accepted for provenance; the current schema has no source
 *   column, so it is NOT persisted (documented — no fabrication).
 *
 * Backfill (--backfill): derives rows from REAL historical evidence in
 * `.atl/skill-stats.json` (callsBySkill counters maintained by the MCP skill
 * server). No evidence → no rows (nothing is fabricated).
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';
import type { Database } from 'better-sqlite3';

const _require = createRequire(import.meta.url);

/** Minimal shape of the DatabaseManager used to obtain the shared connection. */
interface DbProvider {
  getDb: () => Database;
}

let _provider: DbProvider | null | undefined;

function resolveDb(): Database | null {
  if (_provider !== undefined) return _provider ? _provider.getDb() : null;
  try {
    const mod = _require('../../apps/web-dashboard/server/database/manager') as {
      DatabaseManager: { getInstance: () => DbProvider };
    };
    _provider = mod.DatabaseManager.getInstance();
  } catch {
    _provider = null; // SQLite/manager unavailable — recording disabled
  }
  return _provider ? _provider.getDb() : null;
}

/** Test seam: inject an in-memory DB (or null to simulate no DB). */
export function setDbProviderForTests(provider: DbProvider | null): void {
  _provider = provider;
}

export interface SkillUsageInput {
  skillId: string;
  sessionId?: string;
  tokensUsed?: number;
  cost?: number;
  tenantId?: string;
  /** Provenance label (e.g. 'skill-loader:match'). Not persisted — schema has no column. */
  source?: string;
}

/**
 * Records one skill usage. Idempotent increment: repeated calls bump `count`,
 * accumulate tokens/cost and refresh `last_used` (mirrors SkillRepo).
 * Returns true when a row was actually written.
 */
export function recordSkillUsage(input: SkillUsageInput): boolean {
  try {
    const db = resolveDb();
    if (!db) return false;
    writeSkillUsageRow(db, input);
    return true;
  } catch {
    return false; // recording must never break the serve path
  }
}

/** Core writer, exposed for direct-DB callers and tests. */
export function writeSkillUsageRow(db: Database, input: SkillUsageInput): void {
  db.prepare(
    `INSERT INTO skill_usage (tenant_id, skill_id, session_id, count, tokens_used, cost, last_used)
     VALUES (?, ?, ?, 1, ?, ?, datetime('now'))
     ON CONFLICT(skill_id, session_id, tenant_id) DO UPDATE SET
       count = count + 1,
       tokens_used = tokens_used + excluded.tokens_used,
       cost = cost + excluded.cost,
       last_used = datetime('now')`,
  ).run(
    input.tenantId ?? 'gentle-vanguard',
    input.skillId,
    input.sessionId ?? 'global',
    input.tokensUsed ?? 0,
    input.cost ?? 0,
  );
}

/** Resolves the current session id from the session dir (best-effort, optional). */
export function readCurrentSessionId(sessionDir?: string): string | undefined {
  try {
    const dir = sessionDir ?? join(process.cwd(), '.session');
    const current = join(dir, 'session-current.json');
    if (existsSync(current)) {
      const data = JSON.parse(readFileSync(current, 'utf-8')) as {
        sessionId?: string;
        id?: string;
      };
      return data.sessionId ?? data.id;
    }
  } catch {
    /* best-effort */
  }
  return undefined;
}

/* ── Backfill from real evidence (.atl/skill-stats.json) ── */

interface SkillStatsFile {
  totalCalls?: number;
  callsBySkill?: Record<string, number>;
  lastCall?: string | null;
}

/**
 * Backfills skill_usage from the MCP skill server's persistent stats counters.
 * These are REAL recorded calls (not fabricated). Session ids are unknown for
 * historical calls → NULL (counted globally), last_used from stats.lastCall.
 * Returns the number of skills backfilled, or null if no evidence exists.
 */
export function backfillSkillUsageFromStats(
  db: Database,
  statsPath: string,
  opts: { tenantId?: string; dryRun?: boolean } = {},
): { skills: number; skipped: boolean } {
  if (!existsSync(statsPath)) return { skills: 0, skipped: true };
  let stats: SkillStatsFile;
  try {
    stats = JSON.parse(readFileSync(statsPath, 'utf-8')) as SkillStatsFile;
  } catch {
    return { skills: 0, skipped: true };
  }
  const callsBySkill = stats.callsBySkill ?? {};
  const entries = Object.entries(callsBySkill).filter(([, c]) => Number(c) > 0);
  if (entries.length === 0) return { skills: 0, skipped: true };

  const tenantId = opts.tenantId ?? 'gentle-vanguard';
  const lastUsed = stats.lastCall
    ? new Date(stats.lastCall).toISOString().replace('T', ' ').slice(0, 19)
    : undefined;

  if (!opts.dryRun) {
    const insert = db.prepare(
      `INSERT INTO skill_usage (tenant_id, skill_id, session_id, count, tokens_used, cost, last_used)
       VALUES (?, ?, NULL, ?, 0, 0, COALESCE(?, datetime('now')))
       ON CONFLICT(skill_id, session_id, tenant_id) DO UPDATE SET
         count = MAX(count, excluded.count),
         last_used = excluded.last_used`,
    );
    for (const [skillId, count] of entries) {
      insert.run(tenantId, skillId, Math.trunc(Number(count)), lastUsed);
    }
  }
  return { skills: entries.length, skipped: false };
}

/* ── CLI: --backfill ── */

function main(): void {
  const args = process.argv.slice(2);
  if (!args.includes('--backfill')) {
    console.log(`Skill usage recorder (library module).

Usage:
  npx tsx src/knowledge/skill-usage-recorder.ts --backfill [--dry-run]   # derive rows from .atl/skill-stats.json

Library use: recordSkillUsage({ skillId, sessionId? }) — wired at the
skill-loader match/serve point; never throws.`);
    return;
  }
  const statsPath = join(process.cwd(), '.atl', 'skill-stats.json');
  let db: Database;
  try {
    const mod = _require('../../apps/web-dashboard/server/database/manager') as {
      DatabaseManager: { getInstance: () => DbProvider };
    };
    db = mod.DatabaseManager.getInstance().getDb();
  } catch (e) {
    console.error(`[ERROR] Cannot open Nexus DB: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
    return;
  }
  const result = backfillSkillUsageFromStats(db, statsPath, {
    dryRun: args.includes('--dry-run'),
  });
  if (result.skipped) {
    console.log('[INFO] No skill usage evidence found (.atl/skill-stats.json) — nothing backfilled.');
  } else {
    console.log(
      `[OK] ${args.includes('--dry-run') ? 'Would backfill' : 'Backfilled'} ${result.skills} skill(s) from real stats evidence.`,
    );
  }
}

import { pathToFileURL } from 'url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
