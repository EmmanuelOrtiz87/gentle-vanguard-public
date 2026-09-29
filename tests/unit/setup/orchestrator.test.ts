import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSteps, type MachineState } from '../../../src/setup/orchestrator.js';

function state(overrides: Partial<MachineState> = {}): MachineState {
  return {
    hasPackageJson: true,
    hasGit: true,
    hasNodeModules: false,
    hasGraph: false,
    nodeVersion: 'v22.11.0',
    pnpmVersion: '11.0.0',
    gitVersion: 'git version 2.45.0',
    ...overrides,
  };
}

test('planSteps: fresh machine plans all steps with argvs', () => {
  const steps = planSteps(state());
  const ids = steps.map((s) => s.id);
  assert.deepEqual(ids, [
    'prereqs',
    'deps',
    'doctor',
    'nexus',
    'hooks',
    'graphify',
    'skills-index',
    'local-layer',
  ]);
  for (const step of steps) {
    if (step.id === 'prereqs') {
      // With all versions present, prereqs is satisfied (validated in main via prereqsFailReason)
      assert.equal(step.argv, null);
    } else {
      assert.ok(Array.isArray(step.argv), `step ${step.id} should have argv on fresh machine`);
    }
  }
});

test('planSteps: idempotent re-run skips deps and graphify', () => {
  const steps = planSteps(state({ hasNodeModules: true, hasGraph: true }));
  const byId = new Map(steps.map((s) => [s.id, s]));
  assert.equal(byId.get('deps')!.argv, null);
  assert.equal(byId.get('graphify')!.argv, null);
  // doctor/nexus always re-verify (cheap, deterministic)
  assert.ok(byId.get('doctor')!.argv);
  assert.ok(byId.get('nexus')!.argv);
});

test('planSteps: skipDeps flag skips dependency install', () => {
  const steps = planSteps(state(), { skipDeps: true });
  const byId = new Map(steps.map((s) => [s.id, s]));
  assert.equal(byId.get('deps')!.argv, null);
});

test('planSteps: hooks skipped without git repo', () => {
  const steps = planSteps(state({ hasGit: false }));
  const byId = new Map(steps.map((s) => [s.id, s]));
  assert.equal(byId.get('hooks')!.argv, null);
  assert.equal(byId.get('hooks')!.required, false);
});

test('planSteps: required steps are marked required', () => {
  const steps = planSteps(state());
  const required = steps.filter((s) => s.required).map((s) => s.id);
  assert.deepEqual(required, ['prereqs', 'deps', 'doctor', 'nexus']);
});

test('planSteps: no package.json disables all repo steps', () => {
  const steps = planSteps(state({ hasPackageJson: false }));
  for (const step of steps) {
    if (step.id !== 'prereqs') assert.equal(step.argv, null, step.id);
  }
});
