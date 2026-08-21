#!/usr/bin/env node
/**
 * Web Crawler init — lightweight lazy step for the session autostart pipeline.
 *
 * Validates Firecrawl configuration (API key presence + cache directory) and
 * persists the health snapshot to .runtime/web-crawler-health.json so the
 * watchtower can surface the component status. Non-blocking and idempotent.
 *
 * Usage:
 *   npx tsx src/web-crawler-init.ts [--quiet]
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { createWebCrawler } from './web-crawler.js';

const ROOT = resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd());
const HEALTH_FILE = join(ROOT, '.runtime', 'web-crawler-health.json');

function main(): void {
  const quiet = process.argv.slice(2).includes('--quiet');
  const client = createWebCrawler();
  const health = client.health();

  try {
    mkdirSync(join(ROOT, '.runtime'), { recursive: true });
    writeFileSync(
      HEALTH_FILE,
      JSON.stringify({ ...health, timestamp: new Date().toISOString() }, null, 2),
      'utf-8',
    );
  } catch (e) {
    if (!quiet)
      console.warn(`[web-crawler-init] could not write health file: ${(e as Error).message}`);
  }

  if (!quiet) {
    console.log(
      `[web-crawler-init] ${health.status === 'ok' ? 'OK' : health.status} — provider: ${
        health.provider
      }, apiKey: ${health.apiKeyConfigured ? 'set' : 'missing'}, fallback: ${
        health.fallbackActive ? 'active' : 'off'
      }, cacheDir: ${health.cacheDir ? 'ready' : 'missing'}`,
    );
  }
  console.log(JSON.stringify(health));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
