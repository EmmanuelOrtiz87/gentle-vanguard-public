import { z } from 'zod';

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

export const WebCrawlerConfigSchema = z
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
