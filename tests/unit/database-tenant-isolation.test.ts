import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { EventRepo } from '../../src/database/nexus//repositories/EventRepo';
import { MigrationRunner } from '../../src/database/nexus//repositories/MigrationRunner';
import { MetricsRepo } from '../../src/database/nexus//repositories/MetricsRepo';
import { SessionRepo } from '../../src/database/nexus//repositories/SessionRepo';
import { TraceRepo } from '../../src/database/nexus//repositories/TraceRepo';
import { EventRepo as AlertRepo } from '../../src/database/nexus//repositories/EventRepo';
import { SkillRepo } from '../../src/database/nexus//repositories/SkillRepo';
import { CacheRepo } from '../../src/database/nexus//repositories/CacheRepo';
import { BacklogRepo } from '../../src/database/nexus//repositories/BacklogRepo';
import { TokenRepo } from '../../src/database/nexus//repositories/TokenRepo';

function createDatabase(): Database.Database {
  const db = new Database(':memory:');
  new MigrationRunner(db).runMigrations();
  db.exec("INSERT INTO tenants (id, name) VALUES ('other-tenant', 'Other Tenant')");
  return db;
}

test('tenant migration creates ownership tables and default tenant columns', () => {
  const db = createDatabase();

  for (const table of ['tenants', 'principals', 'memberships', 'dashboard_auth_sessions']) {
    assert.ok(
      db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get('table', table),
    );
  }
  for (const table of [
    'metric_snapshots',
    'sessions',
    'events',
    'traces',
    'token_usage',
    'alerts',
    'feedback',
    'response_cache',
    'token_transactions',
  ]) {
    assert.ok(
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = 'tenant_id'`).get(),
    );
    const row = db.prepare(`SELECT tenant_id FROM ${table}`).get() as
      { tenant_id: string } | undefined;
    assert.equal(row, undefined);
  }
  for (const table of ['backlog_items', 'skill_usage', 'routing_rules']) {
    assert.ok(
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = 'tenant_id'`).get(),
    );
  }
  for (const index of [
    'idx_backlog_items_tenant_created',
    'idx_skill_usage_tenant_skill',
    'idx_routing_rules_tenant_enabled',
  ]) {
    assert.ok(
      db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get('index', index),
    );
  }

  db.prepare('INSERT INTO metric_snapshots (timestamp) VALUES (?)').run('2026-01-01');
  db.prepare('INSERT INTO sessions (id, agent, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    'legacy-session',
    'agent',
    '2026-01-01',
    '2026-01-01',
  );
  db.prepare('INSERT INTO events (type) VALUES (?)').run('legacy-event');
  assert.equal(
    (db.prepare('SELECT tenant_id FROM metric_snapshots').get() as { tenant_id: string }).tenant_id,
    'gentle-vanguard',
  );
  assert.equal(
    (db.prepare('SELECT tenant_id FROM sessions').get() as { tenant_id: string }).tenant_id,
    'gentle-vanguard',
  );
  assert.equal(
    (db.prepare('SELECT tenant_id FROM events').get() as { tenant_id: string }).tenant_id,
    'gentle-vanguard',
  );
  db.close();
});

test('observability repositories never cross tenant boundaries', () => {
  const db = createDatabase();
  const traces = new TraceRepo(db);
  const alerts = new AlertRepo(db);
  const skills = new SkillRepo(db);
  const cache = new CacheRepo(db);

  traces.insertTrace('gentle-vanguard', {
    span_id: 'shared-feedback-span',
    trace_id: 'trace',
    name: 'default',
  });
  traces.insertTrace('other-tenant', { span_id: 'other-span', trace_id: 'trace', name: 'other' });
  traces.insertFeedback('gentle-vanguard', {
    trace_id: 'trace',
    span_id: 'default-span',
    type: 'up',
  });
  traces.insertFeedback('other-tenant', {
    trace_id: 'trace',
    span_id: 'shared-feedback-span',
    type: 'down',
  });
  alerts.insertAlert('gentle-vanguard', {
    name: 'cpu',
    rule: 'cpu',
    severity: 'warning',
    triggered: 1,
    actual: 90,
    threshold: 80,
  });
  alerts.insertAlert('other-tenant', {
    name: 'cpu',
    rule: 'cpu',
    severity: 'warning',
    triggered: 0,
    actual: 10,
    threshold: 80,
  });
  skills.recordTokenUsage('gentle-vanguard', 'session', 10, 20, 1, 'model');
  skills.recordTokenUsage('other-tenant', 'session', 100, 200, 2, 'model');
  cache.setCachedResponse('gentle-vanguard', 'same-key', 'default-response');
  cache.setCachedResponse('other-tenant', 'same-key', 'other-response');

  assert.deepEqual(traces.getTracesBySession('gentle-vanguard', 'missing'), []);
  assert.equal(traces.getLatencyStats('gentle-vanguard').count, 0);
  assert.equal(traces.getFeedbackStats('gentle-vanguard').thumbsUp, 1);
  assert.equal(traces.getFeedbackStats('gentle-vanguard').thumbsDown, 0);
  assert.equal(alerts.getRecentAlerts('gentle-vanguard')[0].tenant_id, 'gentle-vanguard');
  assert.equal(skills.getTokenUsageBySession('gentle-vanguard', 'session').totalPrompt, 10);
  assert.equal(skills.getTokenUsageBySession('other-tenant', 'session').totalPrompt, 100);
  assert.equal(
    cache.getCachedResponse('gentle-vanguard', 'same-key')?.response,
    'default-response',
  );
  assert.equal(cache.getCachedResponse('other-tenant', 'same-key')?.response, 'other-response');
  db.close();
});

test('tenant repositories use exact equality for reads and writes', () => {
  const db = createDatabase();
  const metrics = new MetricsRepo(db);
  const sessions = new SessionRepo(db);
  const events = new EventRepo(db);

  metrics.insertMetricSnapshot('gentle-vanguard', { tokens_used: 10 });
  metrics.insertMetricSnapshot('other-tenant', { tokens_used: 20 });
  sessions.upsertSession('gentle-vanguard', { id: 'shared-id', agent: 'default' });
  sessions.upsertSession('other-tenant', { id: 'other-id', agent: 'other' });
  events.insertEvent('gentle-vanguard', 'default-event');
  events.insertEvent('other-tenant', 'other-event');

  assert.equal(metrics.getLatestMetricSnapshot('gentle-vanguard')?.tokens_used, 10);
  assert.equal(metrics.getLatestMetricSnapshot('other-tenant')?.tokens_used, 20);
  assert.deepEqual(
    sessions.getAllSessions('gentle-vanguard').map((row) => row.id),
    ['shared-id'],
  );
  assert.deepEqual(
    sessions.getAllSessions('other-tenant').map((row) => row.id),
    ['other-id'],
  );
  assert.deepEqual(
    events.getRecentEvents('gentle-vanguard').map((row) => row.type),
    ['default-event'],
  );
  assert.deepEqual(
    events.getRecentEvents('other-tenant').map((row) => row.type),
    ['other-event'],
  );
  db.close();
});

test('backlog, skill usage, and routing rules are isolated by tenant', () => {
  const db = createDatabase();
  const backlog = new BacklogRepo(db);
  const skills = new SkillRepo(db);

  const defaultId = backlog.addItem(
    { type: 'bug', title: 'default', severity: 'high', status: 'open' },
    'gentle-vanguard',
  );
  const otherId = backlog.addItem(
    { type: 'bug', title: 'other', severity: 'low', status: 'open' },
    'other-tenant',
  );
  assert.deepEqual(
    backlog.listItems({}, 'gentle-vanguard').map((item) => item.id),
    [defaultId],
  );
  assert.deepEqual(
    backlog.listItems({}, 'other-tenant').map((item) => item.id),
    [otherId],
  );
  assert.equal(backlog.getItem(otherId, 'gentle-vanguard'), null);
  backlog.addComment(otherId, 'must not write', 'test', 'gentle-vanguard');
  assert.equal(backlog.getComments(otherId, 'other-tenant').length, 0);

  skills.recordSkillUsage('gentle-vanguard', 'shared-skill', 'shared-session', 10, 1);
  skills.recordSkillUsage('other-tenant', 'shared-skill', 'shared-session', 20, 2);
  assert.equal(skills.getTopSkills('gentle-vanguard')[0].tokensUsed, 10);
  assert.equal(skills.getTopSkills('other-tenant')[0].tokensUsed, 20);

  skills.upsertRoutingRule('gentle-vanguard', 'shared-pattern', 'default');
  skills.upsertRoutingRule('other-tenant', 'shared-pattern', 'other');
  skills.recordRoutingHit('other-tenant', 'shared-pattern');
  assert.equal(skills.getEnabledRoutingRules('gentle-vanguard')[0].target, 'default');
  assert.equal(skills.getEnabledRoutingRules('gentle-vanguard')[0].hitCount, 0);
  assert.equal(skills.getEnabledRoutingRules('other-tenant')[0].target, 'other');
  assert.equal(skills.getEnabledRoutingRules('other-tenant')[0].hitCount, 1);
  db.close();
});

test('token repository keeps aggregates and transactions tenant-scoped', () => {
  const db = createDatabase();
  const tokens = new TokenRepo(db);

  assert.equal(
    tokens.upsertUsage('gentle-vanguard', {
      sessionId: 'shared-session',
      promptTokens: 10,
      completionTokens: 20,
      cost: 1,
      model: 'model-a',
      timestamp: '2026-01-01 00:00:00',
    }),
    'inserted',
  );
  assert.equal(
    tokens.upsertUsage('gentle-vanguard', {
      sessionId: 'shared-session',
      promptTokens: 30,
      completionTokens: 40,
      cost: 2,
      model: 'model-b',
      timestamp: '2026-01-01 00:01:00',
    }),
    'updated',
  );
  assert.equal(
    tokens.upsertUsage('other-tenant', {
      sessionId: 'shared-session',
      promptTokens: 100,
      completionTokens: 200,
      cost: 3,
      timestamp: '2026-01-01 00:00:00',
    }),
    'inserted',
  );

  const transaction = {
    messageId: 'shared-message',
    sessionId: 'shared-session',
    agent: 'orchestrator',
    model: 'model',
    inputTokens: 1,
    outputTokens: 2,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
    createdAt: '2026-01-01 00:00:00',
  };
  assert.deepEqual(tokens.insertTransactions('gentle-vanguard', [transaction]), {
    inserted: 1,
    skipped: 0,
  });
  assert.deepEqual(tokens.insertTransactions('gentle-vanguard', [transaction]), {
    inserted: 0,
    skipped: 1,
  });
  assert.deepEqual(tokens.insertTransactions('other-tenant', [transaction]), {
    inserted: 1,
    skipped: 0,
  });

  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM token_usage').get() as { count: number }).count,
    2,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM token_transactions').get() as { count: number })
      .count,
    2,
  );
  db.close();
});
