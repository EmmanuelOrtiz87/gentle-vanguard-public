import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectProviderLatencyDiagnostics,
  percentile,
  reviewContextDiagnostics,
  summarizeRealizedTokenSavings,
} from '../../src/tokens/token-efficiency-report.js';
import Database from 'better-sqlite3';

test('token efficiency percentile is deterministic and bounded', () => {
  assert.equal(percentile([], 95), 0);
  assert.equal(percentile([10, 20, 30, 40], 50), 20);
  assert.equal(percentile([10, 20, 30, 40], 95), 40);
});

test('review-context diagnostics expose before/after compression targets', () => {
  const diagnostics = reviewContextDiagnostics([
    {
      model: 'GLM-5.3-Flash',
      agent: 'orchestrator',
      samples: 10,
      totalTokens: 2_500_000,
      averageTokens: 250_000,
      p50Tokens: 240_000,
      p95Tokens: 500_000,
      cacheReadTokens: 1_000_000,
      cacheReadRatio: 0.4,
      attention: 'review-context',
    },
    {
      model: 'MiniMax-M3',
      agent: 'orchestrator',
      samples: 10,
      totalTokens: 100_000,
      averageTokens: 10_000,
      p50Tokens: 10_000,
      p95Tokens: 12_000,
      cacheReadTokens: 0,
      cacheReadRatio: 0,
      attention: 'normal',
    },
  ]);

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].baselineAverageTokens, 250_000);
  assert.equal(diagnostics[0].projectedAverageTokens, 80_000);
  assert.equal(diagnostics[0].projectedP95Tokens, 180_000);
  assert.equal(diagnostics[0].estimatedSavingsTokens, 1_700_000);
  assert.equal(diagnostics[0].estimatedReductionPct, 68);
  assert.ok(diagnostics[0].compressionPlan.some((step) => step.includes('verbatim')));
  assert.ok(diagnostics[0].compressionPlan.some((step) => step.includes('context-compaction')));
});

test('realized token savings summarize cache and context optimization categories', () => {
  const savings = summarizeRealizedTokenSavings([
    {
      category: 'context-compaction',
      savedTokens: 12_000,
      samples: 2,
      latestAt: '2026-10-11T18:00:00.000Z',
    },
    {
      category: 'delegation-compression',
      savedTokens: 3_000,
      samples: 1,
      latestAt: '2026-10-11T18:05:00.000Z',
    },
    {
      category: 'response-cache',
      savedTokens: 5_000,
      samples: 4,
      latestAt: '2026-10-11T18:10:00.000Z',
    },
  ]);

  assert.equal(savings.totalSavedTokens, 20_000);
  assert.equal(savings.contextOptimizationSavedTokens, 15_000);
  assert.equal(savings.responseCacheSavedTokens, 5_000);
  assert.deepEqual(
    savings.categories.map((row) => row.category),
    ['context-compaction', 'response-cache', 'delegation-compression'],
  );
});

test('provider latency diagnostics aggregate real Nexus trace durations', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE traces (
      name TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      duration INTEGER,
      status TEXT,
      model TEXT,
      attributes TEXT,
      tenant_id TEXT NOT NULL
    );
  `);
  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO traces (name, start_time, duration, status, model, attributes, tenant_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [duration, status] of [
    [120, 'completed'],
    [220, 'completed'],
    [420, 'error'],
  ] as const) {
    insert.run(
      'llm.provider.call',
      now,
      duration,
      status,
      'glm-5.3-flash',
      JSON.stringify({ provider: 'opencode-zen-C', operation: 'chat.completions' }),
      'gentle-vanguard',
    );
  }
  insert.run(
    'response-cache.hit',
    now,
    10,
    'completed',
    null,
    JSON.stringify({ source: 'maintenance-performance-exercise' }),
    'gentle-vanguard',
  );

  try {
    const diagnostics = collectProviderLatencyDiagnostics(db);
    assert.equal(diagnostics.length, 1);
    assert.deepEqual(diagnostics[0], {
      provider: 'opencode-zen-C',
      model: 'glm-5.3-flash',
      operation: 'chat.completions',
      samples: 3,
      p50Ms: 220,
      p95Ms: 420,
      maxMs: 420,
      errorRate: 0.3333,
    });
  } finally {
    db.close();
  }
});
