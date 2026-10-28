// Data/state checks (F2.5 split): Tracing, State Persistence, gentle-vanguard-db,
// Model Provider Health, Audit Pipeline, Governance.
// Extracted verbatim from src/core/maintenance-watchtower.ts — no logic changes.

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';
import type Database from 'better-sqlite3';
import { runSync } from '../run-command';
import { getEffectiveProcessTimeout } from '../timeout-config';
import { addResult, quiet, ROOT, RUNTIME_DIR, SESSION_DIR, CheckResult } from './context';
import { fileExists, getFileAgeHours } from './helpers';
const logger = log('CORE-WATCHTOWER-CHECKS-DATA');
const _require = createRequire(import.meta.url);
import { log } from '../../utils/logger.js';

// ─── Component: Tracing ──────────────────────────────────────────────────────

export async function checkTracing() {
  if (!quiet) logger.info('  [Tracing] Checking...');

  const telemetryDir = join(ROOT, '.telemetry');
  const tracesDir = join(telemetryDir, 'traces');
  const metricsDir = join(telemetryDir, 'metrics');

  if (fileExists(tracesDir)) {
    const traceFiles = readdirSync(tracesDir).filter((f) => f.endsWith('.jsonl')).length;
    addResult('tracing', 'trace files', 'PASS', `${traceFiles} trace file(s)`, 'ok');
  } else {
    addResult('tracing', 'trace files', 'WARN', 'No traces directory', 'ok');
  }

  if (fileExists(metricsDir)) {
    const promFile = join(metricsDir, 'prometheus-metrics.prom');
    if (fileExists(promFile)) {
      const age = getFileAgeHours(promFile);
      const status: CheckResult['status'] = age < 24 ? 'PASS' : age < 72 ? 'WARN' : 'FAIL';
      addResult(
        'tracing',
        'prometheus metrics',
        status,
        `last export ${age.toFixed(1)} hrs ago`,
        'ok',
      );
    } else {
      addResult('tracing', 'prometheus metrics', 'WARN', 'No prometheus export', 'ok');
    }
  } else {
    addResult('tracing', 'metrics directory', 'WARN', 'Not initialized', 'ok');
  }

  addResult(
    'tracing',
    'instrumentation script',
    fileExists(join(ROOT, 'src/monitor/tracing-instrument.ts')) ? 'PASS' : 'FAIL',
    '',
    'verify',
  );
}

// ─── Component: State Persistence ────────────────────────────────────────────

export async function checkStatePersistence() {
  if (!quiet) logger.info('  [State Persistence] Checking...');

  const checkpointDir = join(SESSION_DIR, 'checkpoints');
  const manifestDir = join(SESSION_DIR, 'manifests');
  const snapshotDir = join(SESSION_DIR, 'snapshots');

  if (fileExists(checkpointDir)) {
    const ckpts = readdirSync(checkpointDir).filter((f) =>
      statSync(join(checkpointDir, f)).isDirectory(),
    ).length;
    addResult('state-persistence', 'checkpoints', 'PASS', `${ckpts} checkpoint(s)`, 'ok');
    const dirs = readdirSync(checkpointDir)
      .filter((f) => statSync(join(checkpointDir, f)).isDirectory())
      .map((f) => ({ name: f, mtime: statSync(join(checkpointDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (dirs.length > 0) {
      const latestAge = (Date.now() - dirs[0].mtime) / (1000 * 60 * 60);
      if (latestAge > 72) {
        addResult(
          'state-persistence',
          'latest checkpoint',
          'WARN',
          `${latestAge.toFixed(1)}hrs old`,
          'verify',
        );
      }
    }
  } else {
    addResult('state-persistence', 'checkpoints', 'WARN', 'No checkpoints directory', 'ok');
  }

  if (fileExists(manifestDir)) {
    const manifests = readdirSync(manifestDir).filter((f) => f.endsWith('.json')).length;
    addResult('state-persistence', 'manifests', 'PASS', `${manifests} manifest(s)`, 'ok');
  } else {
    addResult('state-persistence', 'manifests', 'WARN', 'No manifests', 'ok');
  }

  if (fileExists(snapshotDir)) {
    const snaps = readdirSync(snapshotDir).filter((f) => f.endsWith('.json')).length;
    addResult('state-persistence', 'snapshots', 'PASS', `${snaps} snapshot(s)`, 'ok');
  } else {
    addResult('state-persistence', 'snapshots', 'WARN', 'No snapshots', 'ok');
  }

  const ckptMgr = join(ROOT, 'src/ops/checkpoint-manager.ts');
  const rollbackOrch = join(ROOT, 'src/ops/rollback-orchestrator.ts');
  const snapMgr = join(ROOT, 'src/ops/snapshot-manager.ts');
  const allScripts = fileExists(ckptMgr) && fileExists(rollbackOrch) && fileExists(snapMgr);
  addResult(
    'state-persistence',
    'scripts',
    allScripts ? 'PASS' : 'FAIL',
    allScripts ? 'All 3 scripts present' : 'Missing scripts',
    'verify',
  );
}

// ─── Component: gentle-vanguard-db ───────────────────────────────────────────

export async function checkGentleVanguardDb() {
  if (!quiet) logger.info('  [gentle-vanguard-db] Checking...');

  const dbPath = join(RUNTIME_DIR, 'gentle-vanguard.db');
  const dbExists = fileExists(dbPath);
  addResult(
    'gentle-vanguard-db',
    'database file',
    dbExists ? 'PASS' : 'FAIL',
    dbExists ? `${(statSync(dbPath).size / 1024 / 1024).toFixed(2)} MB` : 'Not found',
    'init',
  );

  if (dbExists) {
    // Check WAL size — auto-checkpoint if WAL > DB size or > 5MB
    const walPath = dbPath + '-wal';
    if (fileExists(walPath)) {
      const walBytes = statSync(walPath).size;
      const walMB = walBytes / 1024 / 1024;
      const dbBytes = statSync(dbPath).size;
      const walRatio = dbBytes > 0 ? walBytes / dbBytes : 0;
      const needsCheckpoint = walMB > 5 || walRatio > 1.5;
      if (needsCheckpoint) {
        try {
          const cmd = process.platform === 'win32' ? 'sqlite3.exe' : 'sqlite3';
          runSync(cmd, [dbPath, 'PRAGMA wal_checkpoint(TRUNCATE);'], { timeout: 30000 });
          const newWalBytes = existsSync(walPath) ? statSync(walPath).size : 0;
          addResult(
            'gentle-vanguard-db',
            'WAL auto-checkpoint',
            'PASS',
            `${walMB.toFixed(2)} MB → ${(newWalBytes / 1024 / 1024).toFixed(2)} MB (ratio ${walRatio.toFixed(1)}x)`,
            'auto-healed',
          );
        } catch {
          addResult(
            'gentle-vanguard-db',
            'WAL file',
            'WARN',
            `${walMB.toFixed(2)} MB (checkpoint failed)`,
            'manual',
          );
        }
      } else {
        addResult('gentle-vanguard-db', 'WAL file', 'PASS', `${walMB.toFixed(2)} MB`, 'ok');
      }
    } else {
      addResult('gentle-vanguard-db', 'WAL file', 'PASS', 'No WAL (journal mode)');
    }

    // Try integrity check via sqlite3 CLI
    try {
      const cmd = process.platform === 'win32' ? 'sqlite3.exe' : 'sqlite3';
      const r = runSync(cmd, [dbPath, 'PRAGMA integrity_check;'], {
        timeout: getEffectiveProcessTimeout('default'),
      });
      const output = (r.stdout ?? '').trim();
      const stderr = (r.stderr ?? '').trim();
      const processFailed = r.error || (r.status !== null && r.status !== 0);
      const isTransient =
        processFailed || output === '' || /locked|busy|no such|Error/i.test(stderr);
      const integrityOk = output === 'ok';

      let status: 'PASS' | 'WARN' | 'FAIL';
      let action: string;
      if (integrityOk) {
        status = 'PASS';
        action = 'ok';
      } else if (isTransient) {
        // Transient: DB locked by another process or CLI unavailable — not corruption
        status = 'WARN';
        action = 'retry';
      } else {
        status = 'FAIL';
        action = 'restore';
      }

      const detail = integrityOk
        ? 'ok'
        : isTransient
          ? `Transient (${output.substring(0, 40) || stderr.substring(0, 40) || 'process error'})`
          : output.substring(0, 80);
      addResult('gentle-vanguard-db', 'integrity check', status, detail, action);

      // Get table and row counts (only on PASS)
      if (integrityOk) {
        try {
          const tablesOut = runSync(cmd, [dbPath, '.tables'], { timeout: 5000 }).stdout.trim();
          const tables = tablesOut.split(/\s+/).filter((t) => t.length > 0 && !t.startsWith('_'));
          let totalRows = 0;
          for (const t of tables) {
            try {
              const row = runSync(cmd, [dbPath, `SELECT COUNT(*) FROM [${t}];`], {
                timeout: 3000,
              }).stdout.trim();
              totalRows += parseInt(row, 10) || 0;
            } catch {
              /* skip */
            }
          }
          addResult(
            'gentle-vanguard-db',
            'size',
            'PASS',
            `${tables.length} tables, ${totalRows} rows`,
            'ok',
          );
        } catch {
          addResult('gentle-vanguard-db', 'size', 'WARN', 'Could not enumerate tables');
        }
      }
    } catch {
      addResult(
        'gentle-vanguard-db',
        'integrity check',
        'WARN',
        'sqlite3 CLI not available',
        'manual',
      );
    }
  }
}

// ─── Component: Model Provider Health ────────────────────────────────────────

export function evaluateProviderAlertStatus(
  modelName: string,
  activeModel: string,
): CheckResult['status'] {
  return modelName === activeModel ? 'WARN' : 'PASS';
}

export function getWatchtowerComponentStatus(counts: { fails: number; warns: number }): 'ISSUES' | 'WARN' | 'OK' {
  return counts.fails > 0 ? 'ISSUES' : counts.warns > 0 ? 'WARN' : 'OK';
}

export function evaluateProviderEvidenceStatus(
  modelName: string,
  activeModel: string,
  evidence: { status?: string; lastSuccessAt?: string; lastDetectedAt?: string; cooldownUntil?: string },
  now = Date.now(),
): CheckResult['status'] {
  const lastSuccessAt = evidence.lastSuccessAt ? Date.parse(evidence.lastSuccessAt) : NaN;
  const lastDetectedAt = evidence.lastDetectedAt ? Date.parse(evidence.lastDetectedAt) : NaN;
  const ageMs = now - lastSuccessAt;
  if (
    Number.isFinite(lastSuccessAt) &&
    ageMs >= 0 &&
    ageMs <= 5 * 60_000 &&
    (!Number.isFinite(lastDetectedAt) || lastSuccessAt >= lastDetectedAt)
  ) return 'PASS';

  if (evidence.status === 'unhealthy') {
    const cooldownUntil = evidence.cooldownUntil ? Date.parse(evidence.cooldownUntil) : NaN;
    if (Number.isFinite(cooldownUntil) && cooldownUntil > now && modelName !== activeModel) return 'PASS';
    return 'WARN';
  }

  return 'WARN';
}

export function readLatestSuccessfulProviderUsage(
  db: Database.Database,
  modelName: string,
): string | undefined {
  const model = modelName.split('/').at(-1)?.trim().toLowerCase();
  if (!model) return undefined;
  const row = db.prepare(
    `SELECT MAX(timestamp) AS timestamp FROM token_usage
     WHERE completion_tokens > 0 AND (lower(model) = ? OR lower(model) LIKE ?)`,
  ).get(model, `%/${model}`) as { timestamp?: string } | undefined;
  return row?.timestamp || undefined;
}

function readModelSuccessEvidence(modelNames: string[]): Record<string, string> {
  const dbPath = join(RUNTIME_DIR, 'gentle-vanguard.db');
  if (!fileExists(dbPath)) return {};
  let db: Database.Database | undefined;
  try {
    const DatabaseConstructor = _require('better-sqlite3') as typeof Database;
    db = new DatabaseConstructor(dbPath, { readonly: true });
    return Object.fromEntries(
      modelNames.flatMap((name) => {
        const timestamp = readLatestSuccessfulProviderUsage(db!, name);
        return timestamp ? [[name, timestamp]] : [];
      }),
    );
  } catch {
    return {};
  } finally {
    db?.close();
  }
}

// ─── Active routing scope for model-provider-health ──────────────────────────
// The healer keeps every model that ever produced a provider error in
// .runtime/model-health.json, and an entry can only reach PASS through a
// successful completion recorded in the last 5 minutes. Models that were used
// in the past but are not part of the current routing config can therefore
// never self-heal and would keep the watchtower in WARN forever. Scope the
// signal to the models the stack actually routes today.

type JsonObject = Record<string, unknown>;

export interface TrackedModelEvidence {
  status?: string;
  reason?: string;
  lastSuccessAt?: string;
  lastDetectedAt?: string;
  cooldownUntil?: string;
}

function asJsonObject(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function collectModelIds(value: unknown, target: Set<string>): void {
  if (typeof value === 'string' && value.trim()) target.add(value.trim());
  if (Array.isArray(value)) value.forEach((item) => collectModelIds(item, target));
}

/** Flat list of every model id referenced by the active router/fallback configs. */
export function extractManagedModelIds(router: unknown, fallback: unknown): string[] {
  const ids = new Set<string>();
  const routerObject = asJsonObject(router);
  if (routerObject) {
    collectModelIds(asJsonObject(routerObject.defaults)?.model, ids);
    collectModelIds(asJsonObject(routerObject.fallback)?.model, ids);
    collectModelIds(asJsonObject(routerObject.failover)?.fallbackModel, ids);
    for (const binding of Object.values(asJsonObject(routerObject.agentBindings) ?? {})) {
      collectModelIds(asJsonObject(binding)?.model, ids);
    }
  }
  const fallbackObject = asJsonObject(fallback);
  if (fallbackObject) {
    for (const agent of Object.values(asJsonObject(fallbackObject.agentFallbacks) ?? {})) {
      const entry = asJsonObject(agent);
      collectModelIds(entry?.primary, ids);
      collectModelIds(entry?.chain, ids);
    }
    collectModelIds(fallbackObject.universalFallbacks, ids);
  }
  return [...ids];
}

export function readManagedModelIds(): string[] {
  const readConfig = (fileName: string): unknown => {
    try {
      return JSON.parse(readFileSync(join(ROOT, 'config', fileName), 'utf-8'));
    } catch {
      return null;
    }
  };
  return extractManagedModelIds(readConfig('model-router.json'), readConfig('model-fallback.json'));
}

/**
 * Match rule: full id (`provider/model`), exact state key, or last segment
 * (`/model`) against the managed set. The last-segment rule keeps a routed
 * model detectable when the state still records a stale provider alias
 * (e.g. `opencode` for the `opencode-zen-C` catalog).
 */
export function isRoutedModel(
  modelName: string,
  provider: string | undefined,
  managedModelIds: readonly string[],
): boolean {
  const bareName = (modelName.split('/').at(-1) ?? modelName).trim().toLowerCase();
  return managedModelIds.some((id) => {
    if (id === modelName) return true;
    if (provider && id === `${provider}/${modelName}`) return true;
    return (id.split('/').at(-1) ?? id).trim().toLowerCase() === bareName;
  });
}

/**
 * Final status/detail for a tracked model. Entries outside the active routing
 * scope (and not the active model) are reported as untracked PASS; routed
 * entries keep the verified-recovery contract of evaluateProviderEvidenceStatus.
 */
export function evaluateTrackedModelHealth(
  modelName: string,
  provider: string | undefined,
  activeModel: string,
  evidence: TrackedModelEvidence,
  managedModelIds: readonly string[],
  now = Date.now(),
): { status: CheckResult['status']; detail: string } {
  const bareActive = (activeModel.split('/').at(-1) ?? activeModel).trim().toLowerCase();
  const isActive =
    modelName === activeModel || modelName.trim().toLowerCase() === bareActive;
  // An empty managed set means the router configs are unreadable: fail open
  // (keep the legacy WARN) instead of silently suppressing provider signal.
  if (managedModelIds.length > 0 && !isActive && !isRoutedModel(modelName, provider, managedModelIds)) {
    return { status: 'PASS', detail: 'untracked (not in active routing)' };
  }

  const status = evaluateProviderEvidenceStatus(modelName, activeModel, evidence, now);
  const hasFreshSuccess = status === 'PASS' && evidence.status === 'healthy';
  const isQuarantined = status === 'PASS' && evidence.status === 'unhealthy';
  const detail = hasFreshSuccess
    ? `verified success at ${evidence.lastSuccessAt}`
    : isQuarantined
      ? `inactive quarantined (${evidence.reason?.slice(0, 60) ?? 'unknown reason'})`
      : evidence.status === 'unhealthy' &&
          evidence.cooldownUntil &&
          Date.parse(evidence.cooldownUntil) <= now
        ? `cooldown expired without a successful probe (${evidence.reason?.slice(0, 60) ?? 'provider error'})`
        : `no fresh successful probe (${evidence.reason?.slice(0, 60) ?? 'health unknown'})`;
  return { status, detail };
}

export async function checkModelHealth() {
  if (!quiet) logger.info('  [model-provider-health] Checking...');

  const statePath = join(RUNTIME_DIR, 'model-health.json');
  const configPath = join(ROOT, 'config', 'model-health.json');
  const activePath = join(RUNTIME_DIR, 'model-active.json');

  if (!fileExists(configPath)) {
    addResult(
      'model-provider-health',
      'config',
      'FAIL',
      'config/model-health.json not found',
      'verify',
    );
    return;
  }
  addResult('model-provider-health', 'config', 'PASS', 'model-health.json present', 'ok');

  let activeModel = 'unknown';
  if (fileExists(activePath)) {
    try {
      const active = JSON.parse(readFileSync(activePath, 'utf-8'));
      activeModel = active.model || active.activeModel || 'unknown';
    } catch {
      /* ignore */
    }
  }

  if (!fileExists(statePath)) {
    addResult('model-provider-health', 'state', 'PASS', `No unhealthy models tracked`, 'ok');
    addResult(
      'model-provider-health',
      'active model',
      'WARN',
      `${activeModel} has no tracked provider health or fresh successful probe`,
      'verify-active-model',
    );
    return;
  }

  try {
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    const models = (state.models ?? {}) as Record<
      string,
      {
        status?: string;
        reason?: string;
        provider?: string;
        cooldownUntil?: string;
        lastSuccessAt?: string;
      }
    >;
    const successes = readModelSuccessEvidence([...Object.keys(models), activeModel]);
    const managedModelIds = readManagedModelIds();
    const latestSuccess = (name: string, recorded?: string): string | undefined => {
      const candidates = [recorded, successes[name]].filter((value): value is string => Boolean(value));
      return candidates.sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1);
    };

    if (Object.keys(models).length === 0) {
      addResult('model-provider-health', 'state', 'WARN', 'No provider health records', 'verify');
    } else {
      for (const [name, model] of Object.entries(models)) {
        const evidence = { ...model, lastSuccessAt: latestSuccess(name, model.lastSuccessAt) };
        const health = evaluateTrackedModelHealth(
          name,
          model.provider,
          activeModel,
          evidence,
          managedModelIds,
        );
        addResult(
          'model-provider-health',
          `model ${name}`,
          health.status,
          health.detail,
          health.status === 'PASS' ? 'ok' : name === activeModel ? 'verify-active-model' : 'verify-provider',
        );
      }
    }
    const activeEvidence = models[activeModel];
    const activeStatus = activeEvidence
      ? evaluateProviderEvidenceStatus(activeModel, activeModel, {
          ...activeEvidence,
          lastSuccessAt: latestSuccess(activeModel, activeEvidence.lastSuccessAt),
        })
      : evaluateProviderEvidenceStatus(activeModel, activeModel, {
          lastSuccessAt: latestSuccess(activeModel),
        });
    addResult(
      'model-provider-health',
      'active model',
      activeStatus,
      activeModel === 'unknown' ? 'unknown' : activeStatus === 'PASS'
        ? `${activeModel} has a fresh successful probe`
        : `${activeModel} has no fresh successful probe`,
      activeStatus === 'PASS' ? 'ok' : 'verify-active-model',
    );
  } catch {
    addResult(
      'model-provider-health',
      'state',
      'WARN',
      'Could not parse model-health.json',
      'verify',
    );
  }
}

// ─── Component: Audit Pipeline ───────────────────────────────────────────────

export async function checkAuditPipeline() {
  if (!quiet) logger.info('  [Audit Pipeline] Checking...');

  const auditDir = join(SESSION_DIR, 'audit');
  const logDir = join(auditDir, 'logs');
  const indexFile = join(auditDir, 'index.json');

  if (fileExists(logDir)) {
    const logFiles = readdirSync(logDir).filter((f) => f.endsWith('.jsonl'));
    let totalEvents = 0;
    for (const f of logFiles) {
      const content = readFileSync(join(logDir, f), 'utf-8').trim();
      if (content) totalEvents += content.split('\n').length;
    }
    addResult(
      'audit',
      'log files',
      'PASS',
      `${logFiles.length} file(s), ${totalEvents} events`,
      'ok',
    );
  } else {
    addResult('audit', 'log files', 'WARN', 'No audit logs yet', 'ok');
  }

  if (fileExists(indexFile)) {
    addResult('audit', 'index', 'PASS', 'Available', 'ok');
  } else if (fileExists(logDir) && readdirSync(logDir).some((f) => f.endsWith('.jsonl'))) {
    // Events exist but the index is missing — real inconsistency worth flagging.
    addResult('audit', 'index', 'WARN', 'No index (events present)', 'ok');
  } else {
    // No audit events yet — index is legitimately absent until the first event
    // is recorded (saveAuditEvent creates it). Initial state is not a warning.
    addResult('audit', 'index', 'PASS', 'No events yet (index pending)', 'ok');
  }

  addResult(
    'audit',
    'pipeline script',
    fileExists(join(ROOT, 'src/infrastructure/audit-pipeline.ts')) ? 'PASS' : 'FAIL',
    '',
    'verify',
  );

  const rbacPath = join(ROOT, 'config/rbac-policy.json');
  const cspPath = join(ROOT, 'config/security-csp.json');
  const secConfigs = fileExists(rbacPath) && fileExists(cspPath);
  addResult(
    'audit',
    'security configs',
    secConfigs ? 'PASS' : 'FAIL',
    secConfigs ? 'RBAC + CSP present' : 'Missing configs',
    'verify',
  );
}

// ─── Component: Governance ──────────────────────────────────────────────────

export async function checkGovernance() {
  if (!quiet) logger.info('  [Governance] Checking...');

  const govFiles = [
    'rules/NORMATIVAS-PERFORMANCE.md',
    'rules/SDD-STRICT-TDD.md',
    'rules/PER-PHASE-MODEL-ROUTING.md',
    'openspec/config.yaml',
    'rules/NORMATIVA-PNPM-SECURITY.md',
  ];
  for (const f of govFiles) {
    addResult('governance', f, fileExists(join(ROOT, f)) ? 'PASS' : 'WARN', '', 'manual');
  }

  // Pester check removed — all checks migrated to TypeScript, no PowerShell tests remain
}
