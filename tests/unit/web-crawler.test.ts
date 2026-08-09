#!/usr/bin/env node
/**
 * Unit Tests: Web Crawler (Firecrawl integration)
 *
 * Uses an in-process mock server to exercise the WebCrawlerClient without
 * requiring a real Firecrawl API key or network access. Also validates the
 * config template.
 */

import { createServer, type Server } from 'node:http';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  WebCrawlerClient,
  FirecrawlError,
  type SearchResult,
  type ScrapedContent,
} from '../../src/web-crawler.ts';

const ROOT = process.cwd();
const config = JSON.parse(readFileSync(join(ROOT, 'config', 'web-crawler.json'), 'utf-8'));

let server: Server;
let baseUrl = '';
let requestCount = 0;

// ─── Mock Firecrawl server ────────────────────────────────────────────────────

function startMockServer(): Promise<string> {
  return new Promise((resolvePromise) => {
    server = createServer((req, res) => {
      requestCount++;
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url?.startsWith('/v1/search')) {
          res.end(
            JSON.stringify({
              success: true,
              data: [
                {
                  url: 'https://example.com/1',
                  title: 'Example Post 1',
                  description: 'First example',
                  markdown: '# Example Post 1\n\nContent one.',
                },
                {
                  url: 'https://example.com/2',
                  title: 'Example Post 2',
                  description: 'Second example',
                  markdown: '# Example Post 2\n\nContent two.',
                },
              ],
            }),
          );
        } else if (req.url?.startsWith('/v1/scrape')) {
          res.end(
            JSON.stringify({
              success: true,
              data: {
                markdown: '# Scraped Page\n\nHello world, this is scraped content.',
                metadata: { sourceURL: 'https://example.com/page', statusCode: 200 },
              },
            }),
          );
        } else if (req.url?.startsWith('/v1/crawl')) {
          // Handle /v1/crawl (POST request - create job) vs /v1/crawl/{id} (GET - check status)
          const pathParts = req.url.split('/');
          const id = pathParts.length > 3 ? pathParts[3] : '';
          if (!id) {
            res.end(JSON.stringify({ success: true, id: 'job-123', url: 'https://example.com' }));
          } else {
            res.end(
              JSON.stringify({
                success: true,
                status: 'completed',
                total: 2,
                completed: 2,
                creditsUsed: 4,
                data: [
                  { markdown: '# Page A', metadata: { sourceURL: 'https://example.com/a' } },
                  { markdown: '# Page B', metadata: { sourceURL: 'https://example.com/b' } },
                ],
              }),
            );
          }
        } else if (req.url?.startsWith('/v1/map')) {
          res.end(
            JSON.stringify({
              success: true,
              links: ['https://example.com/', 'https://example.com/about', 'https://example.com/faq'],
            }),
          );
        } else {
          res.statusCode = 404;
          res.end(JSON.stringify({ success: false, error: 'not found' }));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}/v1`;
        resolvePromise(baseUrl);
      }
    });
  });
}

function makeClient(): WebCrawlerClient {
  return new WebCrawlerClient({
    baseUrl,
    apiKey: 'test-key',
    enabled: true,
    cacheEnabled: false,
    compressContent: false,
    logUsageToNexus: false,
    rateLimitPerMinute: 1000,
    maxRetries: 0,
    cacheDir: '.runtime', // Use existing directory for health check
  });
}

// ─── Config template ──────────────────────────────────────────────────────────

describe('config/web-crawler.json', () => {
  it('has required top-level fields', () => {
    assert.ok(config.version);
    assert.ok(config.baseUrl);
    assert.equal(typeof config.enabled, 'boolean');
    assert.equal(typeof config.maxRetries, 'number');
    assert.equal(typeof config.rateLimitPerMinute, 'number');
    assert.ok(Array.isArray(config.scrape.formats));
  });

  it('has default search config', () => {
    assert.equal(typeof config.search.limit, 'number');
    assert.equal(typeof config.search.fetchFullContent, 'boolean');
  });

  it('has crawl and map config', () => {
    assert.equal(typeof config.crawl.limit, 'number');
    assert.equal(typeof config.crawl.pollIntervalMs, 'number');
    assert.equal(typeof config.map.limit, 'number');
  });
});

// ─── Client behavior ──────────────────────────────────────────────────────────

describe('WebCrawlerClient', () => {
  before(async () => {
    await startMockServer();
  });

  after(() => {
    server?.close();
  });

  it('isConfigured reflects API key or fallback presence', () => {
    const client = makeClient();
    assert.ok(client.isConfigured());
    // No API key + fallback enabled (default) → configured via fallback
    const noKey = new WebCrawlerClient({ baseUrl, apiKey: '', cacheEnabled: false });
    assert.ok(noKey.isConfigured(), 'fallback makes client usable without API key');
    // No API key + fallback disabled → not configured
    const noFallback = new WebCrawlerClient({
      baseUrl,
      apiKey: '',
      cacheEnabled: false,
      fallbackEnabled: false,
    });
    assert.ok(!noFallback.isConfigured());
  });

  it('health() reports ok when configured', () => {
    const health = makeClient().health();
    assert.equal(health.status, 'ok');
    assert.ok(health.apiKeyConfigured);
    assert.equal(health.provider, 'firecrawl');
    assert.equal(health.fallbackActive, false);
  });

  it('health() reports ok with fallback when API key missing', () => {
    const health = new WebCrawlerClient({
      baseUrl,
      apiKey: '',
      cacheEnabled: false,
      fallbackEnabled: true,
    }).health();
    assert.equal(health.status, 'ok');
    assert.equal(health.apiKeyConfigured, false);
    assert.equal(health.fallbackActive, true);
    assert.equal(health.provider, 'jina-reader+ddg+bing');
  });

  it('health() reports unconfigured when no key and fallback disabled', () => {
    const health = new WebCrawlerClient({
      baseUrl,
      apiKey: '',
      cacheEnabled: false,
      fallbackEnabled: false,
    }).health();
    assert.equal(health.status, 'unconfigured');
    assert.equal(health.provider, 'none');
  });

  it('search returns parsed results', async () => {
    const client = makeClient();
    const results: SearchResult[] = await client.search('test query', 2);
    assert.equal(results.length, 2);
    assert.equal(results[0].url, 'https://example.com/1');
    assert.ok(results[0].markdown?.includes('Example Post 1'));
  });

  it('fallback search parses DuckDuckGo HTML results (redirect decode)', async () => {
    // Local mock that serves DDG-style HTML so no network is needed.
    const ddgServer = createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<html><body>' +
          '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=' +
          encodeURIComponent('https://example.com/retention-playbook') +
          '&amp;rut=abc">Customer Retention Playbook</a>' +
          '<a class="result__snippet" href="//duckduckgo.com/l/?uddg=' +
          encodeURIComponent('https://example.com/retention-playbook') +
          '&amp;rut=abc">Strategies to keep customers loyal</a>' +
          '</body></html>',
      );
    });
    await new Promise<void>((r) => ddgServer.listen(0, '127.0.0.1', r));
    const addr = ddgServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    try {
      const client = new WebCrawlerClient({
        baseUrl,
        apiKey: '',
        cacheEnabled: false,
        fallbackEnabled: true,
        ddgSearchUrl: `http://127.0.0.1:${port}/html/`,
        bingSearchUrl: `http://127.0.0.1:${port}/bing`,
        maxRetries: 0,
      });
      const results = await client.search('customer retention', 1);
      assert.equal(results.length, 1);
      assert.equal(results[0].url, 'https://example.com/retention-playbook');
      assert.ok(results[0].title.includes('Retention'));
      assert.ok(results[0].description?.includes('loyal'));
    } finally {
      ddgServer.close();
    }
  });

  it('scrape returns markdown content', async () => {
    const client = makeClient();
    const result: ScrapedContent = await client.scrape('https://example.com/page');
    assert.ok(result.markdown?.includes('Scraped Page'));
    assert.equal(result.metadata?.statusCode, 200);
  });

  it('crawl polls job and returns completed data', async () => {
    const client = makeClient();
    const result = await client.crawl('https://example.com');
    assert.equal(result.id, 'job-123');
    assert.equal(result.status, 'completed');
    assert.ok(result.data && result.data.length === 2);
  });

  it('map returns discovered links', async () => {
    const client = makeClient();
    const result = await client.map('https://example.com');
    assert.equal(result.links.length, 3);
    assert.ok(result.links.includes('https://example.com/about'));
  });

  it('throws FirecrawlError when API key missing and fallback disabled', async () => {
    const client = new WebCrawlerClient({
      baseUrl,
      apiKey: '',
      enabled: true,
      fallbackEnabled: false,
    });
    await assert.rejects(() => client.scrape('https://example.com'), FirecrawlError);
  });

  it('caches results when cache enabled', async () => {
    const beforeCount = requestCount;
    const uniqueDir = join(ROOT, '.session', 'response-cache', `firecrawl-test-${Date.now()}`);
    const client = new WebCrawlerClient({
      baseUrl,
      apiKey: 'test-key',
      enabled: true,
      cacheEnabled: true,
      cacheDir: uniqueDir,
      compressContent: false,
      logUsageToNexus: false,
      rateLimitPerMinute: 1000,
      maxRetries: 0,
    });
    await client.map('https://example.com');
    await client.map('https://example.com');
    // First call hit the server; second should be served from cache (no new request).
    assert.ok(requestCount - beforeCount <= 1, 'second map() should be served from cache');
    rmSync(uniqueDir, { recursive: true, force: true });
  });
});
