#!/usr/bin/env node
/**
 * Compact State Machine — formal state machine for review transactions with CAS guarantees.
 *
 * Implementa el patrón "Compact State + CAS + Recovery" del libro:
 *   - Cada transacción de review tiene una máquina de estado
 *   - CAS (Compare-And-Swap) para prevenir race conditions
 *   - Recovery point para rollback en caso de fallo
 *   - Fases: initiated → judges_started → verdict_ready → fixes_applied → approved | escalated
 *
 * Flags:
 *   --status           Show current state machine status
 *   --create <id>      Create new state machine instance
 *   --transition <id>  Transition to next phase
 *   --recovery <id>    Get recovery info for a failed transaction
 *   --rollback <id>    Rollback to previous safe state
 *   --gc               Garbage collect stale transactions (>24h)
 *   --quiet            Minimal output (pipeline mode)
 *   --dry-run          Preview without saving
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

// ─── Types ────────────────────────────────────────────────────────────

type TransactionPhase =
  | 'initiated'
  | 'judges_started'
  | 'verdict_ready'
  | 'fixes_applied'
  | 'approved'
  | 'escalated'
  | 'failed'
  | 'rolled_back';

type TransactionType = 'pre_push' | 'pre_merge' | 'session_start' | 'manual' | 'pipeline_phase';

interface CompactTransaction {
  id: string;
  type: TransactionType;
  phase: TransactionPhase;
  phaseHistory: {
    from: TransactionPhase;
    to: TransactionPhase;
    timestamp: string;
    reason: string;
    casToken: string;
  }[];
  scope: string;
  data: Record<string, unknown>;
  recoveryPoint: {
    snapshot: string;
    timestamp: string;
    casToken: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  metadata: Record<string, unknown>;
}

interface StateMachineConfig {
  version: string;
  outputDir: string;
  gcAfterHours: number;
  maxTransitionsPerInstance: number;
  requireCAS: boolean;
}

interface GcResult {
  removed: number;
  freed: string[];
}

// ─── Constants ─────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const CONFIG_PATH = join(ROOT, 'config', 'compact-state.json');
const DEFAULT_CONFIG: StateMachineConfig = {
  version: '1.0.0',
  outputDir: '.session/state-machine',
  gcAfterHours: 24,
  maxTransitionsPerInstance: 50,
  requireCAS: true,
};

const VALID_TRANSITIONS: Record<TransactionPhase, TransactionPhase[]> = {
  initiated: ['judges_started', 'failed', 'rolled_back'],
  judges_started: ['verdict_ready', 'failed', 'rolled_back', 'initiated'],
  verdict_ready: ['fixes_applied', 'approved', 'escalated', 'failed', 'rolled_back'],
  fixes_applied: ['judges_started', 'approved', 'escalated', 'failed', 'rolled_back'],
  approved: [],
  escalated: [],
  failed: ['initiated', 'rolled_back'],
  rolled_back: [],
};

// ─── Helpers ───────────────────────────────────────────────────────────

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadConfig(): StateMachineConfig {
  if (!existsSync(CONFIG_PATH)) return DEFAULT_CONFIG;
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function generateId(): string {
  return `SM-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function generateCasToken(): string {
  return `CAS-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadTransactions(config: StateMachineConfig): CompactTransaction[] {
  const dir = join(ROOT, config.outputDir);
  if (!existsSync(dir)) return [];
  const txs: CompactTransaction[] = [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    try {
      txs.push(JSON.parse(readFileSync(join(dir, file), 'utf-8')));
    } catch {
      /* skip corrupt */
    }
  }
  return txs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function saveTransaction(config: StateMachineConfig, tx: CompactTransaction): void {
  const dir = join(ROOT, config.outputDir);
  ensureDir(dir);
  writeFileSync(join(dir, `${tx.id}.json`), JSON.stringify(tx, null, 2));
}

function log(msg: string, level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' = 'INFO', quiet: boolean) {
  if (quiet) return;
  const colors: Record<string, string> = {
    INFO: '\x1b[36m',
    WARN: '\x1b[33m',
    ERROR: '\x1b[31m',
    SUCCESS: '\x1b[32m',
  };
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log(`${colors[level] ?? ''}[${ts}] [${level}] ${msg}\x1b[0m`);
}

// ─── Core API ──────────────────────────────────────────────────────────

export function createTransaction(opts: {
  type: TransactionType;
  scope: string;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  quiet?: boolean;
}): CompactTransaction {
  const config = loadConfig();
  const casToken = generateCasToken();
  const tx: CompactTransaction = {
    id: generateId(),
    type: opts.type,
    phase: 'initiated',
    phaseHistory: [
      {
        from: 'initiated',
        to: 'initiated',
        timestamp: new Date().toISOString(),
        reason: 'Transaction created',
        casToken,
      },
    ],
    scope: opts.scope,
    data: opts.data ?? {},
    recoveryPoint: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    metadata: opts.metadata ?? {},
  };
  saveTransaction(config, tx);
  log(`Created state machine ${tx.id}: ${tx.type}/${tx.scope}`, 'SUCCESS', opts.quiet ?? false);
  return tx;
}

export function transitionPhase(
  id: string,
  toPhase: TransactionPhase,
  reason: string,
  opts: { expectedCasToken?: string; quiet?: boolean } = {},
): { success: boolean; transaction?: CompactTransaction; error?: string } {
  const config = loadConfig();
  const txs = loadTransactions(config);
  const tx = txs.find((t) => t.id === id);
  if (!tx) return { success: false, error: `Transaction not found: ${id}` };

  const currentPhase = tx.phase;
  const allowed = VALID_TRANSITIONS[currentPhase];
  if (!allowed.includes(toPhase)) {
    return {
      success: false,
      error: `Invalid transition: ${currentPhase} → ${toPhase}. Allowed: ${allowed.join(', ')}`,
    };
  }

  // CAS check: if expectedCasToken provided, verify it matches the last transition's token
  if (config.requireCAS && opts.expectedCasToken) {
    const lastEntry = tx.phaseHistory[tx.phaseHistory.length - 1];
    if (lastEntry.casToken !== opts.expectedCasToken) {
      return {
        success: false,
        error: `CAS mismatch: expected ${opts.expectedCasToken}, got ${lastEntry.casToken}. Transaction may have been modified.`,
      };
    }
  }

  // Save recovery point before transitioning
  const recoveryPoint = {
    snapshot: JSON.stringify(tx),
    timestamp: new Date().toISOString(),
    casToken: generateCasToken(),
  };

  const newCasToken = generateCasToken();
  tx.phaseHistory.push({
    from: currentPhase,
    to: toPhase,
    timestamp: new Date().toISOString(),
    reason,
    casToken: newCasToken,
  });
  tx.phase = toPhase;
  tx.recoveryPoint = recoveryPoint as CompactTransaction['recoveryPoint'];
  tx.updatedAt = new Date().toISOString();
  if (toPhase === 'approved' || toPhase === 'escalated' || toPhase === 'rolled_back') {
    tx.completedAt = new Date().toISOString();
  }

  saveTransaction(config, tx);
  log(`Transition ${id}: ${currentPhase} → ${toPhase} (${reason})`, 'SUCCESS', opts.quiet ?? false);
  return { success: true, transaction: tx };
}

export function rollbackTransaction(
  id: string,
  reason: string,
  quiet = false,
): { success: boolean; transaction?: CompactTransaction; error?: string } {
  const config = loadConfig();
  const txs = loadTransactions(config);
  const tx = txs.find((t) => t.id === id);
  if (!tx) return { success: false, error: `Transaction not found: ${id}` };
  if (!tx.recoveryPoint) return { success: false, error: 'No recovery point available' };

  // CAS check on recovery point
  const lastEntry = tx.phaseHistory[tx.phaseHistory.length - 1];
  if (config.requireCAS && lastEntry.casToken !== tx.recoveryPoint.casToken) {
    return {
      success: false,
      error: 'CAS mismatch on recovery point. Manual intervention required.',
    };
  }

  const previousPhase = tx.phaseHistory[tx.phaseHistory.length - 1].from;
  const newCasToken = generateCasToken();
  tx.phaseHistory.push({
    from: tx.phase,
    to: 'rolled_back',
    timestamp: new Date().toISOString(),
    reason: `Rollback: ${reason}`,
    casToken: newCasToken,
  });
  tx.phase = 'rolled_back';
  tx.completedAt = new Date().toISOString();
  tx.updatedAt = new Date().toISOString();

  saveTransaction(config, tx);
  log(`Rolled back ${id} to ${previousPhase}: ${reason}`, 'WARN', quiet);
  return { success: true, transaction: tx };
}

export function getTransaction(id: string): CompactTransaction | null {
  const config = loadConfig();
  const txs = loadTransactions(config);
  return txs.find((t) => t.id === id) ?? null;
}

export function queryTransactions(filter: {
  type?: TransactionType;
  phase?: TransactionPhase;
  scope?: string;
  limit?: number;
}): CompactTransaction[] {
  const config = loadConfig();
  let txs = loadTransactions(config);
  if (filter.type) txs = txs.filter((t) => t.type === filter.type);
  if (filter.phase) txs = txs.filter((t) => t.phase === filter.phase);
  const scopeFilter = filter.scope;
  if (scopeFilter) txs = txs.filter((t) => t.scope.includes(scopeFilter));
  if (filter.limit) txs = txs.slice(0, filter.limit);
  return txs;
}

export function garbageCollect(quiet = false): GcResult {
  const config = loadConfig();
  const txs = loadTransactions(config);
  const cutoff = Date.now() - config.gcAfterHours * 3600000;
  const toRemove = txs.filter((t) => {
    if (
      t.phase !== 'approved' &&
      t.phase !== 'escalated' &&
      t.phase !== 'rolled_back' &&
      t.phase !== 'failed'
    )
      return false;
    const completed = t.completedAt
      ? new Date(t.completedAt).getTime()
      : new Date(t.updatedAt).getTime();
    return completed < cutoff;
  });

  const dir = join(ROOT, config.outputDir);
  for (const tx of toRemove) {
    try {
      const filePath = join(dir, `${tx.id}.json`);
      if (existsSync(filePath)) {
        rmSync(filePath, { force: true });
      }
    } catch {
      /* ignore */
    }
  }

  log(
    `GC removed ${toRemove.length} stale transactions`,
    toRemove.length > 0 ? 'INFO' : 'SUCCESS',
    quiet,
  );
  return { removed: toRemove.length, freed: toRemove.map((t) => t.id) };
}

// ─── CLI Handler ───────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let action = 'status';
  let txId = '';
  let quiet = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--status':
        action = 'status';
        break;
      case '--create':
        action = 'create';
        txId = args[++i] ?? '';
        break;
      case '--transition':
        action = 'transition';
        txId = args[++i] ?? '';
        break;
      case '--recovery':
        action = 'recovery';
        txId = args[++i] ?? '';
        break;
      case '--rollback':
        action = 'rollback';
        txId = args[++i] ?? '';
        break;
      case '--gc':
        action = 'gc';
        break;
      case '--quiet':
        quiet = true;
        break;
      case '--dry-run':
        dryRun = true;
        break;
    }
  }

  switch (action) {
    case 'status': {
      const txs = queryTransactions({});
      if (txs.length === 0) {
        console.log('No state machine instances.');
        break;
      }
      console.log('\n=== COMPACT STATE MACHINE STATUS ===');
      for (const t of txs) {
        console.log(
          `${t.id} | ${t.phase.padEnd(16)} | ${t.type.padEnd(14)} | ${t.scope.slice(0, 40)}`,
        );
      }
      break;
    }
    case 'create': {
      if (dryRun) {
        console.log('[DRY-RUN] Would create transaction');
        break;
      }
      const txType = (
        args.includes('--type') ? args[args.indexOf('--type') + 1] : 'manual'
      ) as TransactionType;
      const scope = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : 'cli';
      const tx = createTransaction({ type: txType, scope, quiet });
      console.log(JSON.stringify(tx, null, 2));
      break;
    }
    case 'transition': {
      if (!txId) {
        console.error('Provide ID with --transition <id>');
        process.exit(1);
      }
      const toPhase = (
        args.includes('--to') ? args[args.indexOf('--to') + 1] : 'approved'
      ) as TransactionPhase;
      const reason = args.includes('--reason')
        ? args[args.indexOf('--reason') + 1]
        : 'CLI transition';
      if (dryRun) {
        console.log(`[DRY-RUN] Would transition ${txId} → ${toPhase}`);
        break;
      }
      const result = transitionPhase(txId, toPhase, reason, { quiet });
      if (!result.success) {
        console.error(result.error);
        process.exit(1);
      }
      console.log(JSON.stringify(result.transaction, null, 2));
      break;
    }
    case 'recovery': {
      if (!txId) {
        console.error('Provide ID with --recovery <id>');
        process.exit(1);
      }
      const tx = getTransaction(txId);
      if (!tx) {
        console.error(`Transaction not found: ${txId}`);
        process.exit(1);
      }
      console.log('\n=== RECOVERY INFO ===');
      console.log(`Current phase: ${tx.phase}`);
      console.log(`Recovery point: ${tx.recoveryPoint ? tx.recoveryPoint.timestamp : 'None'}`);
      console.log(
        `Last transition: ${tx.phaseHistory[tx.phaseHistory.length - 1]?.reason ?? 'N/A'}`,
      );
      console.log(`Created: ${tx.createdAt}`);
      console.log(`Updated: ${tx.updatedAt}`);
      console.log(`Completed: ${tx.completedAt ?? 'Not completed'}`);
      break;
    }
    case 'rollback': {
      if (!txId) {
        console.error('Provide ID with --rollback <id>');
        process.exit(1);
      }
      const reason = args.includes('--reason')
        ? args[args.indexOf('--reason') + 1]
        : 'CLI rollback';
      if (dryRun) {
        console.log(`[DRY-RUN] Would rollback ${txId}`);
        break;
      }
      const result = rollbackTransaction(txId, reason, quiet);
      if (!result.success) {
        console.error(result.error);
        process.exit(1);
      }
      console.log(JSON.stringify(result.transaction, null, 2));
      break;
    }
    case 'gc': {
      if (dryRun) {
        console.log('[DRY-RUN] Would garbage collect stale transactions');
        break;
      }
      const result = garbageCollect(quiet);
      console.log(`Removed ${result.removed} stale transactions`);
      break;
    }
  }
}
