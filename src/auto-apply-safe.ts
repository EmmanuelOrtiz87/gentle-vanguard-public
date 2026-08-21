#!/usr/bin/env node
/**
 * Auto-Apply Safe Threshold — engine ejecutivo para auto-aplicación
 *
 * Transforma el stack de "sugestivo" a "ejecutivo":
 *   Sugerencia → Evaluación (confianza + riesgo) → Auto-aplicación → Verificación → Rollback
 *
 * Flags:
 *   --apply          Execute pending auto-applications
 *   --check          Check what would be applied (dry-run)
 *   --report         Generate report of applied actions
 *   --rollback       Rollback last applied action if degraded
 *   --threshold N    Override confidence threshold (default: 0.8)
 *   --quiet          Minimal output
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

// ─── Types ────────────────────────────────────────────────────────────

interface SafeAction {
  id: string;
  type: 'budget' | 'deprecation' | 'norm' | 'config' | 'skill' | 'threshold';
  source: string;
  description: string;
  confidence: number;
  riskLevel: 'low' | 'medium' | 'high';
  autoApply: boolean;
  applyFn?: () => { success: boolean; error?: string };
  rollbackFn?: () => { success: boolean; error?: string };
  appliedAt?: string;
  result?: 'success' | 'failure' | 'rolled-back';
}

interface ActionLog {
  id: string;
  type: SafeAction['type'];
  appliedAt: string;
  confidence: number;
  result: SafeAction['result'];
  rollbackAt?: string;
  metrics?: {
    before: Record<string, number>;
    after: Record<string, number>;
    delta: Record<string, number>;
  };
}

interface SafeConfig {
  confidenceThreshold: number;
  maxDailyActions: number;
  requireStableWindow: number; // hours without warnings
  rollbackOnDegradation: boolean;
  degradationThreshold: number; // % drop to trigger rollback
  logRetentionDays: number;
}

// ─── Constants ─────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const LOG_DIR = join(ROOT, '.session', 'auto-apply');
const LOG_FILE = join(LOG_DIR, 'action-log.json');
// const CONFIG_PATH = join(ROOT, 'config', 'auto-apply-config.json'); // reserved
const GOV_DIR = join(ROOT, '.session', 'governor');
const NORMS_DB = join(ROOT, '.session', 'learned-norms.json');
const METRICS_PATH = join(ROOT, '.session', 'metrics-report.json');

const DEFAULT_CONFIG: SafeConfig = {
  confidenceThreshold: 0.8,
  maxDailyActions: 5,
  requireStableWindow: 24,
  rollbackOnDegradation: true,
  degradationThreshold: 15,
  logRetentionDays: 30,
};

// ─── Logger ────────────────────────────────────────────────────────────

function getLogger(quiet: boolean) {
  return (msg: string) => {
    if (!quiet) console.log(`[AUTO-APPLY] ${msg}`);
  };
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadJson<T>(path: string, fallback: T): T {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    /* ignore */
  }
  return fallback;
}

// ─── Action Evaluation ─────────────────────────────────────────────────

function evaluateConfidence(action: SafeAction): boolean {
  return action.confidence >= DEFAULT_CONFIG.confidenceThreshold && action.riskLevel !== 'high';
}

function isSystemStable(): boolean {
  try {
    const metrics = loadJson<Record<string, unknown>>(METRICS_PATH, {});
    const warnings = (metrics.warningsCount as number) || 0;
    const errors = (metrics.errorsCount as number) || 0;
    return warnings < 5 && errors === 0;
  } catch {
    return true; // Assume stable if can't check
  }
}

// ─── Actions ───────────────────────────────────────────────────────────

function getPendingBudgetActions(): SafeAction[] {
  const actions: SafeAction[] = [];

  // Read governor output files
  if (!existsSync(GOV_DIR)) return actions;

  const files = readdirSync(GOV_DIR).filter((f) => f.startsWith('governor-'));
  for (const file of files.slice(-3)) {
    // Last 3 reports
    try {
      const report = JSON.parse(readFileSync(join(GOV_DIR, file), 'utf-8'));
      const adj = report.budgetAdjustment;
      if (adj && adj.suggestedBudget !== adj.currentBudget && adj.confidence >= 0.6) {
        actions.push({
          id: `budget-${file.replace('governor-', '').replace('.json', '')}`,
          type: 'budget',
          source: 'predictive-governor',
          description: `Adjust budget: ${adj.currentBudget} → ${adj.suggestedBudget} (${adj.reason})`,
          confidence: adj.confidence,
          riskLevel: adj.confidence >= 0.8 ? 'low' : 'medium',
          autoApply: adj.confidence >= 0.8,
        });
      }
    } catch {
      /* skip unparseable */
    }
  }

  return actions;
}

function getPendingDeprecationActions(): SafeAction[] {
  const actions: SafeAction[] = [];
  const evoDir = join(ROOT, '.session', 'evolution');

  if (!existsSync(evoDir)) return actions;

  const files = readdirSync(evoDir).filter((f) => f.startsWith('evolution-'));
  for (const file of files.slice(-1)) {
    // Latest report
    try {
      const report = JSON.parse(readFileSync(join(evoDir, file), 'utf-8'));
      if (report.deprecations) {
        for (const dep of report.deprecations) {
          if (dep.daysSinceUse >= 30 && dep.suggestedAction === 'archive') {
            actions.push({
              id: `dep-${dep.skillName}-${Date.now()}`,
              type: 'deprecation',
              source: 'skill-evolution-engine',
              description: `Archive unused skill: ${dep.skillName} (${dep.daysSinceUse} days unused)`,
              confidence: 0.9,
              riskLevel: 'low',
              autoApply: true,
            });
          }
        }
      }
    } catch {
      /* skip */
    }
  }

  return actions;
}

function getPendingNormActions(): SafeAction[] {
  const actions: SafeAction[] = [];
  const norms = loadJson<
    Array<{
      id: string;
      description: string;
      confidence: number;
      status: string;
      occurrences: number;
    }>
  >(NORMS_DB, []);

  for (const norm of norms) {
    if (norm.status === 'proposed' && norm.confidence >= 80 && norm.occurrences >= 3) {
      actions.push({
        id: `norm-${norm.id}-${Date.now()}`,
        type: 'norm',
        source: 'auto-norm-learner',
        description: `Promote norm: ${norm.description.slice(0, 80)}`,
        confidence: norm.confidence / 100,
        riskLevel: norm.confidence >= 90 ? 'low' : 'medium',
        autoApply: norm.confidence >= 90,
      });
    }
  }

  return actions;
}

/**
 * Read real-time trigger files from .session/auto-apply/trigger-*.json.
 * Three sources emit triggers:
 *   - predictive-governor => trigger-budget.json
 *   - skill-evolution-engine => trigger-archive-*.json
 *   - auto-norm-learner => trigger-norms.json
 */
const TRIGGER_DIR = join(ROOT, '.session', 'auto-apply');

function getPendingTriggerActions(): SafeAction[] {
  const actions: SafeAction[] = [];
  if (!existsSync(TRIGGER_DIR)) return actions;

  const files = readdirSync(TRIGGER_DIR).filter(
    (f) => f.startsWith('trigger-') && f.endsWith('.json'),
  );
  for (const file of files) {
    try {
      const trigger = JSON.parse(readFileSync(join(TRIGGER_DIR, file), 'utf-8'));
      let action: SafeAction | null = null;

      switch (trigger.type) {
        case 'budget-adjustment':
          action = {
            id: `trigger-budget-${file.replace('trigger-budget.', '').replace('.json', '')}`,
            type: 'budget',
            source: trigger.source || 'predictive-governor',
            description: trigger.description || `Budget adjustment (trigger)`,
            confidence: trigger.confidence ?? 0.85,
            riskLevel: (trigger.confidence ?? 0.85) >= 0.8 ? 'low' : 'medium',
            autoApply: (trigger.confidence ?? 0.85) >= 0.8,
          };
          break;

        case 'skill-archive':
          action = {
            id: `trigger-archive-${trigger.skillName || file.replace('.json', '')}`,
            type: 'deprecation',
            source: trigger.source || 'skill-evolution-engine',
            description: trigger.description || `Archive skill: ${trigger.skillName || 'unknown'}`,
            confidence: trigger.confidence ?? 0.9,
            riskLevel: 'low',
            autoApply: (trigger.confidence ?? 0.9) >= 0.8,
          };
          break;

        case 'norm-promotion':
          action = {
            id: `trigger-norm-${trigger.promotedCount || Date.now()}`,
            type: 'norm',
            source: trigger.source || 'auto-norm-learner',
            description:
              trigger.description || `Auto-promote ${trigger.promotedCount || 0} norm(s) (trigger)`,
            confidence: 0.85,
            riskLevel: 'medium',
            autoApply: true,
          };
          break;
      }

      if (action) actions.push(action);

      // Remove processed trigger file so it doesn't re-fire
      try {
        writeFileSync(
          join(TRIGGER_DIR, file),
          JSON.stringify(
            { ...trigger, processed: true, processedAt: new Date().toISOString() },
            null,
            2,
          ),
          'utf-8',
        );
      } catch {
        /* non-fatal */
      }
    } catch {
      /* skip unparseable trigger */
    }
  }

  return actions;
}

// ─── Apply & Rollback ──────────────────────────────────────────────────

function applyBudgetAdjustment(action: SafeAction): { success: boolean; error?: string } {
  const budgetFile = join(ROOT, '.session', 'token-budget.json');
  if (!existsSync(budgetFile)) return { success: false, error: 'Budget file not found' };

  try {
    const budget = JSON.parse(readFileSync(budgetFile, 'utf-8'));
    const match = action.description.match(/→\s*(\d+)/);
    if (!match) return { success: false, error: 'Could not parse budget from description' };

    const newLimit = parseInt(match[1], 10);
    budget.limit = newLimit;
    budget.autoApplied = true;
    budget.appliedAt = new Date().toISOString();
    writeFileSync(budgetFile, JSON.stringify(budget, null, 2), 'utf-8');

    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function applyDeprecation(action: SafeAction): { success: boolean; error?: string } {
  // Create deprecation marker file
  const depDir = join(ROOT, '.session', 'deprecations');
  ensureDir(depDir);

  const depFile = join(depDir, `${action.id}.json`);
  writeFileSync(
    depFile,
    JSON.stringify(
      {
        actionId: action.id,
        description: action.description,
        appliedAt: new Date().toISOString(),
        type: 'deprecation',
      },
      null,
      2,
    ),
    'utf-8',
  );

  return { success: true };
}

function applyNormPromotion(action: SafeAction): { success: boolean; error?: string } {
  const norms = loadJson<Array<Record<string, unknown>>>(NORMS_DB, []);
  const normId = action.id.replace('norm-', '').split('-')[0];

  const norm = norms.find((n) => n.id === normId);
  if (!norm) return { success: false, error: `Norm ${normId} not found` };

  norm.status = 'active';
  norm.promotedAt = new Date().toISOString();
  writeFileSync(NORMS_DB, JSON.stringify(norms, null, 2), 'utf-8');

  return { success: true };
}

function executeAction(action: SafeAction): { success: boolean; error?: string } {
  switch (action.type) {
    case 'budget':
      return applyBudgetAdjustment(action);
    case 'deprecation':
      return applyDeprecation(action);
    case 'norm':
      return applyNormPromotion(action);
    default:
      return { success: false, error: `Unknown action type: ${action.type}` };
  }
}

// ─── Logging ───────────────────────────────────────────────────────────

function loadLog(): ActionLog[] {
  return loadJson<ActionLog[]>(LOG_FILE, []);
}

function saveLog(log: ActionLog[]): void {
  ensureDir(LOG_DIR);
  writeFileSync(LOG_FILE, JSON.stringify(log, null, 2), 'utf-8');
}

function appendLog(entry: ActionLog): void {
  const log = loadLog();
  log.push(entry);

  // Prune old entries
  const cutoff = Date.now() - DEFAULT_CONFIG.logRetentionDays * 86400000;
  const filtered = log.filter((e) => new Date(e.appliedAt).getTime() > cutoff);

  saveLog(filtered);
}

function getMetricsSnapshot(): Record<string, number> {
  try {
    return loadJson<Record<string, number>>(METRICS_PATH, {});
  } catch {
    return {};
  }
}

// ─── Rollback ──────────────────────────────────────────────────────────

function checkDegradation(actionLog: ActionLog[]): ActionLog | null {
  if (!DEFAULT_CONFIG.rollbackOnDegradation) return null;

  for (const entry of actionLog.slice().reverse()) {
    if (entry.result !== 'success' || entry.rollbackAt) continue;
    if (!entry.metrics) continue;

    // Check if quality degraded
    const after = entry.metrics.after;
    const before = entry.metrics.before;

    const qualityDrop =
      before.qualityScore && after.qualityScore
        ? ((before.qualityScore - after.qualityScore) / before.qualityScore) * 100
        : 0;

    if (qualityDrop > DEFAULT_CONFIG.degradationThreshold) {
      return entry;
    }
  }

  return null;
}

function performRollback(entry: ActionLog): boolean {
  try {
    // Restore previous budget if applicable
    if (entry.type === 'budget' && entry.metrics) {
      const budgetFile = join(ROOT, '.session', 'token-budget.json');
      if (existsSync(budgetFile)) {
        const budget = JSON.parse(readFileSync(budgetFile, 'utf-8'));
        budget.limit = entry.metrics.before.budgetLimit || budget.limit;
        budget.rolledBack = true;
        budget.rolledBackAt = new Date().toISOString();
        writeFileSync(budgetFile, JSON.stringify(budget, null, 2), 'utf-8');
      }
    }

    entry.result = 'rolled-back';
    entry.rollbackAt = new Date().toISOString();
    const log = loadLog();
    const idx = log.findIndex((e) => e.id === entry.id);
    if (idx >= 0) {
      log[idx] = entry;
      saveLog(log);
    }

    return true;
  } catch {
    return false;
  }
}

// ─── Main ──────────────────────────────────────────────────────────────

function parseArgs(): { action: string; threshold: number; quiet: boolean } {
  const args = {
    action: 'check' as string,
    threshold: DEFAULT_CONFIG.confidenceThreshold,
    quiet: false,
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--apply') args.action = 'apply';
    else if (arg === '--check') args.action = 'check';
    else if (arg === '--report') args.action = 'report';
    else if (arg === '--rollback') args.action = 'rollback';
    else if (arg.startsWith('--threshold=')) args.threshold = parseFloat(arg.split('=')[1]);
    else if (arg === '--quiet') args.quiet = true;
  }

  return args;
}

function main(): void {
  const args = parseArgs();
  const log = getLogger(args.quiet);
  const threshold = args.threshold || DEFAULT_CONFIG.confidenceThreshold;

  // Override config threshold
  const config = { ...DEFAULT_CONFIG, confidenceThreshold: threshold };

  if (args.action === 'rollback') {
    log('Checking for degradation...');
    const actionLog = loadLog();
    const degraded = checkDegradation(actionLog);

    if (degraded) {
      log(`Degradation detected! Rolling back ${degraded.id}...`);
      const ok = performRollback(degraded);
      console.log(JSON.stringify({ rollback: ok ? 'success' : 'failed', actionId: degraded.id }));
    } else {
      log('No degradation detected');
      console.log(JSON.stringify({ rollback: 'none' }));
    }
    return;
  }

  if (args.action === 'check') {
    log(`Checking pending actions (threshold: ${threshold})...`);

    const pending = [
      ...getPendingBudgetActions(),
      ...getPendingDeprecationActions(),
      ...getPendingNormActions(),
      ...getPendingTriggerActions(),
    ];

    const stable = isSystemStable();
    const applicable = pending.filter((a) => a.autoApply && evaluateConfidence(a));

    console.log(
      JSON.stringify({
        total: pending.length,
        autoApplicable: applicable.length,
        systemStable: stable,
        threshold,
        actions: pending.map((a) => ({
          id: a.id,
          type: a.type,
          confidence: a.confidence,
          riskLevel: a.riskLevel,
          autoApply: a.autoApply,
          willApply: applicable.includes(a),
          description: a.description.slice(0, 100),
        })),
      }),
    );

    if (!stable) {
      log('⚠️  System not stable — auto-apply deferred');
    }

    return;
  }

  if (args.action === 'apply') {
    log(`Applying pending actions (threshold: ${threshold})...`);

    if (!isSystemStable()) {
      log('⚠️  System not stable — skipping auto-apply');
      console.log(JSON.stringify({ applied: 0, error: 'system_unstable' }));
      return;
    }

    const pending = [
      ...getPendingBudgetActions(),
      ...getPendingDeprecationActions(),
      ...getPendingNormActions(),
      ...getPendingTriggerActions(),
    ];

    const applicable = pending.filter((a) => a.autoApply && evaluateConfidence(a));

    if (applicable.length === 0) {
      log('No auto-applicable actions found');
      console.log(JSON.stringify({ applied: 0 }));
      return;
    }

    const beforeMetrics = getMetricsSnapshot();
    let applied = 0;
    let failed = 0;

    for (const action of applicable.slice(0, config.maxDailyActions)) {
      log(`Applying: ${action.id} — ${action.description.slice(0, 80)}`);

      const result = executeAction(action);

      if (result.success) {
        const afterMetrics = getMetricsSnapshot();
        const entry: ActionLog = {
          id: action.id,
          type: action.type,
          appliedAt: new Date().toISOString(),
          confidence: action.confidence,
          result: 'success',
          metrics: {
            before: beforeMetrics,
            after: afterMetrics,
            delta: {},
          },
        };
        appendLog(entry);
        applied++;
        log(`  ✓ Applied successfully`);
      } else {
        appendLog({
          id: action.id,
          type: action.type,
          appliedAt: new Date().toISOString(),
          confidence: action.confidence,
          result: 'failure',
        });
        failed++;
        log(`  ✗ Failed: ${result.error}`);
      }
    }

    // Check for degradation after apply
    if (applied > 0) {
      const actionLog = loadLog();
      const degraded = checkDegradation(actionLog);
      if (degraded) {
        log(`⚠️  Degradation detected after apply! Rolling back...`);
        performRollback(degraded);
      }
    }

    console.log(JSON.stringify({ applied, failed }));
    return;
  }

  if (args.action === 'report') {
    const actionLog = loadLog();
    const today = new Date().toISOString().slice(0, 10);
    const todayActions = actionLog.filter((e) => e.appliedAt.startsWith(today));

    console.log(
      JSON.stringify({
        totalActions: actionLog.length,
        todayActions: todayActions.length,
        successRate:
          actionLog.length > 0
            ? Math.round(
                (actionLog.filter((e) => e.result === 'success').length / actionLog.length) * 100,
              )
            : 0,
        rollbacks: actionLog.filter((e) => e.result === 'rolled-back').length,
        breakdown: {
          budget: actionLog.filter((e) => e.type === 'budget').length,
          deprecation: actionLog.filter((e) => e.type === 'deprecation').length,
          norm: actionLog.filter((e) => e.type === 'norm').length,
        },
        recentActions: actionLog.slice(-5).map((e) => ({
          id: e.id,
          type: e.type,
          result: e.result,
          appliedAt: e.appliedAt,
        })),
      }),
    );
    return;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
