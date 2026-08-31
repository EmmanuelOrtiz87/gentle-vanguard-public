#!/usr/bin/env node
/**
 * Research Trends — Last30Days trend aggregation engine.
 *
 * Aggregates recent discussions and trending content from GitHub, Hacker News,
 * Stack Overflow, Dev.to and Reddit into a normalized TrendReport. Powers the
 * web-research skill as an evolution layer for staying current.
 *
 * Usage (library):
 *   import { fetchTrends, queryThemes, renderMarkdown } from './research/research-trends.js';
 *   const report = await fetchTrends({ timeframe: '7d', sources: ['github', 'hackernews'] });
 */

export * from './research-trends/schemas.js';
export * from './research-trends/config.js';
export * from './research-trends/http.js';
export * from './research-trends/sources.js';
export * from './research-trends/report.js';
export * from './research-trends/fetch.js';
