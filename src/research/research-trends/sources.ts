import { loadConfig, timeframeToMs, timeframeToReddit } from './config.js';
import { httpGet, HttpError, makeId } from './http.js';
import type {
  Engagement,
  ResearchTrendsConfig,
  Timeframe,
  Trend,
  TrendSource,
  TrendingPage,
} from './schemas.js';

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

export function normalizeTrend(source: TrendSource, raw: RawTrendInput, fetchedAt: Date): Trend {
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

export async function fetchGithub(
  config: ResearchTrendsConfig,
  timeframe: Timeframe,
): Promise<Trend[]> {
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

export async function fetchHackerNews(
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

export async function fetchStackOverflow(
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

export async function fetchDevTo(
  config: ResearchTrendsConfig,
  _timeframe: Timeframe,
): Promise<Trend[]> {
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

export async function fetchReddit(
  config: ResearchTrendsConfig,
  timeframe: Timeframe,
): Promise<Trend[]> {
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
    const mod = await import('../../web/web-crawler.js');
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
