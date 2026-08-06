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

  it('should have index file', () => {
    assert.ok(existsSync(INDEX_FILE), 'Index file should exist');
  });

  it('should have valid index structure', () => {
    if (existsSync(INDEX_FILE)) {
      const index = JSON.parse(readFileSync(INDEX_FILE, 'utf-8'));
      assert.ok(Array.isArray(index.events), 'Events should be array');
    }
  });
});
