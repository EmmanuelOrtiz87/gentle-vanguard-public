/**
 * Unit tests for src/telemetry/trace-session-resolver.ts — resolution order:
 * correlation context → payload id (alias-resolved or raw) → session-current
 * marker → null. Plus the bridge write-path used by TraceRepo.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  resolveTraceSessionId,
  readCurrentRepoSessionId,
} from '../../src/telemetry/trace-session-resolver.js';
import { withCorrelation } from '../../src/telemetry/correlation.js';

function makeSessionDir(sessionId?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'gv-tsr-'));
  mkdirSync(join(dir, '.session'), { recursive: true });
  if (sessionId) {
    writeFileSync(join(dir, '.session', 'session-current.json'), JSON.stringify({ sessionId }));
  }
  return dir;
}

test('resolver: correlation context wins when present', () => {
  const dir = makeSessionDir('sess-marker');
  const out = withCorrelation({ sessionId: 'sess-ctx' }, () =>
    resolveTraceSessionId({ repoRoot: dir }),
  );
  assert.equal(out, 'sess-ctx');
  rmSync(dir, { recursive: true, force: true });
});

test('resolver: payload id resolved through alias map', () => {
  const out = resolveTraceSessionId({
    payloadSessionId: 'ses_tool123',
    aliasResolve: (a) => (a === 'ses_tool123' ? 'session-20260831T1321' : null),
  });
  assert.equal(out, 'session-20260831T1321');
});

test('resolver: unmapped payload id is used raw (honest tool-native id)', () => {
  const out = resolveTraceSessionId({ payloadSessionId: 'codex-uuid-xyz' });
  assert.equal(out, 'codex-uuid-xyz');
});

test('resolver: falls back to session-current marker when no context/payload', () => {
  const dir = makeSessionDir('session-20260831T0000');
  const out = resolveTraceSessionId({ repoRoot: dir });
  assert.equal(out, 'session-20260831T0000');
  rmSync(dir, { recursive: true, force: true });
});

test('resolver: null when nothing resolvable (backwards compatible)', () => {
  const dir = makeSessionDir(); // no marker content
  assert.equal(resolveTraceSessionId({ repoRoot: dir }), null);
  assert.equal(resolveTraceSessionId({}), null); // no repoRoot → no marker read
  rmSync(dir, { recursive: true, force: true });
});

test('resolver: malformed session-current.json → null, never throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gv-tsr-'));
  mkdirSync(join(dir, '.session'), { recursive: true });
  writeFileSync(join(dir, '.session', 'session-current.json'), '{not json');
  assert.equal(readCurrentRepoSessionId(dir), null);
  assert.equal(resolveTraceSessionId({ repoRoot: dir }), null);
  rmSync(dir, { recursive: true, force: true });
});

test('resolver: correlation context also wins over payload id', () => {
  const out = withCorrelation({ sessionId: 'sess-ctx' }, () =>
    resolveTraceSessionId({ payloadSessionId: 'ses_other' }),
  );
  assert.equal(out, 'sess-ctx');
});
