import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import {
  ResearchTrendsConfigSchema,
  type ResearchTrendsConfig,
  type Timeframe,
} from './schemas.js';

export const ROOT = resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd());
export const CONFIG_PATH = join(ROOT, 'config', 'research-trends.json');

export function loadConfig(): ResearchTrendsConfig {
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

export function timeframeToMs(tf: Timeframe): number {
  switch (tf) {
    case '24h':
      return 24 * 60 * 60 * 1000;
    case '7d':
      return 7 * 24 * 60 * 60 * 1000;
    case '30d':
      return 30 * 24 * 60 * 60 * 1000;
  }
}

export function timeframeToReddit(tf: Timeframe): string {
  switch (tf) {
    case '24h':
      return 'day';
    case '7d':
      return 'week';
    case '30d':
      return 'month';
  }
}
