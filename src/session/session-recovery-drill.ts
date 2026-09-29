#!/usr/bin/env node
/** Isolated interrupted-session recovery drill. Never mutates the live .session directory. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCheckpoint, restoreCheckpoint } from '../ops/checkpoint-manager.js';

export interface SessionRecoveryDrillReport {
  generatedAt: string;
  checkpointId: string;
  restoredFiles: number;
  measuredRtoMs: number;
  currentSessionRecovered: boolean;
  contextStateRecovered: boolean;
  status: 'PASS' | 'FAIL';
}

export function runSessionRecoveryDrill(root = process.cwd()): SessionRecoveryDrillReport {
  const sandbox = mkdtempSync(join(tmpdir(), 'gv-session-recovery-'));
  try {
    const sessionDir = join(sandbox, '.session');
    const contextDir = join(sessionDir, 'context-log', 'session-drill');
    mkdirSync(contextDir, { recursive: true });
    const current = { sessionId: 'session-drill', status: 'active', marker: 'before-interruption' };
    const state = { sessionId: 'session-drill', status: 'active', messageCount: 4 };
    writeFileSync(join(sessionDir, 'session-current.json'), JSON.stringify(current, null, 2));
    writeFileSync(join(contextDir, '.state.json'), JSON.stringify(state, null, 2));

    const checkpoint = createCheckpoint(sandbox, {
      checkpointId: 'ckpt-interrupted-session-drill',
      label: 'interrupted-session-drill',
    });
    writeFileSync(
      join(sessionDir, 'session-current.json'),
      JSON.stringify({ sessionId: 'corrupted', status: 'unknown' }),
    );
    rmSync(join(contextDir, '.state.json'));

    const restored = restoreCheckpoint(sandbox, checkpoint.checkpointId);
    const restoredCurrent = JSON.parse(
      readFileSync(join(sessionDir, 'session-current.json'), 'utf8'),
    ) as typeof current;
    const restoredState = JSON.parse(
      readFileSync(join(contextDir, '.state.json'), 'utf8'),
    ) as typeof state;
    const currentSessionRecovered = restoredCurrent.marker === current.marker;
    const contextStateRecovered = restoredState.messageCount === state.messageCount;
    const status = currentSessionRecovered && contextStateRecovered ? 'PASS' : 'FAIL';
    const report: SessionRecoveryDrillReport = {
      generatedAt: new Date().toISOString(),
      checkpointId: checkpoint.checkpointId,
      restoredFiles: restored.restored,
      measuredRtoMs: restored.durationMs,
      currentSessionRecovered,
      contextStateRecovered,
      status,
    };
    const reportDir = join(resolve(root), 'reports', 'audits');
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(
      join(reportDir, 'session-recovery-drill-latest.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    return report;
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = runSessionRecoveryDrill();
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'PASS') process.exitCode = 1;
}
