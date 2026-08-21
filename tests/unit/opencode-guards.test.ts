import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import {
  normalizeSteps,
  validateOpencodeJsonSteps,
  validateAgentMdSteps,
} from '../../src/opencode-guards.ts';

const TEMP_MD = join(process.cwd(), '.opencode', 'agents', 'temp-agent.md');

test('normalizes decimal step values by ceiling them', () => {
  assert.equal(normalizeSteps(40.1), 41);
  assert.equal(normalizeSteps(52.5), 53);
  assert.equal(normalizeSteps(0), 1);
  assert.equal(normalizeSteps(-5), 1);
  assert.equal(normalizeSteps(100), 80);
});

test('validates opencode.json agent steps as integers', () => {
  const ok = {
    agent: {
      orchestrator: { steps: 24 },
      'sdd-apply': { steps: 52 },
    },
  };
  const bad = {
    agent: {
      orchestrator: { steps: 24 },
      'sdd-apply': { steps: 52.5 },
    },
  };

  assert.deepEqual(validateOpencodeJsonSteps(ok), []);
  assert.deepEqual(validateOpencodeJsonSteps(bad), [
    'opencode.json.agent.sdd-apply.steps must be a positive integer, got 52.5',
  ]);
});

test('validates .opencode agent MD frontmatter steps', () => {
  const content = `---\ndescription: Test agent\nmode: subagent\nsteps: 42\n---\nBody`;
  const invalid = `---\ndescription: Test agent\nmode: subagent\nsteps: 42.5\n---\nBody`;

  writeFileSync(TEMP_MD, content, 'utf-8');
  assert.deepEqual(validateAgentMdSteps(TEMP_MD), []);
  writeFileSync(TEMP_MD, invalid, 'utf-8');
  assert.deepEqual(validateAgentMdSteps(TEMP_MD), [
    `${TEMP_MD}: steps must be a positive integer, got 42.5`,
  ]);

  unlinkSync(TEMP_MD);
});
