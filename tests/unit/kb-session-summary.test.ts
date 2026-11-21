import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildSessionSummaryParts,
  renderLatestCloseReport,
  renderStateData,
  resolveSession,
} from '../../src/knowledge/kb-session-summary.js';

let root: string;

function writeState(sessionId: string, state: Record<string, unknown>): string {
  const dir = join(root, '.session', 'context-log', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.state.json'), JSON.stringify(state), 'utf-8');
  return dir;
}

function writeCloseReport(id: string, report: Record<string, unknown>): void {
  mkdirSync(join(root, '.session'), { recursive: true });
  writeFileSync(join(root, '.session', `close-report-${id}.json`), JSON.stringify(report), 'utf-8');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kb-session-summary-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveSession', () => {
  it('honors an explicit id and finds its directory', () => {
    writeState('session-20260101T0101', { sessionId: 'session-20260101T0101' });
    const resolved = resolveSession(root, 'session-20260101T0101', {});
    expect(resolved.sessionId).toBe('session-20260101T0101');
    expect(resolved.dir).toBe(join(root, '.session', 'context-log', 'session-20260101T0101'));
  });

  it('prefers env GV_SESSION_ID when no explicit id is given', () => {
    const resolved = resolveSession(root, undefined, { GV_SESSION_ID: 'session-env' });
    expect(resolved.sessionId).toBe('session-env');
    expect(resolved.dir).toBeNull();
  });

  it('falls back to the dated id when no session directories exist', () => {
    const resolved = resolveSession(root, undefined, {});
    expect(resolved.sessionId).toMatch(/^session-\d{8}$/);
    expect(resolved.dir).toBeNull();
  });
});

describe('renderStateData', () => {
  it('returns null for an empty state (no activity)', () => {
    const dir = writeState('session-empty', {
      sessionId: 'session-empty',
      totalTokens: 0,
      messageCount: 0,
      turns: [],
    });
    expect(renderStateData(dir)).toBeNull();
  });

  it('renders real counters when the state has activity', () => {
    const dir = writeState('session-busy', {
      sessionId: 'session-busy',
      agent: 'orchestrator',
      status: 'completed',
      totalTokens: 1234,
      totalCost: 0.5,
      messageCount: 4,
      turns: [{ inputTokens: 1, outputTokens: 2 }],
      metadata: { toolCalls: 7, filesEdited: 2, skillsUsed: ['a', 'b'] },
    });
    const block = renderStateData(dir);
    expect(block).toContain('orchestrator');
    expect(block).toContain('Tokens**: 1234');
    expect(block).toContain('toolCalls: 7');
    expect(block).toContain('skillsUsed: 2');
  });
});

describe('renderLatestCloseReport', () => {
  it('files the note under the session the report describes', () => {
    writeCloseReport('20260101T0900', {
      timestamp: '2026-01-01T09:00:00.000Z',
      reason: 'session-end',
      overall: 'PASS',
      validationScore: 100,
      totalPhases: 10,
      passed: 10,
      failed: 0,
      skipped: 0,
      phases: {
        persist: [{ phase: 'token-metrics', status: 'PASS', detail: 'in=10 out=20 total=30' }],
      },
    });
    const rendered = renderLatestCloseReport(root);
    expect(rendered?.sessionId).toBe('session-20260101T0900');
    expect(rendered?.block).toContain('PASS');
    expect(rendered?.block).toContain('total=30');
  });
});

describe('buildSessionSummaryParts', () => {
  it('produces no parts when nothing real exists (caller must skip writing)', () => {
    const { parts } = buildSessionSummaryParts(root, undefined, {});
    expect(parts).toHaveLength(0);
  });

  it('prefers session state over the close report', () => {
    writeState('session-live', {
      sessionId: 'session-live',
      totalTokens: 99,
      messageCount: 1,
      turns: [{ inputTokens: 9, outputTokens: 9 }],
    });
    writeCloseReport('20260101T0900', { overall: 'PASS', passed: 1, totalPhases: 1 });
    const result = buildSessionSummaryParts(root, 'session-live', {});
    expect(result.parts.join('\n')).toContain('Tokens**: 99');
    expect(result.parts.join('\n')).not.toContain('Last close report');
  });
});
