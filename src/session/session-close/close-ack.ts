/**
 * close-ack.ts — Ack-before-burn for the session-close terminal transition
 *
 * Absorbed from gentle-ai v2.5.0-rc.2 ("Approval waits to be acknowledged"):
 * a terminal result that burns its authority on return leaves no trace when
 * the host never received it. Applied to OUR close lifecycle:
 *
 *   1. STAGE: `runCloseOrchestrator`'s report is written AND staged as a
 *      pending acknowledgement (`session.close.<reportId>`). The staged
 *      record is the durable trace that a close happened.
 *   2. RECEIVE: the NEXT session start receives it —
 *        - report overall PASS      → the host runs the acknowledgement
 *          (auto-burn on receipt: the clean close is filed, no noise).
 *        - report FAIL / WARNINGS  → the ack is NOT auto-run. The pending
 *          record IS the escalation: the start surfaces the report path and
 *          the verbatim ack command, and it stays pending until someone who
 *          reviewed the failed close acknowledges it (or the 30d retention
 *          burns it as never-delivered).
 *   3. BURN: only the exact token acknowledges; wrong/replayed acks refuse
 *      and create nothing.
 *
 * Contract: gentle-vanguard.session-close/v1 (ops: ...phases, ack, receive)
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  stageAck,
  getPendingAck,
  acknowledge,
  listPendingAcks,
  type AckPending,
  type AckResult,
} from '../../core/continuation.js';
import { SESSION_DIR } from './helpers.js';

const CLOSE_PREFIX = 'session.close.';

/** Resource id for a close report (reportId = the timestamp slug in its filename). */
export function closeAckResource(reportId: string): string {
  return `${CLOSE_PREFIX}${reportId}`;
}

/** Report file path for a close ack resource (round-trip of closeAckResource). */
export function closeReportFile(resource: string): string {
  return join(SESSION_DIR, `close-report-${resource.slice(CLOSE_PREFIX.length)}.json`);
}

/** Stage the pending acknowledgement for a freshly written close report. */
export function stageCloseAck(reportId: string, overall: string): AckPending {
  return stageAck(closeAckResource(reportId), overall);
}

/** The verbatim command that acknowledges a staged close. */
export function closeAckCommand(resource: string): string {
  return `npx tsx src/session/session-close-orchestrator.ts --ack --resource ${resource}`;
}

/**
 * Acknowledge a staged close with the exact token (the reviewed-it path).
 * Wrong or replayed tokens refuse typed and create nothing.
 */
export function acknowledgeClose(resource: string, token: string): AckResult {
  return acknowledge(resource, token);
}

export interface ReceivedClose {
  resource: string;
  overall: string;
  action: 'filed' | 'surfaced';
  reportFile: string | null;
  detail: string;
}

/**
 * The next-session host receiving the previous closes. Returns what happened
 * per pending record; performs the auto-burn only for PASS reports with an
 * intact report file. Never throws — discovery degrades to 'surfaced'.
 * `reportDir` overrides where close reports are read from (tests/hosts with a
 * relocated session dir; defaults to SESSION_DIR).
 */
export function receivePendingCloses(reportDir: string = SESSION_DIR): ReceivedClose[] {
  const out: ReceivedClose[] = [];
  for (const pending of listPendingAcks()) {
    if (!pending.resource.startsWith(CLOSE_PREFIX)) continue;
    const reportFile = join(
      reportDir,
      `close-report-${pending.resource.slice(CLOSE_PREFIX.length)}.json`,
    );
    let overall = pending.revision; // staged revision carries overall
    let intact = false;
    try {
      if (existsSync(reportFile)) {
        const report = JSON.parse(readFileSync(reportFile, 'utf-8')) as { overall?: string };
        if (report.overall) {
          overall = report.overall;
          intact = true;
        }
      }
    } catch {
      /* unreadable report → not intact */
    }

    if (intact && overall === 'PASS') {
      // The host received a clean close: run the acknowledgement (burn on
      // receipt) — the exact token read from the pending record itself.
      const result = acknowledge(pending.resource, pending.token);
      out.push({
        resource: pending.resource,
        overall,
        action: 'filed',
        reportFile,
        detail: result.ok
          ? 'previous close PASS — acknowledged on receipt'
          : `auto-ack refused (${result.refusal.code}) — left pending`,
      });
      if (!result.ok && getPendingAck(pending.resource)) {
        // refused auto-ack keeps the record pending; surface it
        out[out.length - 1].action = 'surfaced';
      }
    } else {
      // A failed/warned/lost close is an escalation: the pending ack is the
      // trace that survives until a reviewer burns it deliberately.
      out.push({
        resource: pending.resource,
        overall: intact ? overall : 'MISSING-REPORT',
        action: 'surfaced',
        reportFile: intact ? reportFile : null,
        detail: intact
          ? `previous close ${overall} — review the report, then run the ack command`
          : 'close report not found for staged ack — review manually',
      });
    }
  }
  return out;
}
