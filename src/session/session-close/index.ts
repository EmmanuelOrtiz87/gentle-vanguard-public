import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { guardianCheck, learnFromMistake } from '../session-close-guardian.js';
import {
  PhaseResult,
  LOG,
  log,
  ok,
  warn,
  SESSION_DIR,
  runScript,
  getChangedFiles,
} from './helpers.js';
import { isStartupClose } from './process.js';
import { isAuthorizedAutomatedClose } from '../artifact-retention.js';
import {
  stageCloseAck,
  closeAckCommand,
  acknowledgeClose,
  receivePendingCloses,
} from './close-ack.js';
import { listPendingAcks } from '../../core/continuation.js';
import {
  phasePreClose,
  phasePreValidate,
  phasePersist,
  phaseBackup,
  phaseAudit,
  phaseCleanup,
  phaseVerify,
} from './phases.js';

// ─── Orchestrator ───────────────────────────────────────────────────────────────

export interface CloseReport {
  timestamp: string;
  reason: string;
  totalPhases: number;
  passed: number;
  failed: number;
  skipped: number;
  phases: {
    preClose: PhaseResult[];
    preValidate: PhaseResult[];
    persist: PhaseResult[];
    backup: PhaseResult[];
    audit: PhaseResult[];
    cleanup: PhaseResult[];
    verify: PhaseResult[];
  };
  validationScore?: number;
  overall: 'PASS' | 'PASS_WITH_WARNINGS' | 'FAIL';
}

export interface CloseOptions {
  fastClose?: boolean;
  skipBackup?: boolean;
  skipAudit?: boolean;
  skipVerify?: boolean;
}

export async function runCloseOrchestrator(
  reason = 'session-end',
  options: CloseOptions = {},
): Promise<CloseReport> {
  const { fastClose = false, skipBackup = false, skipAudit = false, skipVerify = false } = options;

  log('═══════════════════════════════════════════');
  log('  SESSION CLOSE ORCHESTRATOR v2.0');
  log(`  Reason: ${reason}`);
  if (fastClose) log('  Mode: FAST CLOSE (optimized)');
  log('═══════════════════════════════════════════');

  // Run pre-validation (Capa 1 — always)
  const preValidateResults = phasePreValidate();

  const isStartup = isStartupClose(reason);
  if (isStartup) log('[STARTUP] Skipping daemon-kill phase (autostart-close)');

  // FAST CLOSE: Skip phases that aren't necessary
  const phases = {
    preClose: phasePreClose(reason),
    preValidate: preValidateResults,
    persist: await phasePersist(reason),
    // FAST CLOSE: Skip backup if no significant changes
    backup: fastClose || skipBackup ? [] : phaseBackup(),
    // FAST CLOSE: Skip audit for quick closes
    audit: fastClose || skipAudit ? [] : phaseAudit(),
    cleanup: await phaseCleanup(isStartup, isAuthorizedAutomatedClose(reason)),
    // FAST CLOSE: Skip verify for quick closes
    verify: fastClose || skipVerify ? [] : phaseVerify(),
  };

  const allResults = [
    ...phases.preClose,
    ...phases.preValidate,
    ...phases.persist,
    ...phases.backup,
    ...phases.audit,
    ...phases.cleanup,
    ...phases.verify,
  ];

  const passed = allResults.filter((r) => r.status === 'PASS').length;
  const failed = allResults.filter((r) => r.status === 'FAIL').length;
  const skipped = allResults.filter((r) => r.status === 'SKIP').length;

  let overall: CloseReport['overall'] = 'PASS';
  if (failed > 0) overall = 'FAIL';
  else if (skipped > 0 && passed > 0) overall = 'PASS_WITH_WARNINGS';

  // Calculate validation score (0-100) from pre-validate results
  const validationScore =
    preValidateResults.length > 0
      ? Math.round(
          (preValidateResults.filter((r) => r.status === 'PASS').length /
            preValidateResults.length) *
            100,
        )
      : undefined;

  log('═══════════════════════════════════════════');
  log(`  RESULTS: ${passed} PASS / ${failed} FAIL / ${skipped} SKIP`);
  log(`  VALIDATION: ${validationScore !== undefined ? `${validationScore}/100` : 'N/A'}`);
  log(`  OVERALL: ${overall}`);
  log('═══════════════════════════════════════════');

  for (const r of allResults) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⏭️';
    log(`  ${icon} [${r.phase}] ${r.detail}`);
  }

  if (overall === 'FAIL') {
    warn('Some phases failed. Review the details above.');
  }

  return {
    timestamp: new Date().toISOString(),
    reason,
    totalPhases: allResults.length,
    passed,
    failed,
    skipped,
    phases,
    validationScore,
    overall,
  };
}

// ─── CLI ────────────────────────────────────────────────────────────────────────

// Fast close flag - optimized path for quick session end
let isFastClose = false;

// Detect if we should use fast close (no changes detected)
function shouldUseFastClose(args: string[]): boolean {
  if (args.includes('--fast') || args.includes('-f')) return true;
  // Auto-detect: if session was very short (< 2 min) and no files changed
  const sessionFile = join(SESSION_DIR, 'session-current.json');
  try {
    const data = JSON.parse(readFileSync(sessionFile, 'utf-8'));
    const startTime = new Date(data.startTime || data.sessionStartTime || Date.now()).getTime();
    const sessionDuration = Date.now() - startTime;
    const shortSession = sessionDuration < 2 * 60 * 1000; // < 2 minutes

    if (shortSession && args.includes('--auto-fast')) {
      const changedFiles = getChangedFiles();
      return changedFiles.size === 0;
    }
  } catch {
    // ignore
  }
  return false;
}

export async function main() {
  const args = process.argv.slice(2);

  // Check for fast close mode
  isFastClose = shouldUseFastClose(args);
  if (isFastClose) {
    LOG.info('[FAST-CLOSE] Using optimized close path');
  }

  // ─── Guardian Protection ────────────────────────────────────────────────────
  // Detect previous informal close attempts before proceeding with the official
  // close protocol. If a prior informal attempt is detected, record the learning
  // so the pattern is registered for future sessions.
  const guardian = guardianCheck();
  if (!guardian.passed) {
    learnFromMistake(
      `Orchestrator invoked after informal close attempt: ${guardian.warning || 'unknown reason'}`,
    );
  }

  // ─── Ack-before-burn CLI ───────────────────────────────────────────────────
  if (args.includes('--ack')) {
    const flag = (name: string): string | undefined => {
      const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
      if (i < 0) return undefined;
      const a = args[i];
      return a.includes('=') ? a.split('=').slice(1).join('=') : args[i + 1];
    };
    const resource = flag('resource');
    const token = flag('token');
    if (!resource || !token) {
      LOG.error('--ack requires --resource and --token (both --x=v and --x v forms accepted)');
      process.exit(1);
    }
    const result = acknowledgeClose(resource, token);
    if (result.ok) {
      ok(`Acknowledged — close authority burned (${resource})`);
      process.exit(0);
    }
    warn(`REFUSED [${result.refusal.kind}] ${result.refusal.code}: ${result.refusal.message}`);
    process.exit(1);
  }

  if (args.includes('--receive')) {
    // Host-side receipt: what the next session start does with pending closes.
    const received = receivePendingCloses();
    if (received.length === 0) log('No pending close acknowledgements');
    for (const r of received) {
      const icon = r.action === 'filed' ? '✅' : '⚠️';
      log(`  ${icon} ${r.resource} — ${r.detail}`);
      if (r.action === 'surfaced' && r.reportFile) log(`     report: ${r.reportFile}`);
    }
    process.exit(received.some((r) => r.action === 'surfaced') ? 1 : 0);
  }

  if (args.includes('--pending')) {
    // Operator-side: after reviewing a failed close, get the exact token to
    // burn it. Only session.close.* records are listed.
    const pending = listPendingAcks().filter((p) => p.resource.startsWith('session.close.'));
    if (pending.length === 0) {
      log('No pending close acknowledgements');
      process.exit(0);
    }
    for (const p of pending) {
      log(`${p.resource}  (${p.revision}, staged ${p.createdAt})`);
      log(`  ${closeAckCommand(p.resource)} --token=${p.token}`);
    }
    process.exit(0);
  }

  // Lightweight mode for session-start cleanup (skip pre-validate, backup, audit, verify)
  if (args.includes('--lightweight') || args.includes('-l')) {
    let reason = 'startup-cleanup';
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--reason' && i + 1 < args.length) reason = args[++i];
    }
    // Run only the essential startup-cleanup phases
    phasePreClose(reason);
    await phasePersist(reason);
    const cleanupResults = await phaseCleanup(isStartupClose(reason), false);
    const passed = cleanupResults.filter((r) => r.status === 'PASS').length;
    const failed = cleanupResults.filter((r) => r.status === 'FAIL').length;
    ok(`Lightweight cleanup: ${passed} pass, ${failed} fail`);
    process.exit(failed > 0 ? 1 : 0);
  }

  if (args.includes('--verify') || args.includes('-v')) {
    log('Running verification-only mode...');
    const verifyResults = phaseVerify();
    log('═══════════════════════════════════════════');
    log('  VERIFICATION RESULTS');
    log('═══════════════════════════════════════════');
    for (const r of verifyResults) {
      const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⏭️';
      LOG.info(`  ${icon} [${r.phase}] ${r.detail}`);
    }
    const allPass = verifyResults.every((r) => r.status === 'PASS');
    LOG.info(`\n  Overall: ${allPass ? '✅ ALL PASS' : '❌ SOME FAILURES'}`);
    process.exit(allPass ? 0 : 1);
  }

  let reason = 'session-end';
  const closeOptions: CloseOptions = {};

  // Parse close options
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--reason' && i + 1 < args.length) {
      reason = args[++i];
    } else if (args[i] === '--fast' || args[i] === '-f') {
      closeOptions.fastClose = true;
    } else if (args[i] === '--skip-backup') {
      closeOptions.skipBackup = true;
    } else if (args[i] === '--skip-audit') {
      closeOptions.skipAudit = true;
    } else if (args[i] === '--skip-verify') {
      closeOptions.skipVerify = true;
    }
  }

  // Auto-detect fast close for short sessions with no changes
  if (args.includes('--auto-fast')) {
    const sessionFile = join(SESSION_DIR, 'session-current.json');
    try {
      const data = JSON.parse(readFileSync(sessionFile, 'utf-8'));
      const startTime = new Date(data.startTime || data.sessionStartTime || Date.now()).getTime();
      const sessionDuration = Date.now() - startTime;
      const shortSession = sessionDuration < 2 * 60 * 1000; // < 2 minutes

      if (shortSession) {
        const changedFiles = getChangedFiles();
        if (changedFiles.size === 0) {
          closeOptions.fastClose = true;
          LOG.info('[AUTO-FAST] Short session with no changes detected - using fast close');
        }
      }
    } catch {
      // ignore - use default close
    }
  }

  const report = await runCloseOrchestrator(reason, closeOptions);

  // Write report
  mkdirSync(SESSION_DIR, { recursive: true });
  const reportId = new Date().toISOString().slice(0, 16).replace(/[:-]/g, '');
  const reportFile = join(SESSION_DIR, `close-report-${reportId}.json`);
  writeFileSync(reportFile, JSON.stringify(report, null, 2));
  ok(`Report written to ${reportFile}`);

  // Ack-before-burn (gentle-vanguard.session-close/v1): the terminal close
  // result is staged, not presumed received. The NEXT session start receives
  // it (auto-files PASS, escalates FAIL/WARNINGS); the ack command burns it
  // exactly. A crashed close leaves a discoverable pending trace, not silence.
  const pendingClose = stageCloseAck(reportId, report.overall);
  log(`Close staged (${report.overall}) — ${pendingClose.resource}`);
  if (report.overall !== 'PASS') {
    warn('This close needs review — acknowledge after reviewing the report:');
    warn(`  ${closeAckCommand(pendingClose.resource)} --token=${pendingClose.token}`);
  }

  // If --validate, run deep validator as spawned process (non-blocking if lazy)
  if (args.includes('--validate')) {
    const validateMode = args.includes('--deep')
      ? 'deep'
      : args.includes('--full')
        ? 'full'
        : 'quick';
    const dryRun = args.includes('--dry-run');
    const autoFix = args.includes('--auto-fix');
    log(`Invoking session-close-validator (mode: ${validateMode})...`);
    const vr = runScript(
      'src/session/session-close-validator.ts',
      [
        '--mode',
        validateMode,
        ...(dryRun ? ['--dry-run'] : []),
        ...(autoFix ? ['--auto-fix'] : []),
        '--report',
      ],
      120000,
    );
    if (vr.status === 0) ok('Deep validation passed');
    else warn(`Deep validation finished with exit code ${vr.status}`);
  }

  process.exit(report.overall === 'FAIL' ? 1 : 0);
}
