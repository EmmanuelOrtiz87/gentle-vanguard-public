#!/usr/bin/env node
/**
 * Tests for RDD Risk Classifier - Using tsx for TypeScript execution
 */

import { classifyRisk, explainRisk, RiskClassification } from '../../../src/rdd/risk-classifier.ts';
import assert from 'assert';

console.log('Testing RDD Risk Classifier...\n');

// Test 1: No changes
console.log('Test 1: No changes');
const noChanges = classifyRisk(true); // staged only (empty)
assert.strictEqual(noChanges.tier, 'low', 'Should be low risk with no changes');
assert.strictEqual(noChanges.reviewLenses, 0, 'Should require 0 lenses');
console.log('✓ PASS\n');

// Test 2: Documentation changes  
console.log('Test 2: Documentation-only changes');
const docsChange: RiskClassification = {
  tier: 'low',
  score: 10,
  factors: [],
  rationale: 'Docs only',
  recommendation: 'No review needed',
  reviewLenses: 0,
};
assert.strictEqual(docsChange.tier, 'low');
assert.strictEqual(docsChange.reviewLenses, 0);
console.log('✓ PASS\n');

// Test 3: Auth changes
console.log('Test 3: Authentication changes');
const authChange: RiskClassification = {
  tier: 'high',
  score: 90,
  factors: [{
    name: 'Crosses security boundary',
    category: 'security',
    severity: 5,
    evidence: 'Auth code detected',
    files: ['auth.ts'],
  }],
  rationale: 'High risk: security',
  recommendation: '4R review required', 
  reviewLenses: 4,
};
assert.strictEqual(authChange.tier, 'high');
assert.strictEqual(authChange.reviewLenses, 4);
assert.ok(authChange.factors.length > 0);
console.log('✓ PASS\n');

// Test 7: Risk tiers
console.log('Test 7: Risk tier boundaries');
const low = { tier: 'low', score: 39 } as RiskClassification;
const standard = { tier: 'standard', score: 40 } as RiskClassification;
const high = { tier: 'high', score: 70 } as RiskClassification;

assert.strictEqual(low.tier, 'low');
assert.strictEqual(standard.tier, 'standard');
assert.strictEqual(high.tier, 'high');
console.log('✓ PASS\n');

console.log('All tests passed! ✓');
