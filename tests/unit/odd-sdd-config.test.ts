import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { load } from 'js-yaml';
import test from 'node:test';

const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
test('ODD configuration preserves optional host SDD agents and native helpers', () => {
  const host = json('opencode.json');
  const native = json('config/agents.json');
  for (const name of ['sdd-explore', 'sdd-design', 'sdd-apply', 'sdd-verify']) {
    assert.equal(host.agent[name].mode, 'subagent');
    assert.equal(host.agent[name].disable, undefined);
    assert.ok(existsSync(native.agents[name].script));
  }
  const config = json('config/orchestrator.json');
  assert.equal(config.workspace.newProjectFlow, 'odd-inline');
  for (const profile of Object.values(config.toolProfiles) as Array<{
    primaryEntryPoint?: string;
  }>) {
    if (profile.primaryEntryPoint) assert.ok(existsSync(profile.primaryEntryPoint));
  }
  const clarification = json('config/auto-delegation.json').clarifyBaStrategy;
  assert.equal(clarification.action, 'CLARIFY_INLINE');
  const triggers = json('config/system-prompt-tiers.json').dynamicInjection.triggerPatterns.sdd;
  assert.ok(triggers.includes('sdd'));
  assert.ok(!triggers.includes('feature') && !triggers.includes('implement'));
});
test('canonical client policy selects ODD and optional SDD without forced BA', () => {
  const profile = load(readFileSync('config/tool-profiles/profiles.yaml', 'utf8')) as {
    metadata: { canonicalEntry: string };
    core_rules: Array<{ text: string }>;
  };
  assert.ok(existsSync(profile.metadata.canonicalEntry));
  const policy = profile.core_rules.map((rule) => rule.text).join('\n');
  assert.match(policy, /ODD inline-first/);
  assert.match(policy, /SDD only by explicit request/);
  assert.doesNotMatch(policy, /BA\/EXPLORE first, no exceptions/);
});
