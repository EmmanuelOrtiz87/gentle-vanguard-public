import { z } from 'zod';
import { cacheKey } from './http.js';
import { TrendReportSchema, TrendSchema } from './schemas.js';
import type { ResearchTrendsConfig, Timeframe, Trend, TrendReport } from './schemas.js';

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

export function serializeReport(report: TrendReport): unknown {
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

export function serializeTrend(t: Trend): Record<string, unknown> {
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

export function deserializeTrend(t: z.infer<typeof TrendSchema>): Trend {
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

export function cacheKeyFn(op: string, ...parts: unknown[]): string {
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
