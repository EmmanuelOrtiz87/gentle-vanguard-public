import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { ROOT } from './config.js';
import type { ResearchTrendsConfig, TrendSource } from './schemas.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolveFn) => setTimeout(resolveFn, ms));
}

export function cacheKey(op: string, ...parts: unknown[]): string {
  const raw = JSON.stringify([op, ...parts]);
  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

export function makeId(source: TrendSource, seed: string): string {
  return `${source}:${seed}`;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

export class TrendCache {
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

export class HttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export async function httpGet(
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
