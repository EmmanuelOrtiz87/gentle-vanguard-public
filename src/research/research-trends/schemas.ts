import { z } from 'zod';

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

export interface Engagement {
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

export const ResearchTrendsConfigSchema = z.object({
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
