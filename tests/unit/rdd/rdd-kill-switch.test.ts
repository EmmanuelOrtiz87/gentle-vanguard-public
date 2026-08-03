#!/usr/bin/env node
/**
 * Tests for RDD Kill Switch
 */

import { isDisabled, disable, enable, status, getDisableHistory } from '../../../src/rdd/rdd-kill-switch.ts';
import assert from 'assert';
import { existsSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';

const RDD_DIR = resolve(process.cwd(), '.session', 'rdd');
const DISABLED_FLAG = join(RDD_DIR, 'DISABLED');

console.log('Testing RDD Kill Switch...\n');

// Clean up before tests
if (existsSync(DISABLED_FLAG)) {
  unlinkSync(DISABLED_FLAG);
}

// Test 1: Initial state
console.log('Test 1: Initial state (enabled)');
assert.strictEqual(isDisabled(), false, 'Should be enabled initially');
console.log('✓ PASS\n');

// Test 2: Disable
console.log('Test 2: Disable RDD');
disable('Emergency hotfix');
assert.strictEqual(isDisabled(), true, 'Should be disabled after disable()');
console.log('✓ PASS\n');

// Test 3: Status when disabled
console.log('Test 3: Status when disabled');
const disabledStatus = status();
assert.strictEqual(disabledStatus.disabled, true);
assert.ok(disabledStatus.info);
assert.strictEqual(disabledStatus.info?.reason, 'Emergency hotfix');
console.log('✓ PASS\n');

// Test 4: Enable
console.log('Test 4: Enable RDD');
enable();
assert.strictEqual(isDisabled(), false, 'Should be enabled after enable()');
console.log('✓ PASS\n');

// Test 5: Status when enabled
console.log('Test 5: Status when enabled');
const enabledStatus = status();
assert.strictEqual(enabledStatus.disabled, false);
console.log('✓ PASS\n');

// Test 6: Disable history
console.log('Test 6: Disable history');
const history = getDisableHistory(10);
assert.ok(Array.isArray(history));
assert.ok(history.length >= 2, 'Should have disable and enable events');
assert.strictEqual(history[history.length - 2].action, 'disable');
assert.strictEqual(history[history.length - 1].action, 'enable');
console.log('✓ PASS\n');

// Test 7: Multiple disable/enable cycles
console.log('Test 7: Multiple cycles');
disable('Test 1');
enable();
disable('Test 2');
enable();
const multiHistory = getDisableHistory(10);
assert.ok(multiHistory.length >= 4);
console.log('✓ PASS\n');

// Cleanup
if (existsSync(DISABLED_FLAG)) {
  unlinkSync(DISABLED_FLAG);
}

console.log('All tests passed! ✓');
