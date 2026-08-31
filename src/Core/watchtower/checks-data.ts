// Data/state checks (F2.5 split): Tracing, State Persistence, gentle-vanguard-db,
// Model Provider Health, Audit Pipeline, Governance.
// Extracted verbatim from src/core/maintenance-watchtower.ts — no logic changes.

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { runSync } from '../run-command';
import { getEffectiveProcessTimeout } from '../timeout-config';
import { addResult, quiet, ROOT, RUNTIME_DIR, SESSION_DIR, CheckResult } from './context';
import { fileExists, getFileAgeHours } from './helpers';
const logger = log('CORE-WATCHTOWER-CHECKS-DATA');
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
    addResult('model-provider-health', 'active model', 'PASS', activeModel, 'ok');
    return;
  }

  try {
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    const models = (state.models ?? {}) as Record<
      string,
      { status?: string; reason?: string; cooldownUntil?: string }
    >;
    const now = Date.now();
    const unhealthy = Object.entries(models).filter(
      ([, m]) =>
        m.status === 'unhealthy' && m.cooldownUntil && new Date(m.cooldownUntil).getTime() > now,
    );
    const healthy = Object.entries(models).filter(([, m]) => m.status === 'healthy');

    if (unhealthy.length > 0) {
      for (const [name, m] of unhealthy) {
        addResult(
          'model-provider-health',
          `model ${name}`,
          'WARN',
          `unhealthy (${m.reason?.slice(0, 60) ?? 'unknown reason'})`,
          'switch-to-fallback',
        );
      }
    }
    if (healthy.length > 0) {
      for (const [name, m] of healthy) {
        addResult('model-provider-health', `model ${name}`, 'PASS', m.reason ?? 'healthy', 'ok');
      }
    }
    if (unhealthy.length === 0 && healthy.length === 0) {
      addResult('model-provider-health', 'state', 'PASS', 'No models tracked', 'ok');
    }
    addResult(
      'model-provider-health',
      'active model',
      activeModel === 'unknown' ? 'WARN' : 'PASS',
      activeModel,
      'ok',
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
