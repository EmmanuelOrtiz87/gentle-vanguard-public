import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { describe, it } from 'node:test';
import { MigrationRunner } from '../../apps/web-dashboard/server/database/repositories/MigrationRunner';
import { SkillRepo } from '../../apps/web-dashboard/server/database/repositories/SkillRepo';
import { recommend } from '../../src/orchestration/recommend-agent';
import { recordRoutingOutcome } from '../../src/orchestration/route-and-delegate';

function createRoutingRepo(): { db: Database.Database; repo: SkillRepo } {
  const db = new Database(':memory:');
  new MigrationRunner(db).runMigrations();
  return { db, repo: new SkillRepo(db) };
}

describe('routing learning loop', () => {
  it('records a successful delegation and Nexus becomes the next recommendation authority', () => {
    const { db, repo } = createRoutingRepo();
    recordRoutingOutcome('testing', 'custom-test-agent', true, 'tenant-a', {
      recordRoutingOutcome: (pattern, target, success, tenantId) =>
        repo.recordRoutingOutcome(tenantId, pattern, target, success),
    });

    const rule = repo.getEnabledRoutingRules('tenant-a')[0];
    assert.equal(rule.hitCount, 1);
    assert.equal(rule.successCount, 1);
    assert.equal(rule.successRate, 100);

    assert.deepEqual(
      recommend('run testing checks', '', 3, { tenantId: 'tenant-a', nexus: repo }),
      {
        domain: 'testing',
        recommended: 'custom-test-agent',
        confidence: 1,
        alternatives: [],
        source: 'nexus',
      },
    );
    db.close();
  });

  it('keeps outcomes isolated by tenant and records failures', () => {
    const { db, repo } = createRoutingRepo();
    repo.recordRoutingOutcome('tenant-a', 'security', 'security-agent', false);
    repo.recordRoutingOutcome('tenant-b', 'security', 'other-security-agent', true);

    const failed = repo.getEnabledRoutingRules('tenant-a')[0];
    assert.equal(failed.hitCount, 1);
    assert.equal(failed.successCount, 0);
    assert.equal(failed.successRate, 0);
    assert.equal(repo.getEnabledRoutingRules('tenant-b')[0].target, 'other-security-agent');
    assert.equal(
      (
        recommend('security audit', '', 3, { tenantId: 'tenant-a', nexus: repo }) as {
          recommended: string;
        }
      ).recommended,
      'security-agent',
    );
    db.close();
  });
});
