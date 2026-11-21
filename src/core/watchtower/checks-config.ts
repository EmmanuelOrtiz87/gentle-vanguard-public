// Config checks (F2.5 split): Session Pipeline, Git Hooks, Configs, Tool Configs.
// Extracted verbatim from src/core/maintenance-watchtower.ts — no logic changes.

import { readdirSync, existsSync, statSync } from 'fs';
import { join, basename } from 'path';
import { runSync } from '../run-command.js';
import { getEffectiveProcessTimeout } from '../timeout-config.js';
import { addResult, quiet, ROOT, RUNTIME_DIR } from './context.js';
import { fileExists, payloadFileOk, readJson } from './helpers.js';
const logger = log('CORE-WATCHTOWER-CHECKS-CONFIG');
import { log } from '../../utils/logger.js';

// ─── Component: Session Pipeline ────────────────────────────────────────────

export async function checkSessionPipeline() {
  if (!quiet) logger.info('  [Session] Checking...');

  const scripts = [
    'src/session/session-start-optimized.ts',
    'src/session/session-manager.ts',
    'src/tools/pre-process-input.ts',
    'src/session/session-start-optimized.ts',
    'src/session/session-cleanup-start.ts',
  ];
  for (const s of scripts) {
    const name = basename(s);
    // Presencia ≠ operación (meta-auditoría 2026-11-20): "el archivo existe"
    // no certifica "el pipeline es sano". Lo que este check SÍ puede afirmar
    // es presencia; la ejecución la prueba el autostart que corre por sesión.
    addResult(
      'session',
      name,
      fileExists(join(ROOT, s)) ? 'UNVERIFIED' : 'FAIL',
      fileExists(join(ROOT, s))
        ? 'presencia verificada; ejecución no verificada por este check'
        : 'pipeline script missing',
      'manual',
    );
  }

  const autostartConfig = 'config/session-autostart.config.json';
  addResult(
    'session',
    'autostart config',
    fileExists(join(ROOT, autostartConfig)) ? 'UNVERIFIED' : 'FAIL',
    fileExists(join(ROOT, autostartConfig))
      ? 'presencia verificada; ejecución no verificada por este check'
      : 'config missing',
    'manual',
  );
}

// ─── Component: Git Hooks ───────────────────────────────────────────────────

export async function checkHooks() {
  if (!quiet) logger.info('  [Hooks] Checking...');

  addResult(
    'hooks',
    '.lefthook.yml',
    fileExists(join(ROOT, '.lefthook.yml')) ? 'PASS' : 'FAIL',
    '',
    'manual',
  );

  try {
    const r = runSync('lefthook', ['validate'], {
      cwd: ROOT,
      timeout: getEffectiveProcessTimeout('default'),
    });
    addResult(
      'hooks',
      'lefthook validate',
      r.status === 0 ? 'PASS' : 'FAIL',
      r.stderr ?? '',
      'manual',
    );
  } catch {
    addResult('hooks', 'lefthook validate', 'FAIL', 'Not installed or invalid', 'manual');
  }
}

// ─── Component: Configs ─────────────────────────────────────────────────────

export async function checkConfigs() {
  if (!quiet) logger.info('  [Configs] Checking...');

  // NORM-OPENCODE-001 (canon, 2026-11-21): el working-tree de opencode.json
  // debe ser IGUAL al canon de HEAD. Detect-only: a mitad de sesión el
  // watchtower REPORTA (FAIL + snapshot forense + acción de restore); el
  // overwrite ocurre en las fronteras (autostart phase 1 / pre-push) — mismo
  // criterio pasivo que uncommitted-actor-inventory (informa, NUNCA borra).
  try {
    const { detectOpencodeCanonDrift } = await import('../../tools/opencode-canon-restore.js');
    const report = detectOpencodeCanonDrift(ROOT);
    if (report.action === 'drift') {
      addResult(
        'configs',
        'opencode.json (canon vs HEAD)',
        'FAIL',
        `${report.detail}${report.snapshotPath ? ` [snapshot: ${report.snapshotPath}]` : ''}`,
        'node --import tsx src/tools/opencode-canon-restore.ts',
      );
    } else if (report.action === 'failed') {
      addResult('configs', 'opencode.json (canon vs HEAD)', 'FAIL', report.detail, 'manual');
    } else if (!quiet) {
      logger.info('  [Configs] opencode.json canon == HEAD');
    }
  } catch (err) {
    // Reporte ausente ≠ PASS (meta-auditoría 2026-11-20): si el import o el
    // snapshot fallan, el check deja fila UNVERIFIED en vez de desaparecer
    // (juez A, finding LOW).
    addResult(
      'configs',
      'opencode.json (canon vs HEAD)',
      'UNVERIFIED',
      `check de canon no pudo correr: ${err instanceof Error ? err.message : String(err)}`,
      'manual',
    );
  }

  // Compatibilidad agente del repo (backlog absorción cursor/plugins #1):
  // startup/validation/docs-reliability. WARN si el repo deja de ser operativo
  // para un agente frío (score < 80) — el comando con detalle: npm run agent:compat.
  try {
    const { auditAgentCompatibility } = await import('../../ops/agent-compat-audit.js');
    const report = auditAgentCompatibility();
    addResult(
      'configs',
      'agent-compatibility',
      report.score >= 80 ? 'PASS' : 'WARN',
      `score ${report.score}/100 (startup ${report.dimensions.startup.score}, validation ${report.dimensions.validation.score}, docs ${report.dimensions['docs-reliability'].score})`,
      'npm run agent:compat',
    );
  } catch (err) {
    addResult(
      'configs',
      'agent-compatibility',
      'UNVERIFIED',
      `audit no pudo correr: ${err instanceof Error ? err.message : String(err)}`,
      'npm run agent:compat',
    );
  }

  const configs = [
    'config/orchestrator.json',
    'config/auto-delegation.json',
    'config/session-autostart.config.json',
    'config/security-policy.json',
    'config/trusted-users-policy.json',
    'config/security-privacy.json',
    'config/sre-error-budgets.json',
    'config/dashboard-alerts.json',
    'opencode.json',
    'renovate.json',
  ];
  for (const cfg of configs) {
    payloadFileOk('configs', cfg, join(ROOT, cfg), 'fix', true);
  }

  // Schema validation via the unified config-loader (validates every
  // config/*.json that has a sibling .schema.json — currently 8 configs).
  try {
    const { loadConfigFile } = await import('../config-loader.js');
    const schemaDir = join(ROOT, 'config');
    const schemas = existsSync(schemaDir)
      ? readdirSync(schemaDir).filter((f) => f.endsWith('.schema.json'))
      : [];
    let violations = 0;
    for (const schemaFile of schemas) {
      const name = schemaFile.replace(/\.schema\.json$/, '');
      const res = loadConfigFile(name, { noCache: true });
      const errs = res.warnings.filter((w) => w.startsWith('schema violations'));
      if (errs.length > 0) {
        violations++;
        addResult('configs', `${name}.json (schema)`, 'FAIL', errs[0].slice(0, 160), 'manual');
      }
    }
    if (violations === 0) {
      addResult(
        'configs',
        `schema validation (${schemas.length} schemas)`,
        schemas.length > 0 ? 'PASS' : 'WARN',
        schemas.length === 0 ? 'no *.schema.json found in config/' : '',
        'manual',
      );
    }
  } catch (e: unknown) {
    addResult(
      'configs',
      'schema validation',
      'WARN',
      `config-loader unavailable: ${e instanceof Error ? e.message : String(e)}`,
      'manual',
    );
  }
}

// ─── Component: Tool Configs ────────────────────────────────────────────────

export async function checkToolConfigs() {
  if (!quiet) logger.info('  [Tool Configs] Checking...');

  const files = [
    'CLAUDE.md',
    'AGENTS.md',
    '.clinerules',
    '.cursorrules',
    'SECURITY.md',
    '.nvmrc',
    '.node-version',
  ];
  for (const f of files) {
    addResult('tool-configs', f, fileExists(join(ROOT, f)) ? 'PASS' : 'WARN', '', 'manual');
  }

  const windsurfCfg = join(ROOT, '.windsurf/config.json');
  if (fileExists(windsurfCfg)) {
    payloadFileOk('tool-configs', '.windsurf/config.json', windsurfCfg, 'fix');
  } else {
    addResult('tool-configs', '.windsurf/config.json', 'WARN', 'Not found', 'manual');
  }
}

// ─── Component: Autostart Script Integrity (auto-heal report) ───────────────
// The session-autostart self-heals broken script paths and writes any that it
// could NOT resolve to .runtime/autostart-missing-scripts.json. This check
// surfaces that report proactively so unresolved wiring is caught between
// sessions — not only at the moment the autostart runs.

export async function checkMissingScripts() {
  if (!quiet) logger.info('  [Configs] Autostart missing-scripts report...');

  const reportPath = join(RUNTIME_DIR, 'autostart-missing-scripts.json');
  if (!fileExists(reportPath)) {
    // El reporte solo se ESCRIBE cuando hay pendientes (script-path-heal),
    // así que ausente + autostart reciente = "la última corrida no vio
    // pendientes" (evidencia, no ausencia). Sin corrida reciente no se puede
    // afirmar nada: UNVERIFIED, no PASS verde por ausencia de reporte
    // (meta-auditoría 2026-11-20: reporte AUSENTE → PASS era semántica débil).
    const logs = existsSync(RUNTIME_DIR)
      ? readdirSync(RUNTIME_DIR).filter((f) => /^autostart-detached-.*\.log$/.test(f))
      : [];
    let lastRunAgeMs = Infinity;
    for (const f of logs) {
      try {
        lastRunAgeMs = Math.min(lastRunAgeMs, Date.now() - statSync(join(RUNTIME_DIR, f)).mtimeMs);
      } catch {
        /* best-effort: la evidencia no puede romper el check */
      }
    }
    const FRESH_MS = 24 * 60 * 60 * 1000;
    if (lastRunAgeMs <= FRESH_MS) {
      addResult(
        'configs',
        'autostart-missing-scripts (report)',
        'PASS',
        `sin reporte de pendientes y autostart corrió hace ${Math.round(lastRunAgeMs / 60_000)} min`,
        'ok',
      );
    } else {
      addResult(
        'configs',
        'autostart-missing-scripts (report)',
        'UNVERIFIED',
        'sin reporte y sin corrida de autostart en <24h: no verificable',
        'manual',
      );
    }
    return;
  }
  try {
    const report = readJson(reportPath) as { missing?: { id: string; script: string }[] };
    const missing = report?.missing ?? [];
    if (missing.length === 0) {
      addResult(
        'configs',
        'autostart-missing-scripts (report)',
        'PASS',
        'Report empty — all resolved',
        'ok',
      );
    } else {
      addResult(
        'configs',
        'autostart-missing-scripts (report)',
        'WARN',
        `${missing.length} unresolved: ${missing.map((m) => m.id).join(', ')}`,
        'fix',
      );
    }
  } catch {
    addResult(
      'configs',
      'autostart-missing-scripts (report)',
      'WARN',
      'Report unreadable (invalid JSON)',
      'fix',
    );
  }
}
