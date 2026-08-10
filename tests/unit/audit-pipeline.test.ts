#!/usr/bin/env node
/**
 * Unit Tests: Audit Pipeline
 * Verifies the TS audit pipeline contract:
 *   - module exports the expected API
 *   - newAuditEvent builds a well-formed event
 *   - saveAuditEvent creates the audit directories (works on clean CI runners)
 *   - getStatus() returns a valid AuditStats structure (read-only)
 * Self-contained: does not depend on the session pipeline having run beforehand.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const ROOT = join(import.meta.dirname, '..', '..');
const AUDIT_DIR = join(ROOT, '.session', 'audit');
const LOG_DIR = join(AUDIT_DIR, 'logs');
const AUDIT_SRC = pathToFileURL(join(ROOT, 'src', 'infrastructure', 'audit-pipeline.ts')).href;

describe('Audit Pipeline', () => {
  it('module exports the expected contract', async () => {
    const mod = await import(AUDIT_SRC);
    for (const fn of ['newAuditEvent', 'saveAuditEvent', 'queryEvents', 'getStatus']) {
      assert.equal(typeof (mod as any)[fn], 'function', `${fn} should be exported`);
    }
  });

  it('newAuditEvent builds a well-formed event', async () => {
    const mod = await import(AUDIT_SRC);
    const ev = mod.newAuditEvent({
      eventType: 'session.test',
      component: 'unit-tests',
      operation: 'run',
      actor: 'test-runner',
      target: 'tests/unit/audit-pipeline.test.ts',
    });
    assert.ok(ev.id, 'event should have an id');
    assert.ok(ev.timestamp, 'event should have a timestamp');
    assert.equal(ev.type, 'session.test');
    assert.equal(ev.component, 'unit-tests');
    assert.equal(ev.operation, 'run');
    assert.equal(ev.actor, 'test-runner');
    assert.equal(ev.target, 'tests/unit/audit-pipeline.test.ts');
  });

  it('saveAuditEvent creates the audit directory', async () => {
    const mod = await import(AUDIT_SRC);
    mod.saveAuditEvent(
      mod.newAuditEvent({
        eventType: 'session.test',
        component: 'unit-tests',
        operation: 'run',
        actor: 'test-runner',
      }),
    );
    assert.ok(existsSync(AUDIT_DIR), 'Audit directory should exist after saveAuditEvent');
    assert.ok(existsSync(LOG_DIR), 'Log directory should exist after saveAuditEvent');
  });

  it('getStatus returns a valid AuditStats structure', async () => {
    const mod = await import(AUDIT_SRC);
    const stats = mod.getStatus();
    assert.equal(typeof stats.totalEvents, 'number');
    assert.ok(Array.isArray(stats.logFiles));
    assert.ok(Array.isArray(stats.totalSizeFormatted) === false, 'totalSizeFormatted should be a string');
    assert.equal(typeof stats.totalSizeFormatted, 'string');
  });
});
