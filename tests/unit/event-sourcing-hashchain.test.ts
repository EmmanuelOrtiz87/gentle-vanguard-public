#!/usr/bin/env node
/**
 * Unit Tests: Event Sourcing — Hash-Chained Audit Trail
 * Verifies that appended events form a tamper-evident hash chain and that
 * the `verify` action detects both intact chains and tampering.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { existsSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const AGGREGATE = `test-chain-${Date.now()}`;
const STORE_FILE = join(ROOT, '.session', 'event-store', `${AGGREGATE}.jsonl`);

function run(args: string[]): string {
  return execFileSync(process.execPath, ['--import', 'tsx', 'src/event-sourcing.ts', ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    env: { ...process.env, SESSION_ID: 'test-session' },
  });
}

describe('Event Sourcing — Hash-Chained Audit', () => {
  it('should append events forming an intact chain', () => {
    run(['-Action', 'append', '-AggregateId', AGGREGATE, '-EventType', 'session.started', '-EventData', '{"user":"test"}']);
    run(['-Action', 'append', '-AggregateId', AGGREGATE, '-EventType', 'task.created', '-EventData', '{"task":"t1"}']);

    const verify = JSON.parse(run(['-Action', 'verify', '-AggregateId', AGGREGATE]));
    assert.strictEqual(verify.total, 2);
    assert.strictEqual(verify.broken, 0);
    assert.strictEqual(verify.intact, true);
  });

  it('should detect tampering in the chain', () => {
    // Append a third event, then tamper with the first event's content.
    run(['-Action', 'append', '-AggregateId', AGGREGATE, '-EventType', 'task.completed', '-EventData', '{"task":"t"}']);
    const lines = readFileSync(STORE_FILE, 'utf-8').split('\n').filter((l) => l.trim());
    const tampered = lines[0].replace('"user":"test"', '"user":"TAMPERED"');
    lines[0] = tampered;
    writeFileSync(STORE_FILE, lines.join('\n'));

    const verify = JSON.parse(run(['-Action', 'verify', '-AggregateId', AGGREGATE]));
    assert.strictEqual(verify.intact, false);
    assert.ok(verify.broken >= 1, 'should detect at least one broken/tampered event');
  });

  after(() => {
    if (existsSync(STORE_FILE)) rmSync(STORE_FILE, { force: true });
  });
});