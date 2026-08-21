#!/usr/bin/env node
/**
 * Research Trends — Last30Days trend aggregation engine.
 *
 * Aggregates recent discussions and trending content from GitHub, Hacker News,
 * Stack Overflow, Dev.to and Reddit into a normalized TrendReport. Powers the
 * web-research skill as an evolution layer for staying current.
 *
 * Usage (library):
 *   import { fetchTrends, queryThemes, renderMarkdown } from './research-trends.js';
 *   const report = await fetchTrends({ timeframe: '7d', sources: ['github', 'hackernews'] });
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { z } from 'zod';

const ROOT = resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd());
const CONFIG_PATH = join(ROOT, 'config', 'research-trends.json');

// ─── Types (Zod) ──────────────────────────────────────────────────────────────

export const TrendSourceSchema = z.enum([
  'github',
  'hackernews',
  'stackoverflow',
  'devto',
  'reddit',
]);

export type TrendSource = z.infer<typeof TrendSourceSchema>;

export const TimeframeSchema = z.enum(['24h', '7d', '30d']);
export type Timeframe = z.infer<typeof TimeframeSchema>;

export const TrendSchema = z.object({
  id: z.string(),
  source: TrendSourceSchema,
  title: z.string(),
  url: z.string(),
  description: z.string(),
  engagement: z
    .object({
      stars: z.number().int().nonnegative().optional(),
      upvotes: z.number().int().nonnegative().optional(),
      comments: z.number().int().nonnegative().optional(),
      views: z.number().int().nonnegative().optional(),
    })
    .default({}),
  tags: z.array(z.string()).default([]),
  createdAt: z.string(),
  fetchedAt: z.string(),
});

export type Trend = {
  id: string;
  source: TrendSource;
  title: string;
  url: string;
  description: string;
  engagement: {
    stars?: number;
    upvotes?: number;
    comments?: number;
    views?: number;
  };
  tags: string[];
  createdAt: Date;
  fetchedAt: Date;
};

export const ThemeSchema = z.object({
  tag: z.string(),
  count: z.number().int().nonnegative(),
  trends: z.array(TrendSchema),
});

export const TrendReportSchema = z.object({
  timeframe: TimeframeSchema,
  timestamp: z.string(),
  themes: z.array(ThemeSchema),
  hottest: z.array(TrendSchema),
  emerging: z.array(TrendSchema),
});

export type TrendReport = {
  timeframe: Timeframe;
  timestamp: string;
  themes: { tag: string; count: number; trends: Trend[] }[];
  hottest: Trend[];
  emerging: Trend[];
};

// ─── Config ───────────────────────────────────────────────────────────────────

interface Engagement {
  stars?: number;
  upvotes?: number;
  comments?: number;
  views?: number;
}

const SourceSchema = z
  .object({
    enabled: z.boolean().default(true),
  })
  .passthrough();

const ResearchTrendsConfigSchema = z.object({
  version: z.string().default('1.0.0'),
  name: z.string().default('research-trends-config'),
  description: z.string().default(''),
  enabled: z.boolean().default(true),
  cacheEnabled: z.boolean().default(true),
  cacheTtlMinutes: z.number().int().positive().default(1440),
  cacheDir: z.string().default('.session/trends/cache'),
  reportDir: z.string().default('.session/trends'),
  defaultTimeframe: TimeframeSchema.default('7d'),
  hottestCount: z.number().int().positive().default(10),
  emergingCount: z.number().int().positive().default(10),
  fetchTimeoutMs: z.number().int().positive().default(20000),
  maxRetries: z.number().int().min(0).default(2),
  retryDelayMs: z.number().int().positive().default(500),
  sources: z
    .object({
      github: SourceSchema,
      hackernews: SourceSchema,
      stackoverflow: SourceSchema,
      devto: SourceSchema,
      reddit: SourceSchema,
    })
    .partial()
    .default({}),
  firecrawl: z
    .object({
      enabled: z.boolean().default(true),
      scrapeTrendingPages: z.boolean().default(true),
      trendingPages: z.array(z.string()).default(['https://github.com/trending']),
      enrichWithScrape: z.boolean().default(true),
    })
    .partial()
    .default({}),
  theme: z
    .object({
      maxThemes: z.number().int().positive().default(20),
      maxTrendsPerTheme: z.number().int().positive().default(8),
    })
    .partial()
    .default({}),
});

export type ResearchTrendsConfig = z.infer<typeof ResearchTrendsConfigSchema> & {
  sources: Record<TrendSource, { enabled: boolean } & Record<string, unknown>>;
};

export interface FetchOptions {
  timeframe?: Timeframe;
  sources?: TrendSource[];
}

export interface TrendingPage {
  url: string;
  title: string;
  description: string;
  starsToday?: number;
  stars?: number;
  language?: string;
  fetchedAt?: Date;
}

export interface FetchResult {
  report: TrendReport;
  sources: TrendSource[];
  cached: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolveFn) => setTimeout(resolveFn, ms));
}

function loadConfig(): ResearchTrendsConfig {
  const raw: Record<string, unknown> = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      Object.assign(raw, JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')));
    } catch {
      /* fall through to defaults */
    }
  }
  const parsed = ResearchTrendsConfigSchema.parse(raw);
  return parsed as ResearchTrendsConfig;
}

function timeframeToMs(tf: Timeframe): number {
  switch (tf) {
    case '24h':
      return 24 * 60 * 60 * 1000;
    case '7d':
      return 7 * 24 * 60 * 60 * 1000;
    case '30d':
      return 30 * 24 * 60 * 60 * 1000;
  }
}

function timeframeToReddit(tf: Timeframe): string {
  switch (tf) {
    case '24h':
      return 'day';
    case '7d':
      return 'week';
    case '30d':
      return 'month';
  }
}

function cacheKey(op: string, ...parts: unknown[]): string {
  const raw = JSON.stringify([op, ...parts]);
  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

function makeId(source: TrendSource, seed: string): string {
  return `${source}:${seed}`;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

class TrendCache {
  private readonly dir: string;
  private readonly enabled: boolean;
  private readonly ttlMs: number;

  constructor(config: ResearchTrendsConfig) {
    this.dir = resolve(ROOT, config.cacheDir);
    this.enabled = config.cacheEnabled;
    this.ttlMs = config.cacheTtlMinutes * 60_000;
  }

  get<T>(key: string): T | null {
    if (!this.enabled) return null;
    const file = join(this.dir, `${key}.json`);
    if (!existsSync(file)) return null;
    try {
      const entry = JSON.parse(readFileSync(file, 'utf-8')) as { ts: number; data: T };
      if (Date.now() - entry.ts > this.ttlMs) return null;
      return entry.data;
    } catch {
      return null;
    }
  }

  set<T>(key: string, data: T): void {
    if (!this.enabled) return;
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(
        join(this.dir, `${key}.json`),
        JSON.stringify({ ts: Date.now(), data }),
        'utf-8',
      );
    } catch {
      /* non-fatal */
    }
  }
}

// ─── HTTP client ──────────────────────────────────────────────────────────────

export interface HttpResult {
  status: number;
  ok: boolean;
  text: string;
  json(): unknown;
}

class HttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

async function httpGet(
  url: string,
  config: ResearchTrendsConfig,
  headers: Record<string, string> = {},
): Promise<HttpResult> {
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt <= config.maxRetries) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; gentle-vanguard/1.0)', ...headers },
        signal: controller.signal,
      });
      clearTimeout(timer);
      const text = await resp.text();
      if (!resp.ok && resp.status >= 500 && attempt < config.maxRetries) {
        attempt++;
        await sleep(config.retryDelayMs * 2 ** (attempt - 1));
        continue;
      }
      return { status: resp.status, ok: resp.ok, text, json: () => JSON.parse(text) };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < config.maxRetries) {
        attempt++;
        await sleep(config.retryDelayMs * 2 ** (attempt - 1));
        continue;
      }
      throw new HttpError(lastError.message, 0);
    }
  }
  throw lastError ?? new HttpError('HTTP request failed', 0);
}

// ─── Source fetchers ──────────────────────────────────────────────────────────

interface RawTrendInput {
  id: string;
  title: string;
  url: string;
  description?: string;
  engagement: Engagement;
  tags: string[];
  createdAt: string | number;
}

function normalizeTrend(source: TrendSource, raw: RawTrendInput, fetchedAt: Date): Trend {
  return {
    id: makeId(source, raw.id),
    source,
    title: raw.title,
    url: raw.url,
    description: raw.description ?? '',
    engagement: raw.engagement,
    tags: raw.tags,
    createdAt: new Date(raw.createdAt),
    fetchedAt,
  };
}

async function fetchGithub(config: ResearchTrendsConfig, timeframe: Timeframe): Promise<Trend[]> {
  const src = config.sources.github as {
    enabled: boolean;
    apiUrl?: string;
    tokenEnv?: string;
    sort?: string;
    order?: string;
    perPage?: number;
    minStars?: number;
  };
  const fetchedAt = new Date();
  const since = new Date(Date.now() - timeframeToMs(timeframe)).toISOString().slice(0, 10);
  const token = (src.tokenEnv && process.env[src.tokenEnv]) || '';
  const apiUrl = src.apiUrl ?? 'https://api.github.com/search/repositories';
  const perPage = src.perPage ?? 25;
  const minStars = src.minStars ?? 50;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const url = `${apiUrl}?q=created:>${since}&sort=${src.sort ?? 'stars'}&order=${
    src.order ?? 'desc'
  }&per_page=${perPage}`;
  const res = await httpGet(url, config, headers);
  if (!res.ok) throw new HttpError(`GitHub search failed (${res.status})`, res.status);

  const body = res.json() as {
    items?: Array<{
      full_name: string;
      html_url: string;
      description?: string;
      stargazers_count: number;
      topics?: string[];
      created_at: string;
      language?: string;
    }>;
  };
  return (body.items ?? [])
    .filter((item) => item && item.full_name && item.stargazers_count >= minStars)
    .map((item) =>
      normalizeTrend(
        'github',
        {
          id: item.full_name,
          title: item.full_name,
          url: item.html_url,
          description: item.description ?? '',
          engagement: { stars: item.stargazers_count },
          tags: [...(item.topics ?? []), ...(item.language ? [item.language.toLowerCase()] : [])],
          createdAt: item.created_at,
        },
        fetchedAt,
      ),
    );
}

/** Scrape github.com/trending for repos gaining stars today (velocity signal). */
async function scrapeGithubTrending(config: ResearchTrendsConfig): Promise<TrendingPage[]> {
  const url = 'https://github.com/trending';
  const fetchedAt = new Date();
  const res = await httpGet(url, config, {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });
  if (!res.ok) throw new HttpError(`GitHub trending failed (${res.status})`, res.status);

  const articles = res.text.match(/<article[\s\S]*?<\/article>/g) ?? [];
  const pages: TrendingPage[] = [];

  for (const art of articles) {
    const hrefM = art.match(/href="\/([\w.-]+\/[\w.-]+)"/);
    if (!hrefM) continue;
    const fullName = hrefM[1];
    const title = art.match(/<h2[\s\S]*?<\/h2>/) ?? '';
    const descM = art.match(/<p[^>]*class="col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const description = descM
      ? descM[1]
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ')
          .trim()
      : '';
    const langM = art.match(/programmingLanguage":"([^"]+)"/);
    const todayM = art.match(/([\d,.]+)\s+stars? today/);
    const starsM = art.match(/aria-label="([\d,.]+)\s+users? starred/);

    pages.push({
      url: `https://github.com/${fullName}`,
      title: title.length ? fullName : fullName,
      description,
      starsToday: todayM ? parseFloat(todayM[1].replace(/,/g, '')) : undefined,
      stars: starsM ? parseFloat(starsM[1].replace(/,/g, '')) : undefined,
      language: langM ? langM[1] : undefined,
    });
  }
  return pages.map((p) => ({ ...p, fetchedAt }));
}

async function fetchHackerNews(
  config: ResearchTrendsConfig,
  timeframe: Timeframe,
): Promise<Trend[]> {
  const src = config.sources.hackernews as {
    enabled: boolean;
    apiUrl?: string;
    hitsPerPage?: number;
    minPoints?: number;
    tags?: string;
  };
  const fetchedAt = new Date();
  const since = Math.floor((Date.now() - timeframeToMs(timeframe)) / 1000);
  const apiUrl = src.apiUrl ?? 'https://hn.algolia.com/api/v1/search_by_date';
  const hitsPerPage = src.hitsPerPage ?? 50;
  const minPoints = src.minPoints ?? 5;
  const tags = src.tags ?? 'story';

  const url =
    `${apiUrl}?tags=${encodeURIComponent(tags)}&hitsPerPage=${hitsPerPage}` +
    `&numericFilters=${encodeURIComponent(`points>${minPoints},created_at_i>${since}`)}`;
  const res = await httpGet(url, config);
  if (!res.ok) throw new HttpError(`Hacker News failed (${res.status})`, res.status);

  const body = res.json() as {
    hits?: Array<{
      objectID: string;
      title?: string;
      url?: string;
      points?: number;
      num_comments?: number;
      created_at: string;
      _tags?: string[];
    }>;
  };
  return (body.hits ?? [])
    .filter((h) => h && h.title && h.objectID)
    .map((h) =>
      normalizeTrend(
        'hackernews',
        {
          id: h.objectID,
          title: h.title ?? '',
          url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
          description: '',
          engagement: {
            upvotes: h.points ?? 0,
            comments: h.num_comments ?? 0,
          },
          tags: (h._tags ?? [])
            .filter((t) => !t.startsWith('story') && !t.startsWith('author'))
            .map((t) => t.replace(/^story_/, ''))
            .filter(Boolean),
          createdAt: h.created_at,
        },
        fetchedAt,
      ),
    );
}

async function fetchStackOverflow(
  config: ResearchTrendsConfig,
  timeframe: Timeframe,
): Promise<Trend[]> {
  const src = config.sources.stackoverflow as {
    enabled: boolean;
    apiUrl?: string;
    site?: string;
    pageSize?: number;
    tagsPageSize?: number;
    minScore?: number;
  };
  const fetchedAt = new Date();
  const apiUrl = src.apiUrl ?? 'https://api.stackexchange.com/2.3';
  const site = src.site ?? 'stackoverflow';
  const pageSize = src.pageSize ?? 20;
  const tagsPageSize = src.tagsPageSize ?? 10;
  const since = Math.floor((Date.now() - timeframeToMs(timeframe)) / 1000);

  const qUrl =
    `${apiUrl}/questions?order=desc&sort=hot&site=${site}&pagesize=${pageSize}` +
    `&fromdate=${since}`;
  const qRes = await httpGet(qUrl, config);
  const trends: Trend[] = [];
  if (qRes.ok) {
    const body = qRes.json() as {
      items?: Array<{
        question_id: number;
        title: string;
        link: string;
        score: number;
        view_count: number;
        answer_count: number;
        tags: string[];
        creation_date: number;
      }>;
    };
    const minScore = src.minScore ?? 0;
    for (const q of body.items ?? []) {
      if (!q || !q.question_id) continue;
      if (q.score < minScore) continue;
      trends.push(
        normalizeTrend(
          'stackoverflow',
          {
            id: `q:${q.question_id}`,
            title: q.title,
            url: q.link,
            description: '',
            engagement: {
              upvotes: q.score,
              views: q.view_count,
              comments: q.answer_count,
            },
            tags: q.tags ?? [],
            createdAt: q.creation_date,
          },
          fetchedAt,
        ),
      );
    }
  }

  const tUrl = `${apiUrl}/tags?order=desc&sort=popular&site=${site}&pagesize=${tagsPageSize}`;
  const tRes = await httpGet(tUrl, config);
  if (tRes.ok) {
    const body = tRes.json() as {
      items?: Array<{ name: string; count: number; has_synonyms?: boolean }>;
    };
    for (const t of body.items ?? []) {
      if (!t || !t.name) continue;
      trends.push(
        normalizeTrend(
          'stackoverflow',
          {
            id: `tag:${t.name}`,
            title: `#${t.name} tag on Stack Overflow`,
            url: `https://stackoverflow.com/questions/tagged/${encodeURIComponent(t.name)}`,
            description: `Popular tag tracked on Stack Overflow (${t.count.toLocaleString()} questions).`,
            engagement: { views: t.count },
            tags: [t.name],
            createdAt: new Date().toISOString(),
          },
          fetchedAt,
        ),
      );
    }
  }
  return trends;
}

async function fetchDevTo(config: ResearchTrendsConfig, _timeframe: Timeframe): Promise<Trend[]> {
  const src = config.sources.devto as {
    enabled: boolean;
    apiUrl?: string;
    top?: number;
    perPage?: number;
  };
  const fetchedAt = new Date();
  const apiUrl = src.apiUrl ?? 'https://dev.to/api';
  const top = src.top ?? 7;
  const perPage = src.perPage ?? 30;

  const url = `${apiUrl}/articles?top=${top}&per_page=${perPage}`;
  const res = await httpGet(url, config);
  if (!res.ok) throw new HttpError(`Dev.to failed (${res.status})`, res.status);

  const body = res.json() as Array<{
    id: number;
    title: string;
    url: string;
    description?: string;
    tag_list: string[];
    public_reactions_count: number;
    comments_count: number;
    published_at: string;
  }>;
  return (Array.isArray(body) ? body : [])
    .filter((a) => a && a.title && a.id)
    .map((a) =>
      normalizeTrend(
        'devto',
        {
          id: `article:${a.id}`,
          title: a.title,
          url: a.url,
          description: a.description ?? '',
          engagement: {
            upvotes: a.public_reactions_count ?? 0,
            comments: a.comments_count ?? 0,
          },
          tags: a.tag_list ?? [],
          createdAt: a.published_at,
        },
        fetchedAt,
      ),
    );
}

async function fetchReddit(config: ResearchTrendsConfig, timeframe: Timeframe): Promise<Trend[]> {
  const src = config.sources.reddit as {
    enabled: boolean;
    apiUrl?: string;
    subreddits?: string[];
    limit?: number;
    time?: string;
    userAgent?: string;
  };
  const fetchedAt = new Date();
  const apiUrl = src.apiUrl ?? 'https://www.reddit.com';
  const subreddits = src.subreddits ?? ['programming'];
  const limit = src.limit ?? 25;
  const time = src.time ?? timeframeToReddit(timeframe);
  const userAgent = src.userAgent ?? 'gentle-vanguard-trends/1.0 (research aggregation)';
  const trends: Trend[] = [];

  for (const sub of subreddits) {
    const jsonUrl = `${apiUrl}/r/${sub}/top.json?t=${time}&limit=${limit}`;
    const res = await httpGet(jsonUrl, config, { 'User-Agent': userAgent });
    if (res.ok && res.status === 200) {
      const body = res.json() as {
        data?: { children?: Array<{ data: RedditPost }> };
      };
      for (const child of body.data?.children ?? []) {
        const p = child.data;
        if (!p || !p.id || !p.title) continue;
        trends.push(
          normalizeTrend(
            'reddit',
            {
              id: `${sub}:${p.id}`,
              title: p.title,
              url:
                p.url && p.url.startsWith('http')
                  ? p.url
                  : `https://www.reddit.com${p.permalink ?? ''}`,
              description: p.selftext ? p.selftext.slice(0, 300) : '',
              engagement: { upvotes: p.score, comments: p.num_comments },
              tags: [sub],
              createdAt: p.created_utc ?? Math.floor(Date.now() / 1000),
            },
            fetchedAt,
          ),
        );
      }
    } else {
      // Fallback to RSS (Reddit often blocks JSON without OAuth)
      const rssUrl = `${apiUrl}/r/${sub}/top/.rss?t=${time}`;
      const rssRes = await httpGet(rssUrl, config, {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      });
      if (rssRes.ok) {
        const entries = parseRedditRss(rssRes.text);
        for (const e of entries.slice(0, limit)) {
          trends.push(
            normalizeTrend(
              'reddit',
              {
                id: `${sub}:${e.id}`,
                title: e.title,
                url: e.link,
                description: '',
                engagement: {},
                tags: [sub],
                createdAt: e.published,
              },
              fetchedAt,
            ),
          );
        }
      }
    }
  }
  return trends;
}

interface RedditPost {
  id: string;
  title?: string;
  url?: string;
  permalink?: string;
  selftext?: string;
  score?: number;
  num_comments?: number;
  created_utc?: number;
}

interface RssEntry {
  id: string;
  title: string;
  link: string;
  published: string;
}

function parseRedditRss(xml: string): RssEntry[] {
  const entries: RssEntry[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(xml)) !== null) {
    const block = m[1];
    const titleM = block.match(/<title>([^<]*)<\/title>/);
    const linkM = block.match(/<link href="([^"]+)"/);
    const idM = block.match(/<id>(t3_[^<]+)<\/id>/);
    const pubM = block.match(/<published>([^<]+)<\/published>/);
    if (!titleM || !linkM) continue;
    entries.push({
      id: idM ? idM[1] : titleM[1],
      title: titleM[1],
      link: linkM[1],
      published: pubM ? pubM[1] : new Date().toISOString(),
    });
  }
  return entries;
}

// ─── Firecrawl integration ────────────────────────────────────────────────────

async function importWebCrawler(): Promise<WebCrawlerModule | null> {
  try {
    const mod = await import('./web-crawler.js');
    return mod as WebCrawlerModule;
  } catch {
    return null;
  }
}

interface WebCrawlerModule {
  createWebCrawler: (config?: unknown) => WebCrawlerInstance;
}

interface WebCrawlerInstance {
  isConfigured(): boolean;
  scrape(url: string): Promise<{ markdown?: string }>;
}

/**
 * Scrape a trending page via the Firecrawl-backed web crawler when configured.
 * Falls back to direct HTTP fetch if the crawler is unavailable/unconfigured.
 */
export async function scrapeTrendingPages(config?: ResearchTrendsConfig): Promise<TrendingPage[]> {
  const cfg = config ?? loadConfig();
  if (!cfg.firecrawl.enabled || !cfg.firecrawl.scrapeTrendingPages) return [];

  const pages: TrendingPage[] = [];
  for (const url of cfg.firecrawl.trendingPages ?? []) {
    const mod = await importWebCrawler();
    let scraped: string | null = null;
    if (mod) {
      try {
        const client = mod.createWebCrawler();
        if (client.isConfigured()) {
          const result = await client.scrape(url);
          scraped = result.markdown ?? null;
        }
      } catch {
        scraped = null;
      }
    }
    if (scraped) {
      pages.push(...parseTrendingMarkdown(scraped, url));
    } else if (url.includes('github.com')) {
      pages.push(...(await scrapeGithubTrending(cfg)));
    }
  }
  return pages;
}

function parseTrendingMarkdown(md: string, baseUrl: string): TrendingPage[] {
  const pages: TrendingPage[] = [];
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const linkM = line.match(/\[([\w.-]+\/[\w.-]+)\]\(https:\/\/github\.com\/\1\)/);
    if (linkM) {
      const fullName = linkM[1];
      const desc = lines[i + 1]?.trim() ?? '';
      const pagesStart = i + 2;
      let starsToday: number | undefined;
      for (let j = pagesStart; j < Math.min(lines.length, i + 8); j++) {
        const todayM = lines[j].match(/([\d,.]+)\s+stars? today/);
        if (todayM) {
          starsToday = parseFloat(todayM[1].replace(/,/g, ''));
          break;
        }
      }
      pages.push({
        url: `https://github.com/${fullName}`,
        title: fullName,
        description: desc,
        starsToday,
      });
      i += 3;
      continue;
    }
    i++;
  }
  return pages.length ? pages : [{ url: baseUrl, title: baseUrl, description: '' }];
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

function engagementScore(t: Trend): number {
  const e = t.engagement;
  return (e.stars ?? 0) + (e.upvotes ?? 0) * 3 + (e.comments ?? 0) * 2 + (e.views ?? 0) / 100;
}

function dedupeTrends(trends: Trend[]): Trend[] {
  const seen = new Set<string>();
  const out: Trend[] = [];
  for (const t of trends) {
    if (!seen.has(t.id)) {
      seen.add(t.id);
      out.push(t);
    }
  }
  return out;
}

function buildThemes(
  trends: Trend[],
  config: ResearchTrendsConfig,
): { tag: string; count: number; trends: Trend[] }[] {
  const byTag = new Map<string, Trend[]>();
  for (const t of trends) {
    const tags = t.tags.length ? t.tags : [t.source];
    for (const tag of tags) {
      const key = tag.toLowerCase().trim();
      if (!key) continue;
      const arr = byTag.get(key) ?? [];
      if (!arr.some((x) => x.id === t.id)) arr.push(t);
      byTag.set(key, arr);
    }
  }
  const maxPerTheme = config.theme.maxTrendsPerTheme;
  const themes = [...byTag.entries()]
    .map(([tag, arr]) => ({
      tag,
      count: arr.length,
      trends: arr.slice(0, maxPerTheme),
    }))
    .sort(
      (a, b) => b.count - a.count || engagementScore(b.trends[0]) - engagementScore(a.trends[0]),
    )
    .slice(0, config.theme.maxThemes);
  return themes;
}

function computeEmerging(trends: Trend[], config: ResearchTrendsConfig, hottest: Trend[]): Trend[] {
  const hottestIds = new Set(hottest.map((t) => t.id));
  const now = Date.now();
  const scored = trends
    .filter((t) => !hottestIds.has(t.id))
    .map((t) => {
      const ageMs = Math.max(now - t.createdAt.getTime(), 60 * 60 * 1000);
      return { t, velocity: engagementScore(t) / (ageMs / (60 * 60 * 1000)) };
    })
    .sort((a, b) => b.velocity - a.velocity);
  return scored.slice(0, config.emergingCount).map((s) => s.t);
}

export async function buildReport(
  trends: Trend[],
  timeframe: Timeframe,
  config: ResearchTrendsConfig,
): Promise<TrendReport> {
  const unique = dedupeTrends(trends);
  const sorted = [...unique].sort((a, b) => engagementScore(b) - engagementScore(a));
  const hottest = sorted.slice(0, config.hottestCount);
  const emerging = computeEmerging(sorted, config, hottest);
  const themes = buildThemes(unique, config);
  return {
    timeframe,
    timestamp: new Date().toISOString(),
    themes,
    hottest,
    emerging,
  };
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function serializeReport(report: TrendReport): unknown {
  return {
    timeframe: report.timeframe,
    timestamp: report.timestamp,
    themes: report.themes.map((th) => ({
      tag: th.tag,
      count: th.count,
      trends: th.trends.map(serializeTrend),
    })),
    hottest: report.hottest.map(serializeTrend),
    emerging: report.emerging.map(serializeTrend),
  };
}

function serializeTrend(t: Trend): Record<string, unknown> {
  return {
    id: t.id,
    source: t.source,
    title: t.title,
    url: t.url,
    description: t.description,
    engagement: t.engagement,
    tags: t.tags,
    createdAt: t.createdAt.toISOString(),
    fetchedAt: t.fetchedAt.toISOString(),
  };
}

export function deserializeReport(data: unknown): TrendReport {
  const parsed = TrendReportSchema.parse(data);
  return {
    timeframe: parsed.timeframe,
    timestamp: parsed.timestamp,
    themes: parsed.themes.map((th) => ({
      tag: th.tag,
      count: th.count,
      trends: th.trends.map(deserializeTrend),
    })),
    hottest: parsed.hottest.map(deserializeTrend),
    emerging: parsed.emerging.map(deserializeTrend),
  };
}

function deserializeTrend(t: z.infer<typeof TrendSchema>): Trend {
  return {
    id: t.id,
    source: t.source,
    title: t.title,
    url: t.url,
    description: t.description,
    engagement: t.engagement,
    tags: t.tags,
    createdAt: new Date(t.createdAt),
    fetchedAt: new Date(t.fetchedAt),
  };
}

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
      console.warn(`[research-trends] ${source} source failed: ${(e as Error).message}`);
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
      console.warn(`[research-trends] Firecrawl trending scrape failed: ${(e as Error).message}`);
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

function cacheKeyFn(op: string, ...parts: unknown[]): string {
  return cacheKey(op, ...parts);
}

// ─── Querying ─────────────────────────────────────────────────────────────────

export interface ThemeQueryResult {
  report: TrendReport;
  matchedThemes: { tag: string; count: number; trends: Trend[] }[];
  matchedTrends: Trend[];
}

/**
 * Filter a report by a tag/query. Supports simple boolean OR (e.g.
 * "typescript OR rust") and comma-separated tags. Matches theme tags and
 * trend tags/titles.
 */
export function queryThemes(report: TrendReport, query: string): ThemeQueryResult {
  const q = query.trim().toLowerCase();
  const terms = q
    .split(/\s+OR\s+|,|\|/i)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const matchedThemes = report.themes.filter((th) =>
    terms.some((term) => th.tag.includes(term) || term.includes(th.tag)),
  );

  const matchedTrends = report.hottest
    .concat(report.emerging)
    .filter((t) =>
      terms.some(
        (term) =>
          t.tags.some((tag) => tag.toLowerCase().includes(term)) ||
          t.title.toLowerCase().includes(term),
      ),
    );

  return { report, matchedThemes, matchedTrends };
}

// ─── Markdown rendering ───────────────────────────────────────────────────────

export function renderMarkdown(report: TrendReport): string {
  const lines: string[] = [];
  lines.push(`# Last30Days Trend Report — ${report.timeframe}`);
  lines.push('');
  lines.push(`Generated: ${report.timestamp}`);
  lines.push('');
  lines.push(`**Trends collected:** ${report.hottest.length + report.emerging.length} featured`);
  lines.push('');
  lines.push('## Hottest');
  lines.push('');
  report.hottest.forEach((t, i) => {
    const eng = formatEngagement(t);
    lines.push(`${i + 1}. **${t.title}** (${t.source})${eng ? ` — ${eng}` : ''}`);
    lines.push(`   ${t.url}`);
    if (t.description) lines.push(`   ${t.description.slice(0, 200)}`);
    if (t.tags.length)
      lines.push(
        `   Tags: ${t.tags
          .slice(0, 6)
          .map((x) => `\`${x}\``)
          .join(' ')}`,
      );
    lines.push('');
  });
  lines.push('## Emerging');
  lines.push('');
  report.emerging.forEach((t, i) => {
    lines.push(`${i + 1}. **${t.title}** (${t.source}) — ${formatEngagement(t) || 'new'}`);
    lines.push(`   ${t.url}`);
    lines.push('');
  });
  lines.push('## Themes');
  lines.push('');
  report.themes.forEach((th, i) => {
    lines.push(`${i + 1}. **#${th.tag}** — ${th.count} ${th.count === 1 ? 'trend' : 'trends'}`);
    for (const t of th.trends.slice(0, 5)) {
      lines.push(`   - ${t.title} (${t.source})`);
    }
    lines.push('');
  });
  return lines.join('\n');
}

export function formatEngagement(t: Trend): string {
  const parts: string[] = [];
  if (t.engagement.stars !== undefined) parts.push(`${t.engagement.stars.toLocaleString()}★`);
  if (t.engagement.upvotes !== undefined) parts.push(`${t.engagement.upvotes.toLocaleString()}▲`);
  if (t.engagement.comments !== undefined) parts.push(`${t.engagement.comments}💬`);
  if (t.engagement.views !== undefined) parts.push(`${t.engagement.views.toLocaleString()}👁`);
  return parts.join(' · ');
}

// ─── Direct execution guard (library mode) ────────────────────────────────────

export const CONFIG_PATH_EXPORT = CONFIG_PATH;
export const RESEARCH_TRENDS_VERSION = '1.0.0';
