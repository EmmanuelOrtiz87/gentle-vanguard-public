#!/usr/bin/env node
/**
 * Web Crawler — native web-content acquisition engine.
 *
 * Dual-provider design:
 *   PRIMARY:  Firecrawl (firecrawl.dev) — full API when FIRECRAWL_API_KEY is set
 *   FALLBACK: Jina Reader (r.jina.ai) + Bing HTML (search) — zero-config, no API
 *             key required. Activated automatically when no Firecrawl key exists
 *             (config fallbackEnabled: true, default).
 *
 * Transforms web content into LLM-ready format (clean markdown, structured
 * JSON) with a type-safe client, automatic retries with exponential backoff
 * on rate limits, SHA256 disk cache, token compression for large pages and
 * Nexus usage logging for cost tracking.
 *
 * Usage:
 *   npx tsx src/web/web-crawler-cli.ts search --query "firecrawl api"
 *   npx tsx src/web/web-crawler-cli.ts scrape --url https://example.com
 *   npx tsx src/web/web-crawler-cli.ts crawl --url https://example.com --limit 5
 *   npx tsx src/web/web-crawler-cli.ts map --url https://example.com
 *   npx tsx src/web/web-crawler-cli.ts health
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { z } from 'zod';
import { compressStructural } from '../compression/structural-compression.js';
import { loadConfigFile } from '../core/config-loader.js';
// Note: .js extension is used for ESM compatibility; TypeScript resolves .ts files
import { db as getDb } from '../database/db.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FirecrawlFormat = 'markdown' | 'html' | 'json' | 'screenshot';

export interface WaitAction {
  type: 'wait';
  milliseconds?: number;
}
export interface ClickAction {
  type: 'click';
  selector: string;
}
export interface ScrollAction {
  type: 'scroll';
  direction?: 'up' | 'down';
}
export interface ScreenshotAction {
  type: 'screenshot';
  fullPage?: boolean;
}
export interface ScrapeAction {
  type: 'scrape';
}
export type Action = WaitAction | ClickAction | ScrollAction | ScreenshotAction | ScrapeAction;

export interface ScrapeOptions {
  formats?: FirecrawlFormat[];
  includeTags?: string[];
  excludeTags?: string[];
  actions?: Action[];
  onlyMainContent?: boolean;
  waitFor?: number;
  timeout?: number;
  maxDepth?: number;
  ignoreSitemap?: boolean;
}

export interface SearchResult {
  url: string;
  title: string;
  description?: string;
  markdown?: string;
  metadata?: Record<string, unknown>;
  content?: string;
}

export interface ScrapedContent {
  url: string;
  markdown?: string;
  html?: string;
  json?: Record<string, unknown>;
  screenshot?: string;
  metadata?: Record<string, unknown>;
  /** Token stats after compression, when enabled. */
  originalTokens?: number;
  compressedTokens?: number;
  tokenSavings?: number;
  compressed?: boolean;
}

export interface CrawlOptions {
  limit?: number;
  maxDepth?: number;
  formats?: FirecrawlFormat[];
  onlyMainContent?: boolean;
  includePaths?: string[];
  excludePaths?: string[];
  ignoreSitemap?: boolean;
}

export interface CrawlResult {
  id: string;
  url: string;
  status: 'completed' | 'crawling' | 'scraping' | 'cancelled' | 'failed' | 'unknown';
  total?: number;
  completed?: number;
  creditsUsed?: number;
  data?: ScrapedContent[];
}

export interface MapResult {
  url: string;
  links: string[];
}

export interface WebCrawler {
  search(query: string, limit?: number): Promise<SearchResult[]>;
  scrape(url: string, options?: ScrapeOptions): Promise<ScrapedContent>;
  crawl(url: string, options?: CrawlOptions): Promise<CrawlResult>;
  map(url: string): Promise<MapResult>;
}

export interface HealthResult {
  status: 'ok' | 'degraded' | 'unconfigured';
  apiKeyConfigured: boolean;
  fallbackActive: boolean;
  provider: 'firecrawl' | 'jina-reader+ddg+bing' | 'none';
  configFile: boolean;
  cacheDir: boolean;
  enabled: boolean;
  detail: string;
}

// ─── Error type ───────────────────────────────────────────────────────────────

export class FirecrawlError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'FirecrawlError';
    this.status = status;
  }
}

// ─── Config (Zod schema) ─────────────────────────────────────────────────────

const ScrapeDefaultsSchema = z
  .object({
    formats: z.array(z.enum(['markdown', 'html', 'json', 'screenshot'])).optional(),
    onlyMainContent: z.boolean().optional(),
    waitForMs: z.number().int().nonnegative().optional(),
    maxDepth: z.number().int().nonnegative().optional(),
    ignoreSitemap: z.boolean().optional(),
    actions: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .default({});

const WebCrawlerConfigSchema = z
  .object({
    version: z.string().default('1.0.0'),
    name: z.string().default('web-crawler-config'),
    description: z.string().default(''),
    enabled: z.boolean().default(true),
    apiKey: z.string().default(''),
    baseUrl: z.string().url().default('https://api.firecrawl.dev/v1'),
    fallbackEnabled: z.boolean().default(true),
    jinaReaderUrl: z.string().url().default('https://r.jina.ai'),
    bingSearchUrl: z.string().url().default('https://www.bing.com/search'),
    ddgSearchUrl: z.string().url().default('https://html.duckduckgo.com/html/'),
    timeoutMs: z.number().int().positive().default(30000),
    maxRetries: z.number().int().min(0).default(3),
    retryDelayMs: z.number().int().positive().default(1000),
    maxBackoffMs: z.number().int().positive().default(30000),
    rateLimitPerMinute: z.number().int().positive().default(20),
    cacheEnabled: z.boolean().default(true),
    cacheTtlMinutes: z.number().int().positive().default(1440),
    cacheDir: z.string().default('.session/response-cache/firecrawl'),
    compressContent: z.boolean().default(true),
    maxContentChars: z.number().int().positive().default(100000),
    logUsageToNexus: z.boolean().default(true),
    search: z
      .object({
        limit: z.number().int().nonnegative().default(5),
        fetchFullContent: z.boolean().default(true),
        onlyMainContent: z.boolean().default(true),
        formats: z.array(z.enum(['markdown', 'html', 'json', 'screenshot'])).default(['markdown']),
      })
      .partial()
      .default({}),
    scrape: ScrapeDefaultsSchema,
    crawl: z
      .object({
        limit: z.number().int().nonnegative().default(10),
        maxPages: z.number().int().nonnegative().default(10),
        formats: z.array(z.enum(['markdown', 'html', 'json', 'screenshot'])).default(['markdown']),
        onlyMainContent: z.boolean().default(true),
        pollIntervalMs: z.number().int().positive().default(5000),
        pollTimeoutMs: z.number().int().positive().default(300000),
      })
      .partial()
      .default({}),
    map: z
      .object({
        limit: z.number().int().positive().default(100),
      })
      .partial()
      .default({}),
    health: z
      .object({
        checkIntervalHours: z.number().int().positive().default(24),
        lastCheckFile: z.string().default('.runtime/web-crawler-health.json'),
      })
      .partial()
      .default({}),
  })
  .passthrough();

export type WebCrawlerConfig = z.infer<typeof WebCrawlerConfigSchema>;

// ─── Paths ────────────────────────────────────────────────────────────────────

const ROOT = resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd());
const CONFIG_PATH = join(ROOT, 'config', 'web-crawler.json');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolveFn) => setTimeout(resolveFn, ms));
}

/** Decode XML/HTML entities (&amp; &#250; &quot; etc.) into plain text. */
function decodeXml(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

/** Strip HTML tags from a fragment (for DDG snippet/title text). */
function stripTags(input: string): string {
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadConfig(): WebCrawlerConfig {
  const raw = loadConfigFile<Record<string, unknown>>('web-crawler', {
    dir: join(ROOT, 'config'),
    validate: false,
  }).data;
  const parsed = WebCrawlerConfigSchema.parse(raw);
  return { ...parsed, apiKey: parsed.apiKey || process.env.FIRECRAWL_API_KEY || '' };
}

// ─── WebCrawler client ────────────────────────────────────────────────────────

export class WebCrawlerClient implements WebCrawler {
  private readonly config: WebCrawlerConfig;
  private readonly cacheDir: string;
  private lastRequestTimes: number[] = [];

  constructor(config?: Partial<WebCrawlerConfig>) {
    this.config = { ...loadConfig(), ...config };
    this.config.apiKey = this.config.apiKey || process.env.FIRECRAWL_API_KEY || '';
    this.cacheDir = resolve(ROOT, this.config.cacheDir);
  }

  getConfig(): WebCrawlerConfig {
    return { ...this.config };
  }

  isConfigured(): boolean {
    return this.config.enabled && (this.config.apiKey.length > 0 || this.config.fallbackEnabled);
  }

  // ── Rate limiting (sliding window) ──────────────────────────────────────────

  private async throttle(): Promise<void> {
    const rate = this.config.rateLimitPerMinute;
    if (rate <= 0) return;
    const now = Date.now();
    this.lastRequestTimes = this.lastRequestTimes.filter((t) => now - t < 60_000);
    if (this.lastRequestTimes.length >= rate) {
      const oldest = this.lastRequestTimes[0];
      const waitMs = Math.max(0, 60_000 - (now - oldest) + 10);
      await sleep(waitMs);
    }
    this.lastRequestTimes.push(Date.now());
  }

  // ── Low-level request with exponential backoff ──────────────────────────────

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (!this.config.enabled) throw new FirecrawlError('Web crawler disabled in config');
    if (!this.config.apiKey) {
      throw new FirecrawlError(
        'Firecrawl API key missing — set FIRECRAWL_API_KEY env or apiKey in config/web-crawler.json',
      );
    }

    await this.throttle();

    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= this.config.maxRetries) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
        const resp = await fetch(`${this.config.baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (resp.status === 429) {
          throw new FirecrawlError('Firecrawl rate limit exceeded', 429);
        }
        if (resp.status >= 500) {
          throw new FirecrawlError(`Firecrawl server error ${resp.status}`, resp.status);
        }
        if (!resp.ok) {
          const text = await resp.text();
          throw new FirecrawlError(
            `Firecrawl ${resp.status}: ${text.slice(0, 300) || resp.statusText}`,
            resp.status,
          );
        }
        return (await resp.json()) as T;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (lastError.name === 'AbortError') {
          throw new FirecrawlError(`Firecrawl request timed out (${this.config.timeoutMs}ms)`);
        }
        const retryable =
          lastError instanceof FirecrawlError &&
          (lastError.status === 429 || (lastError.status !== undefined && lastError.status >= 500));
        if (retryable && attempt < this.config.maxRetries) {
          attempt++;
          const delay = Math.min(
            this.config.maxBackoffMs,
            this.config.retryDelayMs * 2 ** (attempt - 1),
          );
          await sleep(delay);
          continue;
        }
        throw lastError;
      }
    }
    throw lastError ?? new Error('Firecrawl request failed');
  }

  // ── Low-level plain GET (no auth — used by fallback providers) ─────────────

  private async requestPlain(url: string, headers?: Record<string, string>): Promise<string> {
    let attempt = 0;
    let lastError: Error | null = null;
    while (attempt <= this.config.maxRetries) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
        const resp = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
            ...headers,
          },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (resp.status === 429) {
          throw new FirecrawlError('Fallback provider rate limit exceeded', 429);
        }
        if (resp.status >= 500) {
          throw new FirecrawlError(`Fallback provider server error ${resp.status}`, resp.status);
        }
        if (!resp.ok) {
          throw new FirecrawlError(
            `Fallback provider ${resp.status}: ${resp.statusText}`,
            resp.status,
          );
        }
        return await resp.text();
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (lastError.name === 'AbortError') {
          throw new FirecrawlError(
            `Fallback provider request timed out (${this.config.timeoutMs}ms)`,
          );
        }
        const retryable =
          lastError instanceof FirecrawlError &&
          (lastError.status === 429 || (lastError.status !== undefined && lastError.status >= 500));
        if (retryable && attempt < this.config.maxRetries) {
          attempt++;
          const delay = Math.min(
            this.config.maxBackoffMs,
            this.config.retryDelayMs * 2 ** (attempt - 1),
          );
          await sleep(delay);
          continue;
        }
        throw lastError;
      }
    }
    throw lastError ?? new Error('Fallback provider request failed');
  }

  // ── Cache (SHA256 key → JSON file) ──────────────────────────────────────────

  private cacheKey(operation: string, ...parts: unknown[]): string {
    const raw = JSON.stringify([operation, ...parts]);
    return createHash('sha256').update(raw).digest('hex').slice(0, 32);
  }

  private cacheGet<T>(key: string): T | null {
    if (!this.config.cacheEnabled) return null;
    const file = join(this.cacheDir, `${key}.json`);
    if (!existsSync(file)) return null;
    try {
      const entry = JSON.parse(readFileSync(file, 'utf-8')) as { ts: number; data: T };
      const ttlMs = this.config.cacheTtlMinutes * 60_000;
      if (Date.now() - entry.ts > ttlMs) return null;
      return entry.data;
    } catch {
      return null;
    }
  }

  private cacheSet<T>(key: string, data: T): void {
    if (!this.config.cacheEnabled) return;
    try {
      mkdirSync(this.cacheDir, { recursive: true });
      const entry = { ts: Date.now(), data };
      writeFileSync(join(this.cacheDir, `${key}.json`), JSON.stringify(entry), 'utf-8');
    } catch {
      /* non-fatal */
    }
  }

  // ── Token compression for large pages ───────────────────────────────────────

  private compressMarkdown(markdown: string): {
    content: string;
    originalTokens: number;
    compressedTokens: number;
    tokenSavings: number;
    compressed: boolean;
  } {
    const maxChars = this.config.maxContentChars;
    let content = markdown;
    if (maxChars > 0 && content.length > maxChars) {
      content = content.slice(0, maxChars);
    }
    const result = compressStructural(content, { mode: 'input' });
    return {
      content: result.compressed,
      originalTokens: result.originalTokens,
      compressedTokens: result.compressedTokens,
      tokenSavings: result.tokenSavings,
      compressed: result.tokenSavings > 0,
    };
  }

  // ── Nexus usage logging (non-blocking) ──────────────────────────────────────

  private logUsage(operation: string, url: string, tokens: number): void {
    if (!this.config.logUsageToNexus) return;
    try {
      const mgr = getDb();
      const payload = JSON.stringify({
        operation,
        url,
        tokens,
        cost: 0,
        source: 'web-crawler',
        timestamp: new Date().toISOString(),
      });
      mgr
        .getDb()
        .prepare('INSERT INTO events (type, payload) VALUES (?, ?)')
        .run('web-crawler.usage', payload);
    } catch {
      /* non-blocking — never break the crawl for telemetry */
    }
  }

  // ── Fallback provider: Jina Reader (r.jina.ai) ─────────────────────────────
  // Zero-config markdown extraction. No API key required (free tier).
  // NOTE: Jina blocks browser-style User-Agents (Chrome → 403). curl-style UAs work.

  private isFallbackActive(): boolean {
    return this.config.fallbackEnabled && this.config.apiKey.length === 0;
  }

  private async jinaScrape(url: string): Promise<ScrapedContent> {
    if (!this.config.enabled) throw new FirecrawlError('Web crawler disabled in config');
    await this.throttle();
    const text = await this.requestPlain(`${this.config.jinaReaderUrl}/${url}`, {
      Accept: 'text/markdown, text/plain;q=0.9',
      'User-Agent': 'curl/8.0.1',
    });
    const result: ScrapedContent = {
      url,
      markdown: text,
      metadata: { provider: 'jina-reader', fallback: true },
    };
    if (result.markdown && this.config.compressContent) {
      const compressed = this.compressMarkdown(result.markdown);
      result.markdown = compressed.content;
      result.originalTokens = compressed.originalTokens;
      result.compressedTokens = compressed.compressedTokens;
      result.tokenSavings = compressed.tokenSavings;
      result.compressed = compressed.compressed;
    }
    return result;
  }

  // ── Fallback provider: Bing RSS search (no API key) ────────────────────────
  // Uses the RSS endpoint (format=rss) which returns clean XML and avoids the
  // bot-detection page that the HTML endpoint serves to scripted clients.

  private async bingSearch(query: string, limit: number): Promise<SearchResult[]> {
    if (!this.config.enabled) throw new FirecrawlError('Web crawler disabled in config');
    await this.throttle();
    const xml = await this.requestPlain(
      `${this.config.bingSearchUrl}?q=${encodeURIComponent(query)}&count=${limit + 2}&format=rss`,
    );
    const results: SearchResult[] = [];
    // Parse <item> blocks (RSS) — title, link, description.
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    for (const item of items) {
      const titleMatch = item.match(/<title>(.*?)<\/title>/);
      const linkMatch = item.match(/<link>(.*?)<\/link>/);
      const descMatch = item.match(/<description>(.*?)<\/description>/);
      if (!titleMatch || !linkMatch) continue;
      const title = decodeXml(titleMatch[1].trim());
      const link = decodeXml(linkMatch[1].trim());
      const description = descMatch
        ? decodeXml(descMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim())
        : undefined;
      if (link.startsWith('http') && title) {
        results.push({
          url: link,
          title,
          description,
          metadata: { provider: 'bing-rss' },
        });
      }
      if (results.length >= limit) break;
    }
    return results;
  }

  /**
   * DuckDuckGo HTML search — higher quality than Bing RSS for business
   * queries, still zero-config. Parses the classic HTML endpoint
   * (html.duckduckgo.com/html/) result blocks.
   *
   * DDG hrefs are redirects: //duckduckgo.com/l/?uddg=<encoded-url>&rut=...
   * We extract the real target from the `uddg` query param.
   */
  private async ddgSearch(query: string, limit: number): Promise<SearchResult[]> {
    if (!this.config.enabled) throw new FirecrawlError('Web crawler disabled in config');
    await this.throttle();
    const html = await this.requestPlain(
      `${this.config.ddgSearchUrl}?q=${encodeURIComponent(query)}`,
    );
    const results: SearchResult[] = [];
    // Each result is a <a rel="nofollow" class="result__a" href="...">Title</a>
    // followed by <a class="result__snippet" href="...">Description</a>.
    const anchors = html.match(/<a[^>]+class="result__a"[^>]*>[\s\S]*?<\/a>/g) ?? [];
    const snippets = html.match(/<a[^>]+class="result__snippet"[^>]*>[\s\S]*?<\/a>/g) ?? [];
    for (let i = 0; i < anchors.length; i++) {
      const hrefMatch = anchors[i].match(/href="([^"]+)"/);
      const titleMatch = anchors[i].match(/>([\s\S]*?)<\/a>/);
      if (!hrefMatch || !titleMatch) continue;
      const rawUrl = decodeXml(hrefMatch[1]);
      // Resolve DDG redirect -> real URL
      const uddg = rawUrl.match(/[?&]uddg=([^&]+)/);
      const url = uddg ? decodeURIComponent(uddg[1]) : rawUrl;
      const title = stripTags(decodeXml(titleMatch[1])).trim();
      if (!url.startsWith('http') || !title) continue;
      const snippet = snippets[i]
        ? stripTags(decodeXml(snippets[i].replace(/<a[^>]+>/, '').replace(/<\/a>/, ''))).trim()
        : undefined;
      results.push({
        url,
        title,
        description: snippet || undefined,
        metadata: { provider: 'ddg-html' },
      });
      if (results.length >= limit) break;
    }
    return results;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Search the web and fetch full page content for the top results. */
  async search(query: string, limit?: number): Promise<SearchResult[]> {
    const n = limit ?? this.config.search.limit ?? 5;
    const providerTag = this.isFallbackActive() ? 'fb' : 'fc';
    const cacheKey = this.cacheKey('search', query, n, providerTag);
    const cached = this.cacheGet<SearchResult[]>(cacheKey);
    if (cached) return cached;

    // Fallback: no Firecrawl API key → DuckDuckGo HTML first (better business
    // relevance than Bing RSS), then Bing RSS as second fallback (zero-config).
    if (this.isFallbackActive()) {
      try {
        const ddg = await this.ddgSearch(query, n);
        if (ddg.length > 0) {
          this.cacheSet(cacheKey, ddg);
          this.logUsage(
            'search:fallback',
            query,
            ddg.reduce((a, r) => a + (r.description?.length ?? 0), 0),
          );
          return ddg;
        }
      } catch {
        // fall through to Bing RSS
      }
      const results = await this.bingSearch(query, n);
      this.cacheSet(cacheKey, results);
      this.logUsage(
        'search:fallback',
        query,
        results.reduce((a, r) => a + (r.description?.length ?? 0), 0),
      );
      return results;
    }

    const body: Record<string, unknown> = {
      query,
      limit: n,
      origin: 'website',
    };
    if (this.config.search.fetchFullContent) {
      body.scrapeOptions = {
        formats: this.config.search.formats,
        onlyMainContent: this.config.search.onlyMainContent,
      };
    }

    const json = await this.request<{ success?: boolean; data?: SearchResult[] }>(
      'POST',
      '/search',
      body,
    );
    const results = (json.data ?? [])
      .filter((r) => r && typeof r.url === 'string')
      .map((r) => ({
        url: r.url,
        title: r.title ?? r.url,
        description: r.description,
        markdown: r.markdown ?? r.content,
        metadata: r.metadata,
      }));

    this.cacheSet(cacheKey, results);
    this.logUsage(
      'search',
      query,
      results.reduce((a, r) => a + (r.markdown?.length ?? 0), 0),
    );
    return results;
  }

  /** Convert any URL to markdown/HTML/JSON/screenshot. */
  async scrape(url: string, options: ScrapeOptions = {}): Promise<ScrapedContent> {
    const providerTag = this.isFallbackActive() ? 'fb' : 'fc';
    const cacheKey = this.cacheKey('scrape', url, options, providerTag);
    const cached = this.cacheGet<ScrapedContent>(cacheKey);
    if (cached) return cached;

    // Fallback: no Firecrawl API key → Jina Reader (zero-config markdown).
    if (this.isFallbackActive()) {
      const result = await this.jinaScrape(url);
      this.cacheSet(cacheKey, result);
      this.logUsage('scrape:fallback', url, result.originalTokens ?? result.markdown?.length ?? 0);
      return result;
    }

    const formats = options.formats ?? this.config.scrape.formats ?? ['markdown'];
    const body: Record<string, unknown> = {
      url,
      formats,
      onlyMainContent: options.onlyMainContent ?? this.config.scrape.onlyMainContent,
      waitFor: options.waitFor ?? this.config.scrape.waitForMs ?? 0,
      maxDepth: options.maxDepth ?? this.config.scrape.maxDepth ?? 0,
      ignoreSitemap: options.ignoreSitemap ?? this.config.scrape.ignoreSitemap ?? false,
    };
    if (options.includeTags?.length) body.includeTags = options.includeTags;
    if (options.excludeTags?.length) body.excludeTags = options.excludeTags;
    if (options.actions?.length) body.actions = options.actions;
    if (options.timeout) body.timeout = options.timeout;

    const json = await this.request<{
      success?: boolean;
      data?: {
        markdown?: string;
        html?: string;
        json?: Record<string, unknown>;
        screenshot?: string;
        metadata?: Record<string, unknown>;
      };
    }>('POST', '/scrape', body);

    const data = json.data ?? {};
    const result: ScrapedContent = {
      url,
      markdown: data.markdown,
      html: data.html,
      json: data.json,
      screenshot: data.screenshot,
      metadata: data.metadata,
    };

    if (result.markdown && this.config.compressContent) {
      const compressed = this.compressMarkdown(result.markdown);
      result.markdown = compressed.content;
      result.originalTokens = compressed.originalTokens;
      result.compressedTokens = compressed.compressedTokens;
      result.tokenSavings = compressed.tokenSavings;
      result.compressed = compressed.compressed;
    }

    this.cacheSet(cacheKey, result);
    this.logUsage('scrape', url, result.originalTokens ?? result.markdown?.length ?? 0);
    return result;
  }

  /** Scrape all URLs of a website with a single request (async job). */
  async crawl(url: string, options: CrawlOptions = {}): Promise<CrawlResult> {
    const body: Record<string, unknown> = {
      url,
      limit: options.limit ?? this.config.crawl.limit ?? 10,
      scrapeOptions: {
        formats: options.formats ?? this.config.crawl.formats ?? ['markdown'],
        onlyMainContent: options.onlyMainContent ?? this.config.crawl.onlyMainContent ?? true,
      },
    };
    if (options.maxDepth !== undefined) body.maxDepth = options.maxDepth;
    if (options.includePaths?.length) body.includePaths = options.includePaths;
    if (options.excludePaths?.length) body.excludePaths = options.excludePaths;
    if (options.ignoreSitemap !== undefined) body.ignoreSitemap = options.ignoreSitemap;

    const json = await this.request<{ success?: boolean; id?: string; url?: string }>(
      'POST',
      '/crawl',
      body,
    );
    const id = json.id ?? '';
    if (!id) throw new FirecrawlError('Firecrawl crawl did not return a job id');

    return this.waitForCrawl(id, url, options);
  }

  /** Poll a crawl job until it completes or times out. */
  async waitForCrawl(id: string, url: string, _options: CrawlOptions = {}): Promise<CrawlResult> {
    const pollInterval = this.config.crawl.pollIntervalMs ?? 5000;
    const pollTimeout = this.config.crawl.pollTimeoutMs ?? 300_000;
    const deadline = Date.now() + pollTimeout;

    while (Date.now() < deadline) {
      const json = await this.request<{
        success?: boolean;
        status?: string;
        total?: number;
        completed?: number;
        creditsUsed?: number;
        data?: Array<{
          markdown?: string;
          html?: string;
          metadata?: Record<string, unknown>;
        }>;
      }>('GET', `/crawl/${id}`);

      const status = json.status ?? 'unknown';
      if (status === 'completed') {
        const data: ScrapedContent[] = (json.data ?? []).map((d) => {
          const item: ScrapedContent = {
            url: (d.metadata?.sourceURL as string) ?? url,
            markdown: d.markdown,
            html: d.html,
            metadata: d.metadata,
          };
          if (item.markdown && this.config.compressContent) {
            const compressed = this.compressMarkdown(item.markdown);
            item.markdown = compressed.content;
            item.originalTokens = compressed.originalTokens;
            item.compressedTokens = compressed.compressedTokens;
            item.tokenSavings = compressed.tokenSavings;
          }
          return item;
        });
        const result: CrawlResult = {
          id,
          url,
          status: 'completed',
          total: json.total,
          completed: json.completed,
          creditsUsed: json.creditsUsed,
          data,
        };
        this.logUsage(
          'crawl',
          url,
          data.reduce((a, d) => a + (d.originalTokens ?? 0), 0),
        );
        return result;
      }
      if (status === 'failed' || status === 'cancelled') {
        return { id, url, status, total: json.total, completed: json.completed };
      }

      await sleep(pollInterval);
    }

    return { id, url, status: 'unknown', total: 0, completed: 0 };
  }

  /** Discover all URLs on a website instantly. */
  async map(url: string): Promise<MapResult> {
    const limit = this.config.map.limit ?? 100;
    const cacheKey = this.cacheKey('map', url, limit);
    const cached = this.cacheGet<MapResult>(cacheKey);
    if (cached) return cached;

    const json = await this.request<{ success?: boolean; links?: string[] }>('POST', '/map', {
      url,
      limit,
    });
    const result: MapResult = { url, links: json.links ?? [] };
    this.cacheSet(cacheKey, result);
    this.logUsage('map', url, result.links.length);
    return result;
  }

  // ── Health ──────────────────────────────────────────────────────────────────

  health(): HealthResult {
    const configFile = existsSync(CONFIG_PATH);
    const cacheDir = existsSync(resolve(ROOT, this.config.cacheDir));
    const apiKeyConfigured = this.config.apiKey.length > 0;
    const fallbackActive = this.config.fallbackEnabled;
    if (!this.config.enabled) {
      return {
        status: 'unconfigured',
        apiKeyConfigured,
        fallbackActive: false,
        provider: 'none',
        configFile,
        cacheDir,
        enabled: false,
        detail: 'Web crawler disabled in config',
      };
    }
    if (apiKeyConfigured) {
      const cacheOk = !this.config.cacheEnabled || cacheDir;
      return {
        status: cacheOk ? 'ok' : 'degraded',
        apiKeyConfigured,
        fallbackActive: false,
        provider: 'firecrawl',
        configFile,
        cacheDir,
        enabled: true,
        detail: cacheOk
          ? 'Firecrawl configured — cache directory present'
          : 'Firecrawl configured — cache directory missing',
      };
    }
    if (fallbackActive) {
      const cacheOk = !this.config.cacheEnabled || cacheDir;
      return {
        status: cacheOk ? 'ok' : 'degraded',
        apiKeyConfigured,
        fallbackActive: true,
        provider: 'jina-reader+ddg+bing',
        configFile,
        cacheDir,
        enabled: true,
        detail: cacheOk
          ? 'No API key — fallback activo (Jina Reader scrape + DDG HTML search → Bing RSS), sin coste'
          : 'No API key — fallback activo pero cache directory missing',
      };
    }
    return {
      status: 'unconfigured',
      apiKeyConfigured,
      fallbackActive: false,
      provider: 'none',
      configFile,
      cacheDir,
      enabled: true,
      detail: 'FIRECRAWL_API_KEY missing y fallback deshabilitado en config/web-crawler.json',
    };
  }
}

export function createWebCrawler(config?: Partial<WebCrawlerConfig>): WebCrawlerClient {
  return new WebCrawlerClient(config);
}
