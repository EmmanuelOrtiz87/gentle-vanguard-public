#!/usr/bin/env node
/**
 * Unit Tests: Telemetry Correlation (F3.6)
 *
 * Verifies:
 *   - Correlation context propagation via withCorrelation (nested + async safe).
 *   - JSONL enrichment: every event carries ts/sessionId/traceId/agent/spanId.
 *   - Events outside a context are dropped (no chain, no noise).
 *   - Logger bridge enrichment (src/utils/logger.ts) — only when context exists.
 *   - queryCorrelation unified timeline: filtering, token join, ordering.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  withCorrelation,
  getCorrelation,
  traceEvent,
  metricEvent,
  logEvent,
  correlationDir,
} from '../../src/telemetry/correlation.ts';
import { queryCorrelation } from '../../src/telemetry/correlation-query.ts';
import { log } from '../../src/utils/logger.ts';

/** Point the correlation dir at a fresh temp dir via env (isolation per test). */
async function withTempTelemetry(fn: () => void | Promise<void>): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'gv-correlation-'));
  const prev = process.env.GV_TELEMETRY_CORRELATION_DIR;
  const prevCwd = process.cwd();
  process.env.GV_TELEMETRY_CORRELATION_DIR = dir;
  process.chdir(dir);
  try {
    await fn();
  } finally {
    process.chdir(prevCwd);
    if (prev === undefined) delete process.env.GV_TELEMETRY_CORRELATION_DIR;
    else process.env.GV_TELEMETRY_CORRELATION_DIR = prev;
  }
  return dir;
}

function readEvents(dir: string): Array<Record<string, unknown>> {
  const files = existsSync(dir)
    ? join(dir, 'correlation-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.jsonl')
    : null;
  if (!files || !existsSync(files)) return [];
  return readFileSync(files, 'utf-8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

test('withCorrelation propagates context to nested and async code', async () => {
  await withTempTelemetry(async () => {
    await withCorrelation({ sessionId: 'sess-nested', agentName: 'mavis' }, async () => {
      assert.equal(getCorrelation()?.sessionId, 'sess-nested');
      assert.match(getCorrelation()?.traceId ?? '', /^[0-9a-f]{32}$/);

      // Async boundary (timers lose stack — ALS must survive).
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(getCorrelation()?.sessionId, 'sess-nested');

      // Nested context: inherits parent trace unless overridden, can override agent.
      const innerTrace = withCorrelation({ agentName: 'watcher' }, () => getCorrelation());
      assert.equal(innerTrace?.traceId, getCorrelation()?.traceId, 'nested inherits traceId');
      assert.equal(innerTrace?.agentName, 'watcher');

      // Sibling nested context with explicit traceId starts a new chain.
      const newTrace = withCorrelation({ traceId: 'a'.repeat(32) }, () => getCorrelation());
      assert.equal(newTrace?.traceId, 'a'.repeat(32));
      assert.equal(newTrace?.sessionId, 'sess-nested', 'sessionId still inherited');
    });

    // Outside the context: no enrichment.
    assert.equal(getCorrelation(), undefined);
    assert.equal(traceEvent('orphan'), null, 'events outside context are dropped');
  });
});

test('emitted events are enriched and persisted as JSONL', async () => {
  const dir = await withTempTelemetry(async () => {
    withCorrelation(
      { sessionId: 'sess-jsonl', agentName: 'agent-x', traceId: 'b'.repeat(32) },
      () => {
        traceEvent('span.start', { op: 'skill.run' });
        metricEvent('tokens.consumed', 42, { model: 'glm' });
        logEvent('INFO', 'hello', { extra: 1 });
      },
    );
  });
  const events = readEvents(dir);
  assert.equal(events.length, 3);
  for (const ev of events) {
    assert.ok(ev.ts, 'ts present');
    assert.equal(ev.sessionId, 'sess-jsonl');
    assert.equal(ev.traceId, 'b'.repeat(32));
    assert.equal(ev.agent, 'agent-x');
    assert.match(String(ev.spanId), /^[0-9a-f]{16}$/);
  }
  assert.equal(events[0].kind, 'trace');
  assert.equal(events[0].name, 'span.start');
  assert.equal((events[1].payload as Record<string, unknown>).value, 42);
  assert.equal(events[2].kind, 'log');
});

test('logger bridge enriches only inside a correlation context', async () => {
  const dir = await withTempTelemetry(async () => {
    const logger = log('TEST-BRIDGE');
    // Outside context: no crash, no correlation events written.
    logger.info('no-context-line');
    assert.equal(readEvents(correlationDir()).length, 0);

    withCorrelation({ sessionId: 'sess-log', agentName: 'logger-agent' }, () => {
      logger.warn('inside-context-line', { code: 7 });
    });
  });
  const events = readEvents(dir);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'log');
  assert.equal(events[0].name, 'WARN');
  assert.equal(events[0].sessionId, 'sess-log');
  const payload = events[0].payload as Record<string, unknown>;
  assert.equal(payload.message, 'inside-context-line');
  assert.equal(payload.code, 7);
  assert.equal(payload.logger, 'TEST-BRIDGE');
});

test('queryCorrelation returns a unified, ordered timeline with token join', async () => {
  // Build a fake Nexus DB with token_transactions for the session.
  const dbDir = mkdtempSync(join(tmpdir(), 'gv-correlation-db-'));
  const dbPath = join(dbDir, 'test.db');
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE token_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL, session_id TEXT,
    agent TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER,
    reasoning_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER,
    cost REAL, created_at TEXT, tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard')`);
  db.prepare(
    `INSERT INTO token_transactions (message_id, session_id, agent, model, input_tokens, output_tokens, cost, created_at)
     VALUES ('m2', 'sess-q', 'mavis', 'glm-5', 200, 50, 0.01, '2026-08-31T10:00:02.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO token_transactions (message_id, session_id, agent, model, input_tokens, output_tokens, cost, created_at)
     VALUES ('m1', 'sess-q', 'mavis', 'glm-5', 100, 20, 0.005, '2026-08-31T10:00:00.500Z')`,
  ).run();
  db.close();

  const dir = mkdtempSync(join(tmpdir(), 'gv-correlation-run-'));
  const prevEnv = process.env.GV_TELEMETRY_CORRELATION_DIR;
  process.env.GV_TELEMETRY_CORRELATION_DIR = dir;
  try {
    withCorrelation({ sessionId: 'sess-q', agentName: 'mavis', traceId: 'c'.repeat(32) }, () => {
      traceEvent('op.a', { n: 1 }); // ~10:00:00.100
      logEvent('INFO', 'mid');
    });
    withCorrelation({ sessionId: 'other', agentName: 'mavis' }, () => {
      traceEvent('op.other-session');
    });

    // Pin deterministic ordering: rewrite the trace event ts between the two txs.
    const file = join(
      dir,
      'correlation-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.jsonl',
    );
    const lines = readFileSync(file, 'utf-8')
      .split('\n')
      .filter((l) => l.trim());
    const fixed = lines.map((l) => {
      const ev = JSON.parse(l);
      if (ev.name === 'op.a') ev.ts = '2026-08-31T10:00:00.100Z';
      if (ev.name === 'INFO') ev.ts = '2026-08-31T10:00:03.000Z';
      return JSON.stringify(ev);
    });
    writeFileSync(file, fixed.join('\n') + '\n');

    const result = await queryCorrelation({ sessionId: 'sess-q', dbPath });
    assert.equal(result.total, 4, '2 JSONL + 2 token transactions');
    assert.equal(result.sources.tokenTransactions, 2);
    assert.deepEqual(
      result.entries.map((e) => e.kind),
      ['trace', 'token', 'token', 'log'],
      'unified timeline ordered by ts across sources',
    );
    assert.equal(result.entries[0].name, 'op.a');
    assert.equal(result.entries[1].payload?.messageId, 'm1');
    assert.equal(result.entries[3].payload?.message, 'mid');

    // timeRange filter: keeps token m2 (10:00:02) and the log (10:00:03),
    // drops trace op.a (10:00:00.1) and token m1 (10:00:00.5).
    const sliced = await queryCorrelation({
      sessionId: 'sess-q',
      dbPath,
      from: '2026-08-31T10:00:01.000Z',
    });
    assert.equal(sliced.total, 2);
    assert.deepEqual(
      sliced.entries.map((e) => e.kind),
      ['token', 'log'],
    );

    // traceId filter, no token join
    const byTrace = await queryCorrelation({ traceId: 'c'.repeat(32), includeTokens: false });
    assert.equal(byTrace.total, 2);
    assert.ok(byTrace.entries.every((e) => e.traceId === 'c'.repeat(32)));
  } finally {
    if (prevEnv === undefined) delete process.env.GV_TELEMETRY_CORRELATION_DIR;
    else process.env.GV_TELEMETRY_CORRELATION_DIR = prevEnv;
    rmSync(dbDir, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('queryCorrelation tolerates an empty/missing correlation dir', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'gv-correlation-empty-'));
  const result = await queryCorrelation({ sessionId: 'nope', root: empty });
  assert.equal(result.total, 0);
  rmSync(empty, { recursive: true, force: true });
});

test('correlationDir honors env override and defaults under .telemetry', () => {
  const prev = process.env.GV_TELEMETRY_CORRELATION_DIR;
  const root = mkdtempSync(join(tmpdir(), 'gv-correlation-root-'));
  try {
    delete process.env.GV_TELEMETRY_CORRELATION_DIR;
    assert.ok(correlationDir(root).endsWith(join('.telemetry', 'correlation')));
    process.env.GV_TELEMETRY_CORRELATION_DIR = join(root, 'custom');
    assert.equal(correlationDir(root), join(root, 'custom'));
    // Ensure the dirs referenced above exist so Windows temp cleanup is clean.
    mkdirSync(join(root, 'custom'), { recursive: true });
  } finally {
    if (prev === undefined) delete process.env.GV_TELEMETRY_CORRELATION_DIR;
    else process.env.GV_TELEMETRY_CORRELATION_DIR = prev;
    rmSync(root, { recursive: true, force: true });
  }
});
