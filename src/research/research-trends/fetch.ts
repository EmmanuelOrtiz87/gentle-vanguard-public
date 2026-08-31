import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { z } from 'zod';
import { CONFIG_PATH, loadConfig, ROOT } from './config.js';
import { TrendCache } from './http.js';
import {
  buildReport,
  cacheKeyFn,
  deserializeReport,
  deserializeTrend,
  serializeReport,
  serializeTrend,
} from './report.js';
import type { FetchOptions, FetchResult, Trend, TrendSchema, TrendSource } from './schemas.js';
import {
  fetchDevTo,
  fetchGithub,
  fetchHackerNews,
  fetchReddit,
  fetchStackOverflow,
  normalizeTrend,
  scrapeTrendingPages,
} from './sources.js';
import { log } from '../../utils/logger.js';
const logger = log('RESEARCH-RESEARCH-TRENDS-FETCH');

// ─── Main fetch entry ─────────────────────────────────────────────────────────

export async function fetchTrends(options: FetchOptions = {}): Promise<FetchResult> {
  const config = loadConfig();
  const timeframe = options.timeframe ?? config.defaultTimeframe;
  const requested = options.sources ?? (Object.keys(config.sources) as TrendSource[]);
  const sources = requested.filter((s) => config.sources[s]?.enabled !== false);
  const cache = new TrendCache(config);
  const cacheKey = cacheKeyFn('report', timeframe, [...sources].sort().join(','));

  const cachedReport = cache.get<unknown>(cacheKey);
  if (cachedReport) {
    return {
      report: deserializeReport(cachedReport),
      sources,
      cached: true,
    };
  }

  const fetchMap: Record<TrendSource, () => Promise<Trend[]>> = {
    github: () => fetchGithub(config, timeframe),
    hackernews: () => fetchHackerNews(config, timeframe),
    stackoverflow: () => fetchStackOverflow(config, timeframe),
    devto: () => fetchDevTo(config, timeframe),
    reddit: () => fetchReddit(config, timeframe),
  };

  const all: Trend[] = [];
  const perSourceCache = new TrendCache(config);

  for (const source of sources) {
    const srcKey = cacheKeyFn('source', source, timeframe);
    const cached = perSourceCache.get<z.infer<typeof TrendSchema>[]>(srcKey);
    if (cached) {
      all.push(...cached.map(deserializeTrend));
      continue;
    }
    try {
      const trends = await fetchMap[source]();
      perSourceCache.set(srcKey, trends.map(serializeTrend));
      all.push(...trends);
    } catch (e) {
      // A single source failing should not kill the whole report.
      logger.warn(`[research-trends] ${source} source failed: ${(e as Error).message}`);
    }
  }

  // Firecrawl integration: scrape trending pages for velocity cross-reference.
  if (
    config.firecrawl.enabled &&
    config.firecrawl.scrapeTrendingPages &&
    sources.includes('github')
  ) {
    try {
      const pages = await scrapeTrendingPages(config);
      const existingGithub = all.filter((t) => t.source === 'github');
      const existing = new Map(existingGithub.map((t) => [t.url, t]));
      for (const page of pages) {
        if (!existing.has(page.url)) {
          all.push(
            normalizeTrend(
              'github',
              {
                id: page.url.replace('https://github.com/', ''),
                title: page.title,
                url: page.url,
                description: page.description,
                engagement: { stars: page.stars ?? page.starsToday },
                tags: page.language ? [page.language.toLowerCase()] : [],
                createdAt: new Date().toISOString(),
              },
              new Date(),
            ),
          );
        } else if (page.starsToday && existing.get(page.url)!.engagement.stars === undefined) {
          existing.get(page.url)!.engagement.stars = page.starsToday;
        }
      }
    } catch (e) {
      logger.warn(`[research-trends] Firecrawl trending scrape failed: ${(e as Error).message}`);
    }
  }

  const report = await buildReport(all, timeframe, config);
  cache.set(cacheKey, serializeReport(report));

  try {
    mkdirSync(resolve(ROOT, config.reportDir), { recursive: true });
    writeFileSync(
      join(resolve(ROOT, config.reportDir), `report-${timeframe}.json`),
      JSON.stringify(serializeReport(report), null, 2),
      'utf-8',
    );
  } catch {
    /* non-fatal */
  }

  return { report, sources, cached: false };
}

// ─── Direct execution guard (library mode) ────────────────────────────────────

export const CONFIG_PATH_EXPORT = CONFIG_PATH;
export const RESEARCH_TRENDS_VERSION = '1.0.0';
