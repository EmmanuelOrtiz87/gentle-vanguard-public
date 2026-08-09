#!/usr/bin/env node
/**
 * Unit Tests: Planning Templates (pre-write planning)
 * Verifies plan creation, rendering, listing, loading, and task linking.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createPlan,
  listPlans,
  loadPlan,
  showPlan,
  linkPlanTask,
  renderPlanMarkdown,
  planStats,
  getPlanRoot,
} from '../../src/planning-templates.ts';

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'planning-templates-'));
  return dir;
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

describe('Planning Templates (pre-write planning)', () => {
  it('should create a feature plan with all sections and gates', () => {
    const root = makeTempRoot();
    try {
      const plan = createPlan(
        {
          type: 'feature',
          name: 'user-auth',
          title: 'User Authentication',
          problem: 'Users cannot log in securely',
          inScope: ['Login form', 'Session tokens'],
          outOfScope: ['Admin UI'],
          constraints: ['Node 20', 'Must not break OAuth'],
        },
        root,
      );

      assert.strictEqual(plan.type, 'feature');
      assert.strictEqual(plan.name, 'user-auth');
      assert.ok(plan.createdAt);
      assert.ok(plan.gates['G1 Scope'] === false);
      assert.deepStrictEqual(plan.linkedTasks, []);

      const md = showPlan('user-auth', root);
      assert.ok(md);
      assert.ok(md.includes('# Plan: User Authentication'));
      assert.ok(md.includes('## Scope Definition'));
      assert.ok(md.includes('## Approach Analysis'));
      assert.ok(md.includes('## Risk Assessment'));
      assert.ok(md.includes('## Task Breakdown'));
      assert.ok(md.includes('## Decision Gates'));
      assert.ok(md.includes('G5 Approval'));
    } finally {
      cleanup(root);
    }
  });

  it('should render a refactor template with the refactor sections', () => {
    const md = renderPlanMarkdown({
      type: 'refactor',
      name: 'api-v2',
      title: 'API v2',
      problem: 'API v1 has tangled handlers',
    });
    assert.ok(md.includes('refactor'));
    assert.ok(md.includes('Scope Definition'));
    assert.ok(md.includes('Rollback strategy'));
  });

  it('should list, load, and link plans', () => {
    const root = makeTempRoot();
    try {
      createPlan(
        {
          type: 'bugfix',
          name: 'auth-timeout',
          title: 'Auth Timeout',
          problem: 'Timeout too short',
        },
        root,
      );
      assert.deepStrictEqual(listPlans(root), ['auth-timeout']);

      const loaded = loadPlan('auth-timeout', root);
      assert.ok(loaded);
      assert.strictEqual(loaded.type, 'bugfix');

      const linked = linkPlanTask('auth-timeout', 'T3', root);
      assert.ok(linked);
      const after = loadPlan('auth-timeout', root);
      assert.ok(after);
      assert.deepStrictEqual(after.linkedTasks, ['T3']);
    } finally {
      cleanup(root);
    }
  });

  it('should return null for missing plans and handle empty dir', () => {
    const root = makeTempRoot();
    try {
      assert.strictEqual(loadPlan('missing', root), null);
      assert.strictEqual(showPlan('missing', root), null);
      assert.strictEqual(linkPlanTask('missing', 'T1', root), false);
      assert.deepStrictEqual(listPlans(root), []);
    } finally {
      cleanup(root);
    }
  });

  it('should sanitize plan names', () => {
    const root = makeTempRoot();
    try {
      const plan = createPlan(
        { type: 'feature', name: 'User Auth!', title: 'User Auth', problem: 'x' },
        root,
      );
      assert.strictEqual(plan.name, 'user-auth');
      assert.strictEqual(
        getPlanRoot(root).endsWith(join('.session', 'sdd-pipeline', 'plans')),
        true,
      );
    } finally {
      cleanup(root);
    }
  });

  it('should report stats across plan types', () => {
    const root = makeTempRoot();
    try {
      createPlan({ type: 'feature', name: 'a', title: 'A', problem: 'x' }, root);
      createPlan({ type: 'bugfix', name: 'b', title: 'B', problem: 'x' }, root);
      const stats = planStats(root);
      assert.strictEqual(stats.count, 2);
      assert.strictEqual(stats.types['feature'], 1);
      assert.strictEqual(stats.types['bugfix'], 1);
    } finally {
      cleanup(root);
    }
  });
});
