#!/usr/bin/env node
/**
 * Unit Tests: Performance Profiler
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { join } from 'path';

const PROFILER_PATH = join(process.cwd(), 'src', 'profiler', 'performance-profiler.ts');

	describe('Performance Profiler', () => {
  it('should have source file', () => {
    assert.ok(existsSync(PROFILER_PATH), 'Profiler source should exist');
  });

  it('should have baseline file after execution', () => {
    const baselinePath = join(process.cwd(), '.runtime', 'profiler', 'baseline.json');
    assert.ok(existsSync(baselinePath), 'Baseline should be created');
  });
});
