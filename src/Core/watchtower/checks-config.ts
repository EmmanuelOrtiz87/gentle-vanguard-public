// Config checks (F2.5 split): Session Pipeline, Git Hooks, Configs, Tool Configs.
// Extracted verbatim from src/core/maintenance-watchtower.ts — no logic changes.

import { readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { runSync } from '../run-command';
import { getEffectiveProcessTimeout } from '../timeout-config';
import { addResult, quiet, ROOT, RUNTIME_DIR } from './context';
import { fileExists, payloadFileOk, readJson } from './helpers';
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
    addResult('session', name, fileExists(join(ROOT, s)) ? 'PASS' : 'FAIL', '', 'manual');
  }

  addResult(
    'session',
    'autostart config',
    fileExists(join(ROOT, 'config/session-autostart.config.json')) ? 'PASS' : 'FAIL',
    '',
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
    const { loadConfigFile } = await import('../config-loader');
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
    addResult('configs', 'autostart-missing-scripts (report)', 'PASS', 'No unresolved scripts', 'ok');
    return;
  }
  try {
    const report = readJson(reportPath) as { missing?: { id: string; script: string }[] };
    const missing = report?.missing ?? [];
    if (missing.length === 0) {
      addResult('configs', 'autostart-missing-scripts (report)', 'PASS', 'Report empty — all resolved', 'ok');
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
