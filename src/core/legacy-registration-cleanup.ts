#!/usr/bin/env node
/**
 * Legacy Registration Cleanup — ghost console windows, begone
 *
 * Root cause (found 2026-08-27): the PS1→TS migration deleted scripts but
 * left OS-level registrations pointing at them. Every trigger then opened a
 * VISIBLE pwsh/cmd console that flashed and closed:
 *
 *   - HKCU Run key `GentleVanguardDashboardWS` → deleted dashboard-ws-service.ts (logon)
 *   - Scheduled task `GraphifyLabelReset`      → deleted graphify-label-reminder.ps1 (daily 09:00)
 *   - Scheduled task `GentleVanguardGateway`   → deleted gateway-manager.ps1 (boot, needs elevation)
 *
 * This module removes them idempotently and best-effort (access-denied on
 * elevated tasks is tolerated and reported — they're retried each session).
 * Wired as autostart phase-1 step so any machine eventually converges to a
 * clean state. Live check: `node --import tsx src/core/legacy-registration-cleanup.ts`.
 */

import { pathToFileURL } from 'url';
import { runSync } from './run-command.js';

export interface CleanupFinding {
  target: string;
  kind: 'run-key' | 'scheduled-task';
  action: 'removed' | 'not-present' | 'denied' | 'error';
  detail: string;
}

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

/**
 * Stale registrations whose target scripts were deleted in the PS1→TS
 * migration. Format documented inline — append new legacy names here when
 * scripts are removed, never let a registration outlive its script.
 */
const STALE_RUN_KEYS = [
  {
    value: 'GentleVanguardDashboardWS',
    why: 'target src/dashboard-ws-service.ts deleted (0dc274a1); cmd /c + npx flash at logon',
  },
];

const STALE_TASKS = [
  {
    name: 'GraphifyLabelReset',
    why: 'target scripts/graphify-label-reminder.ps1 deleted (603f602b); visible pwsh daily 09:00',
  },
  {
    name: 'GentleVanguardGateway',
    why: 'target scripts/gateway/gateway-manager.ps1 deleted; visible pwsh at boot (may need elevation)',
  },
];

function regDelete(key: string, value: string): CleanupFinding {
  try {
    const r = runSync('reg', ['delete', key, '/v', value, '/f'], { timeout: 5000 });
    if (r.status === 0) {
      return { target: value, kind: 'run-key', action: 'removed', detail: 'stale Run key removed' };
    }
    const errTxt = (r.stderr ?? '').toLowerCase();
    if (errTxt.includes('encontrar') || errTxt.includes('cannot find') || errTxt.includes('unable to find')) {
      return { target: value, kind: 'run-key', action: 'not-present', detail: 'already clean' };
    }
    return { target: value, kind: 'run-key', action: 'error', detail: (r.stderr ?? `exit ${r.status}`).slice(0, 120) };
  } catch (e) {
    return { target: value, kind: 'run-key', action: 'error', detail: e instanceof Error ? e.message : String(e) };
  }
}

function unregisterTask(name: string): CleanupFinding {
  try {
    // schtasks is used instead of the PowerShell cmdlet because it tolerates
    // being called from a non-elevated context uniformly.
    const query = runSync('schtasks', ['/query', '/tn', name], { timeout: 5000, stdio: 'ignore' });
    if (query.status !== 0) {
      return { target: name, kind: 'scheduled-task', action: 'not-present', detail: 'already clean' };
    }
    const del = runSync('schtasks', ['/delete', '/tn', name, '/f'], { timeout: 8000 });
    if (del.status === 0) {
      return { target: name, kind: 'scheduled-task', action: 'removed', detail: 'stale task unregistered' };
    }
    const err = (del.stderr ?? '').toLowerCase();
    if (err.includes('acceso denegado') || err.includes('access denied')) {
      return { target: name, kind: 'scheduled-task', action: 'denied', detail: 'needs elevation — will retry next session' };
    }
    return { target: name, kind: 'scheduled-task', action: 'error', detail: (del.stderr ?? `exit ${del.status}`).slice(0, 120) };
  } catch (e) {
    return { target: name, kind: 'scheduled-task', action: 'error', detail: e instanceof Error ? e.message : String(e) };
  }
}

export function runLegacyCleanup(): CleanupFinding[] {
  const findings: CleanupFinding[] = [];
  for (const k of STALE_RUN_KEYS) findings.push(regDelete(RUN_KEY, k.value));
  for (const t of STALE_TASKS) findings.push(unregisterTask(t.name));
  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = runLegacyCleanup();
  for (const f of findings) {
    const icon = f.action === 'removed' ? '✓' : f.action === 'denied' ? '⚠' : f.action === 'error' ? '✗' : '·';
    console.log(`  ${icon} [${f.kind}] ${f.target}: ${f.action} — ${f.detail}`);
  }
  const removed = findings.filter((f) => f.action === 'removed').length;
  const denied = findings.filter((f) => f.action === 'denied').length;
  console.log(`legacy-cleanup: ${removed} removed, ${denied} denied (elevation), ${findings.length - removed - denied} clean/other`);
  process.exit(0);
}
