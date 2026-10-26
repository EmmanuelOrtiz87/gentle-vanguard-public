#!/usr/bin/env node
/**
 * Engram Policy Enforcement — Session Startup
 * Validates and enforces Engram memory policies during session initialization.
 * TS migration of scripts/gentle-vanguard/engram-policy.ps1
 */

import { runSync } from '../core/run-command.js';
import { pathToFileURL } from 'url';
import { getExternalApiTimeouts } from '../core/timeout-config';

function log(msg: string): void {
  console.log(`[ENGRAM-POLICY] ${msg}`);
}

export function assessEngramDoctor(output: string, status: number | null): 'pass' | 'warn' | 'fail' {
  if (status !== 0) return 'fail';
  try {
    const report = JSON.parse(output.slice(output.indexOf('{')));
    const summary = report?.summary;
    if (!summary || !['warnings', 'blocked', 'errors'].every((key) =>
      Number.isSafeInteger(summary[key]) && summary[key] >= 0)) return 'fail';
    if (summary.blocked > 0 || summary.errors > 0) return 'fail';
    if (report.status === 'ok' && summary.warnings === 0) return 'pass';
    return report.status === 'warning' && summary.warnings > 0 ? 'warn' : 'fail';
  } catch {
    return 'fail';
  }
}

export function getDoctorArgs(fullScan: boolean): string[] {
  const args = ['doctor', '--json', '--project', 'gentle-vanguard'];
  return fullScan ? args : [...args, '--check', 'sqlite_lock_contention'];
}

function main(): number {
  log('Starting Engram policy enforcement');

  // Check if Engram is available
  const engramBin = process.env.ENGRAM_BIN || 'engram';

  try {
    const version = runSync(engramBin, ['--version'], {
      timeout: getExternalApiTimeouts()?.engram_operation_ms ?? 5000,
    });
    if (version.status !== 0 || !version.stdout.trim()) {
      log('[FAIL] Engram executable unavailable; policy not verified');
      return 1;
    }
    log(`Engram available: ${version.stdout.trim()}`);
  } catch {
    log('[FAIL] Engram executable unavailable; policy not verified');
    return 1;
  }

  // Validate Engram project configuration
  const projectName = 'gentle-vanguard';
  log(`Validating project: ${projectName}`);

  const fullScan = process.argv.includes('--full');
  log(fullScan ? 'Checking full memory integrity...' : 'Checking Engram SQLite availability...');
  const doctor = runSync(engramBin, getDoctorArgs(fullScan), {
    timeout: fullScan ? (getExternalApiTimeouts()?.engram_doctor_ms ?? 30000)
      : (getExternalApiTimeouts()?.engram_operation_ms ?? 15000),
  });
  const integrity = assessEngramDoctor(doctor.stdout, doctor.status);
  if (integrity === 'fail') {
    log(`[FAIL] Engram doctor failed, blocked, or returned an invalid report (exit=${doctor.status}, bytes=${doctor.stdout.length}, error=${doctor.error?.message ?? 'none'})`);
    return 1;
  }
  log(integrity === 'pass' ? (fullScan ? 'Memory integrity verified' : 'Engram SQLite availability verified')
    : '[WARN] Engram doctor reports reviewable warnings; integrity is not fully green');

  const hostId = process.env.CODEX_SESSION_ID || process.env.CODEX_THREAD_ID;
  if (hostId) {
    // Resolve only. Registration belongs to the genuine Codex lifecycle hook.
    const resolved = runSync(engramBin, ['hook', 'codex-resolve'], {
      input: JSON.stringify({ session_id: hostId, cwd: process.cwd() }),
      env: { ENGRAM_HOOK_OUTPUT: 'json' }, timeout: 5000,
    });
    let confirmed = false;
    try {
      const identity = JSON.parse(resolved.stdout);
      confirmed = resolved.status === 0 && typeof identity.session_id === 'string' && identity.session_id.length > 0;
    } catch { /* empty or malformed output is never a confirmed binding */ }
    log(confirmed ? 'Codex host binding confirmed by Engram'
      : '[WARN] Codex host binding unconfirmed; a genuine startup/resume hook is required for attributed MCP writes');
  }

  log('Policy checks completed; retention remains owned by session-retention');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
