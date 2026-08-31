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
