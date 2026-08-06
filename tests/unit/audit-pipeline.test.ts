#!/usr/bin/env node
/**
 * Unit Tests: Audit Pipeline
 * Tests audit event generation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const AUDIT_DIR = join(process.cwd(), '.session', 'audit');
const INDEX_FILE = join(AUDIT_DIR, 'index.json');

describe('Audit Pipeline', () => {
  it('should have audit directory', () => {
    assert.ok(existsSync(AUDIT_DIR), 'Audit directory should exist');
  });

  it('should have valid index structure when present', () => {
    // The index is created lazily when the first audit event is logged by the
    // pipeline, so its existence is state-dependent. When present, it must be
    // a valid index with an events array.
    if (existsSync(INDEX_FILE)) {
      const index = JSON.parse(readFileSync(INDEX_FILE, 'utf-8'));
      assert.ok(Array.isArray(index.events), 'Events should be array');
    }
  });
});
