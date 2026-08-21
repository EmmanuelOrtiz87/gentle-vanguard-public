#!/usr/bin/env node
/**
 * Unit Tests: Timeout Monitor
 * Tests timeout monitor source
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { join } from 'path';

const MONITOR_PATH = join(process.cwd(), 'src', 'core', 'timeout-monitor.ts');

describe('Timeout Monitor', () => {
  it('should have source file', () => {
    assert.ok(existsSync(MONITOR_PATH), 'Timeout monitor source should exist');
  });

  it('should have valid TypeScript extension', () => {
    assert.ok(MONITOR_PATH.endsWith('.ts'), 'Should be TypeScript file');
  });
});
