#!/usr/bin/env node
/**
 * Unit Tests: session-close ack-before-burn
 *
 * The terminal close report is staged (never presumed received):
 *   - a PASS close with an intact report is acknowledged on next-session
 *     receipt (filed, burned with its own staged token);
 *   - a FAIL/WARNINGS close is SURFACED and stays pending until reviewed —
 *     the staged ack is the escalation trace;
 *   - a staged ack whose report is missing surfaces with MISSING-REPORT;
 *   - the reviewed-it path: only the exact token burns; wrong/replay refuse.
 */

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setContinuationBaseDir, stageAck, getPendingAck } from '../../src/core/continuation.ts';
import {
  stageCloseAck,
  acknowledgeClose,
  receivePendingCloses,
  closeAckResource,
  closeAckCommand,
} from '../../src/session/session-close/close-ack.ts';

let dir: string;
let reportDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gv-closeack-'));
  setContinuationBaseDir(dir);
  reportDir = join(dir, 'reports');
  mkdirSync(reportDir, { recursive: true });
});

after(() => setContinuationBaseDir(null));

function writeReport(reportId: string, overall: string): void {
  writeFileSync(
    join(reportDir, `close-report-${reportId}.json`),
    JSON.stringify({ overall }),
    'utf-8',
  );
}

test('PASS close with intact report is acknowledged on receipt (filed + burned)', () => {
  writeReport('20260831-1200', 'PASS');
  stageCloseAck('20260831-1200', 'PASS');

  const received = receivePendingCloses(reportDir);
  const mine = received.find((r) => r.resource === closeAckResource('20260831-1200'));
  assert.ok(mine, 'received entry exists');
  assert.equal(mine.action, 'filed');
  assert.equal(mine.overall, 'PASS');
  // burned: no pending record remains
  assert.equal(getPendingAck(closeAckResource('20260831-1200')), null);
});

test('FAIL close is surfaced and STAYS pending (the escalation trace)', () => {
  writeReport('20260831-1210', 'FAIL');
  stageCloseAck('20260831-1210', 'FAIL');

  const received = receivePendingCloses(reportDir);
  const mine = received.find((r) => r.resource === closeAckResource('20260831-1210'));
  assert.ok(mine);
  assert.equal(mine.action, 'surfaced');
  assert.match(mine.detail, /review the report/);
  // not burned — pending survives the receive
  assert.ok(getPendingAck(closeAckResource('20260831-1210')));
});

test('missing report surfaces as MISSING-REPORT, never auto-burned', () => {
  stageCloseAck('20260831-1220', 'PASS'); // no report written

  const received = receivePendingCloses(reportDir);
  const mine = received.find((r) => r.resource === closeAckResource('20260831-1220'));
  assert.ok(mine);
  assert.equal(mine.action, 'surfaced');
  assert.equal(mine.overall, 'MISSING-REPORT');
  assert.equal(mine.reportFile, null);
  assert.ok(getPendingAck(closeAckResource('20260831-1220')));
});

test('reviewed-it path: exact token burns, wrong and replayed refuse', () => {
  const pending = stageCloseAck('20260831-1300', 'FAIL');

  const wrong = acknowledgeClose(pending.resource, 'ack-nope');
  assert.equal(wrong.ok, false);

  const okBurn = acknowledgeClose(pending.resource, pending.token);
  assert.equal(okBurn.ok, true);

  const replay = acknowledgeClose(pending.resource, pending.token);
  assert.equal(replay.ok, false);
  if (!replay.ok) assert.equal(replay.refusal.code, 'ack.nothing-pending');
});

test('command surface: closeAckCommand round-trips the orchestrator CLI', () => {
  const resource = closeAckResource('20260831-1400');
  assert.match(
    closeAckCommand(resource),
    /session-close-orchestrator\.ts --ack --resource session\.close\.20260831-1400/,
  );
});

test('receive only considers session.close.* resources (rdd acks ignored)', () => {
  stageCloseAck('20260831-1500', 'PASS');
  stageAck('rdd.some-workflow', 'rev-1'); // different prefix

  const received = receivePendingCloses(reportDir);
  assert.ok(received.every((r) => r.resource.startsWith('session.close.')));
  assert.ok(received.some((r) => r.resource === closeAckResource('20260831-1500')));
});
