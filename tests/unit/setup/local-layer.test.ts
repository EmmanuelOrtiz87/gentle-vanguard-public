import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLocalLayer, type LocalLayerInput } from '../../../src/setup/local-layer.js';

function input(overrides: Partial<LocalLayerInput> = {}): LocalLayerInput {
  return {
    configLocalFiles: [],
    canonConfigFiles: ['token-budget-guard.json', 'model-router.json'],
    skillLocalDirs: [],
    skillLocalHasSkillMd: {},
    localRuleFiles: [],
    ...overrides,
  };
}

test('local layer absent (zero-config) is valid', () => {
  const report = validateLocalLayer(input());
  assert.equal(report.present, false);
  assert.equal(report.ok, true);
  assert.equal(report.issues.length, 0);
});

test('README.md files do not count as content', () => {
  const report = validateLocalLayer(
    input({ configLocalFiles: ['README.md'], localRuleFiles: ['README.md'] }),
  );
  assert.equal(report.present, false);
});

test('matching config override produces no issues', () => {
  const report = validateLocalLayer(
    input({ configLocalFiles: ['token-budget-guard.json'] }),
  );
  assert.equal(report.present, true);
  assert.equal(report.ok, true);
});

test('unknown config name warns (does not fail)', () => {
  const report = validateLocalLayer(
    input({ configLocalFiles: ['nonexistent-config.json'] }),
  );
  assert.equal(report.ok, true);
  assert.equal(report.issues[0].severity, 'WARN');
  assert.match(report.issues[0].message, /no coincide/);
});

test('skill dir without SKILL.md fails', () => {
  const report = validateLocalLayer(
    input({ skillLocalDirs: ['my-skill'], skillLocalHasSkillMd: { 'my-skill': false } }),
  );
  assert.equal(report.ok, false);
  assert.equal(report.issues[0].severity, 'FAIL');
  assert.match(report.issues[0].message, /SKILL\.md/);
});

test('skill dir with SKILL.md passes', () => {
  const report = validateLocalLayer(
    input({ skillLocalDirs: ['my-skill'], skillLocalHasSkillMd: { 'my-skill': true } }),
  );
  assert.equal(report.ok, true);
});

test('local rules alone mark layer as present', () => {
  const report = validateLocalLayer(input({ localRuleFiles: ['my-workflow.md'] }));
  assert.equal(report.present, true);
  assert.equal(report.ok, true);
});
