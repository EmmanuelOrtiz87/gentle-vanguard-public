#!/usr/bin/env node
/**
 * Unit Tests: research-trends (Last30Days trend aggregation engine).
 *
 * Covers the pure, network-free functions: buildReport (dedupe + sort +
 * themes), queryThemes (tag/title filtering with OR syntax), renderMarkdown
 * (report formatting) and deserializeReport (schema round-trip).
 *
 * No HTTP calls are made — all fixtures are local.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  buildReport,
  queryThemes,
  renderMarkdown,
  deserializeReport,
  RESEARCH_TRENDS_VERSION,
  type Trend,
  type TrendReport,
  type ResearchTrendsConfig,
} from '../../src/research-trends.ts';

const now = new Date('2026-08-08T00:00:00Z');

function makeTrend(partial: Partial<Trend> & { id: string; title: string }): Trend {
  return {
    source: 'github',
    url: `https://github.com/example/${partial.id}`,
    description: `Description for ${partial.title}`,
    engagement: {},
    tags: [],
    createdAt: now,
    fetchedAt: now,
    ...partial,
  };
}

function makeConfig(): ResearchTrendsConfig {
  return {
    version: '1.0.0',
    name: 'test-config',
    description: 'test',
    enabled: true,
    cacheEnabled: false,
    cacheTtlMinutes: 1440,
    cacheDir: '.session/trends/cache',
    reportDir: '.session/trends',
    defaultTimeframe: '7d',
    hottestCount: 3,
    emergingCount: 2,
    fetchTimeoutMs: 20000,
    maxRetries: 0,
    retryDelayMs: 100,
    sources: {
      github: { enabled: true },
      hackernews: { enabled: true },
      stackoverflow: { enabled: true },
      devto: { enabled: true },
      reddit: { enabled: true },
    },
    firecrawl: {
      enabled: false,
      scrapeTrendingPages: false,
      trendingPages: ['https://github.com/trending'],
      enrichWithScrape: true,
    },
    theme: {
      maxThemes: 20,
      maxTrendsPerTheme: 8,
    },
  };
}

describe('research-trends constants', () => {
  it('exposes a version', () => {
    assert.match(RESEARCH_TRENDS_VERSION, /^\d+\.\d+\.\d+$/);
  });
});

describe('buildReport', () => {
  it('sorts by engagement descending and dedupes by id', async () => {
    const cfg = makeConfig();
    const trends: Trend[] = [
      makeTrend({ id: 'a', title: 'Low', engagement: { stars: 5 } }),
      makeTrend({ id: 'a', title: 'Low duplicate', engagement: { stars: 5 } }), // duplicate id
      makeTrend({ id: 'b', title: 'High', engagement: { stars: 9001 } }),
      makeTrend({ id: 'c', title: 'Medium', engagement: { stars: 42 } }),
      makeTrend({ id: 'd', title: 'Viral', engagement: { stars: 12345 }, tags: ['rust'] }),
    ];

    const report = await buildReport(trends, '7d', cfg);

    assert.equal(report.timeframe, '7d');
    assert.ok(report.timestamp);
    // Dedupe: 5 inputs with 1 duplicate → 4 unique.
    assert.equal(report.hottest.length, 3);
    assert.equal(report.hottest[0].id, 'd', 'hottest should be the viral item');
    assert.equal(report.hottest[0].title, 'Viral');
    // Emerging excludes hottest.
    const hottestIds = new Set(report.hottest.map((t) => t.id));
    assert.ok(report.emerging.every((t) => !hottestIds.has(t.id)));
    // Themes derived from tags.
    assert.ok(report.themes.length >= 1);
    const rustTheme = report.themes.find((th) => th.tag === 'rust');
    assert.ok(rustTheme, 'rust tag should produce a theme');
    assert.equal(rustTheme?.count, 1);
  });

  it('handles an empty input gracefully', async () => {
    const report = await buildReport([], '24h', makeConfig());
    assert.equal(report.hottest.length, 0);
    assert.equal(report.emerging.length, 0);
    assert.equal(report.themes.length, 0);
  });
});

describe('queryThemes', () => {
  it('matches themes and trends by tag with OR syntax', async () => {
    const cfg = makeConfig();
    const report = await buildReport(
      [
        makeTrend({
          id: 'r1',
          title: 'Rust borrow checker',
          tags: ['rust'],
          engagement: { stars: 100 },
        }),
        makeTrend({
          id: 't1',
          title: 'TypeScript 6.0',
          tags: ['typescript'],
          engagement: { stars: 200 },
        }),
        makeTrend({
          id: 'p1',
          title: 'Python packaging',
          tags: ['python'],
          engagement: { stars: 50 },
        }),
      ],
      '7d',
      cfg,
    );

    const result = queryThemes(report, 'rust OR typescript');
    assert.ok(result.matchedThemes.some((th) => th.tag === 'rust'));
    assert.ok(result.matchedThemes.some((th) => th.tag === 'typescript'));
    const matchedIds = new Set(result.matchedTrends.map((t) => t.id));
    assert.ok(matchedIds.has('r1'));
    assert.ok(matchedIds.has('t1'));
    assert.ok(!matchedIds.has('p1'), 'python should not match');
  });

  it('matches by title text', () => {
    const report: TrendReport = {
      timeframe: '7d',
      timestamp: now.toISOString(),
      themes: [],
      hottest: [makeTrend({ id: 'x', title: 'Deep Learning Survey', tags: [] })],
      emerging: [],
    };
    const result = queryThemes(report, 'deep learning');
    assert.equal(result.matchedTrends.length, 1);
    assert.equal(result.matchedTrends[0].id, 'x');
  });
});

describe('renderMarkdown', () => {
  it('renders a report with title, hottest and emerging sections', async () => {
    const cfg = makeConfig();
    const report = await buildReport(
      [
        makeTrend({ id: 'a', title: 'Alpha', engagement: { stars: 10 }, tags: ['x'] }),
        makeTrend({ id: 'b', title: 'Beta', engagement: { upvotes: 20 } }),
      ],
      '7d',
      cfg,
    );
    const md = renderMarkdown(report);
    assert.ok(md.includes('# Last30Days Trend Report — 7d'));
    assert.ok(md.includes('## Hottest'));
    assert.ok(md.includes('## Emerging'));
    assert.ok(md.includes('Alpha'));
    assert.ok(md.includes('https://github.com/example/a'));
  });
});

describe('deserializeReport', () => {
  it('round-trips a serialized report through the schema', async () => {
    const cfg = makeConfig();
    const report = await buildReport(
      [makeTrend({ id: 'a', title: 'Round Trip', tags: ['test'], engagement: { stars: 7 } })],
      '7d',
      cfg,
    );
    const serialized = {
      timeframe: report.timeframe,
      timestamp: report.timestamp,
      themes: report.themes.map((th) => ({
        tag: th.tag,
        count: th.count,
        trends: th.trends.map((t) => ({
          id: t.id,
          source: t.source,
          title: t.title,
          url: t.url,
          description: t.description,
          engagement: t.engagement,
          tags: t.tags,
          createdAt: t.createdAt.toISOString(),
          fetchedAt: t.fetchedAt.toISOString(),
        })),
      })),
      hottest: report.hottest.map((t) => ({
        id: t.id,
        source: t.source,
        title: t.title,
        url: t.url,
        description: t.description,
        engagement: t.engagement,
        tags: t.tags,
        createdAt: t.createdAt.toISOString(),
        fetchedAt: t.fetchedAt.toISOString(),
      })),
      emerging: report.emerging.map((t) => ({
        id: t.id,
        source: t.source,
        title: t.title,
        url: t.url,
        description: t.description,
        engagement: t.engagement,
        tags: t.tags,
        createdAt: t.createdAt.toISOString(),
        fetchedAt: t.fetchedAt.toISOString(),
      })),
    };

    const deserialized = deserializeReport(serialized);
    assert.equal(deserialized.timeframe, report.timeframe);
    assert.equal(deserialized.hottest[0]?.title, 'Round Trip');
    assert.ok(deserialized.hottest[0]?.createdAt instanceof Date);
  });
});
