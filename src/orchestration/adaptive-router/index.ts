import { writeFileSync } from 'fs';
import { isAbsolute, join } from 'path';
import { createRequire } from 'module';
import type { DatabaseManager } from '../../database/nexus//manager.js';
import type { RouterArgs, RoutingTable } from './types.js';
import {
  ROOT,
  ROUTING_TABLE_FILE,
  ROUTING_CONFIG,
  DEFAULT_CONFIG,
  loadJson,
  getLogger,
  ensureDir,
  now,
} from './config.js';
import { buildRoutingTable, formatStatus } from './table.js';

const _require = createRequire(import.meta.url);

// Lazy db import for SQLite dual-write
let _db: DatabaseManager | null = null;
export function getDb(): DatabaseManager | null {
  if (!_db) {
    try {
      const mod = _require('../../database/nexus//manager');
      _db = mod.DatabaseManager.getInstance();
    } catch {
      // SQLite not available — skip dual-write
    }
  }
  return _db;
}

/**
 * DI injection point (STACK-EVOLUTION-PLAN F2.6 batch 2).
 * Container-injected db handle takes precedence over the lazy require().
 */
export function setAdaptiveRouterDb(handle: DatabaseManager | null): void {
  _db = handle;
}

// ─── Main ─────────────────────────────────────────────────────────────

export function parseArgs(argv: string[]): RouterArgs {
  const args: RouterArgs = {
    mode: 'build',
    quiet: false,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--build') args.mode = 'build';
    else if (arg === '--override') args.mode = 'override';
    else if (arg === '--status') args.mode = 'status';
    else if (arg === '--reset') args.mode = 'reset';
    else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--dry-run') args.dryRun = true;
  }
  return args;
}

export function main(): void {
  const args = parseArgs(process.argv);
  const log = getLogger(args.quiet);

  log('[ADAPTIVE-ROUTER] Starting...');

  // 1. Load config
  const config = loadJson<typeof DEFAULT_CONFIG>(ROUTING_CONFIG, DEFAULT_CONFIG);
  // outputDir puede ser relativo (config real) o absoluto (fallback DEFAULT_CONFIG)
  const outputDir = isAbsolute(config.outputDir) ? config.outputDir : join(ROOT, config.outputDir);
  ensureDir(outputDir);

  // 2. Handle reset
  if (args.mode === 'reset') {
    const defaultTable: RoutingTable = {
      version: '1.0.0',
      builtAt: now(),
      agentPerformance: [],
      domainEntries: [],
      overrides: [],
      summary: { totalAgents: 0, totalDomains: 0, totalOverrides: 0, overallConfidence: 0 },
    };
    if (!args.dryRun) {
      writeFileSync(ROUTING_TABLE_FILE, JSON.stringify(defaultTable, null, 2), 'utf-8');
      // SQLite dual-write: clear routing rules
      try {
        const mgr = getDb();
        if (mgr) {
          /* routing_rules table cleared on next upsert */
        }
      } catch {
        /* */
      }
    }
    log('[OK] Routing table reset to defaults');
    if (!args.quiet) console.log(JSON.stringify(defaultTable.summary));
    return;
  }

  // 3. Build routing table
  if (args.mode === 'build' || args.mode === 'override') {
    const table = buildRoutingTable(config, log);

    if (!args.dryRun) {
      writeFileSync(ROUTING_TABLE_FILE, JSON.stringify(table, null, 2), 'utf-8');
      log(
        `[OK] Routing table saved: ${table.summary.totalAgents} agents, ${table.summary.totalDomains} domains, ${table.summary.totalOverrides} overrides`,
      );

      // SQLite dual-write: upsert each domain entry as a routing rule
      try {
        const mgr = getDb();
        if (mgr) {
          for (const entry of table.domainEntries) {
            mgr.upsertRoutingRule(
              entry.domain,
              entry.bestAgent,
              Math.round(entry.confidence * 100),
            );
          }
          log(`[OK] Synced ${table.domainEntries.length} routing rules to SQLite`);
        }
      } catch {
        // Dual-write failure is non-critical
      }
    }

    // Override mode: also apply overrides
    if (args.mode === 'override' && !args.dryRun) {
      log(`[OK] ${table.overrides.length} overrides ready for consumption by orchestrator`);
    }

    if (!args.quiet) {
      console.log(
        JSON.stringify({
          agents: table.summary.totalAgents,
          domains: table.summary.totalDomains,
          overrides: table.summary.totalOverrides,
          confidence: table.summary.overallConfidence,
        }),
      );
    }
    return;
  }

  // 4. Status mode
  if (args.mode === 'status') {
    const table = loadJson<RoutingTable>(ROUTING_TABLE_FILE, null as unknown as RoutingTable);
    if (!table || table.summary.totalAgents === 0) {
      log('[INFO] No routing table found. Run --build first.');
      return;
    }
    const status = formatStatus(table);
    if (!args.quiet) console.log(`\n${status}\n`);
    return;
  }
}
