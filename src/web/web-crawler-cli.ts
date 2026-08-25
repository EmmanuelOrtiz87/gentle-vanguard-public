#!/usr/bin/env node
/**
 * Web Crawler CLI — command-line interface for the Firecrawl wrapper.
 *
 * Wraps src/web/web-crawler.ts with convenient commands for search, scrape,
 * crawl, map and health. Results are printed as JSON for machine consumption.
 *
 * Usage:
 *   npx tsx src/web/web-crawler-cli.ts search --query "..." [--limit 5]
 *   npx tsx src/web/web-crawler-cli.ts scrape --url https://example.com [--formats markdown]
 *   npx tsx src/web/web-crawler-cli.ts crawl --url https://example.com [--limit 10]
 *   npx tsx src/web/web-crawler-cli.ts map --url https://example.com
 *   npx tsx src/web/web-crawler-cli.ts health
 */

import { pathToFileURL } from 'url';
import { createWebCrawler, type Action, type FirecrawlFormat } from './web-crawler.js';

interface CliArgs {
  [key: string]: string | undefined;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = 'true';
    }
  }
  return args;
}

function printUsage(): void {
  console.log(`
Firecrawl Web Crawler CLI

Usage:
  npx tsx src/web/web-crawler-cli.ts <command> [options]

Commands:
  search <--query "..." [--limit N]>   Search web + fetch full page content
  scrape <--url URL [--formats markdown,html] [--include-tags ...] [--exclude-tags ...] [--action "json"]
  crawl  <--url URL [--limit N]>       Scrape all URLs of a site (async job)
  map    <--url URL>                   Discover all URLs on a site
  health                              Check API key + cache configuration

Options:
  --query "..."        Search query
  --url URL            Target URL
  --limit N            Max results / pages
  --formats list       Comma-separated formats (markdown,html,json,screenshot)
  --include-tags list  Comma-separated tags to keep
  --exclude-tags list  Comma-separated tags to drop
  --action "json"      Single browser action, e.g. '{"type":"wait","milliseconds":2000}'

Examples:
  npx tsx src/web/web-crawler-cli.ts search --query "firecrawl api" --limit 5
  npx tsx src/web/web-crawler-cli.ts scrape --url https://example.com
  npx tsx src/web/web-crawler-cli.ts crawl --url https://docs.firecrawl.dev --limit 10
  npx tsx src/web/web-crawler-cli.ts map --url https://example.com
  npx tsx src/web/web-crawler-cli.ts health
`);
}

function toNumber(value: string | undefined): number | undefined {
  const n = parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : undefined;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    process.exit(command ? 0 : 1);
  }

  const client = createWebCrawler();

  switch (command) {
    case 'search': {
      const query = args.query ?? '';
      if (!query) {
        console.error('Error: --query is required for search');
        process.exit(1);
      }
      const results = await client.search(query, toNumber(args.limit));
      console.log(JSON.stringify(results, null, 2));
      break;
    }

    case 'scrape': {
      const url = args.url ?? '';
      if (!url) {
        console.error('Error: --url is required for scrape');
        process.exit(1);
      }
      const formats = (args.formats ?? 'markdown')
        .split(',')
        .filter((f): f is FirecrawlFormat =>
          ['markdown', 'html', 'json', 'screenshot'].includes(f),
        );
      const actions: Action[] = [];
      if (args.action) {
        try {
          const parsed = JSON.parse(args.action) as Action;
          actions.push(parsed);
        } catch {
          console.warn('Warning: ignoring malformed --action JSON');
        }
      }
      const result = await client.scrape(url, {
        formats,
        includeTags: args.includeTags ? args.includeTags.split(',') : undefined,
        excludeTags: args.excludeTags ? args.excludeTags.split(',') : undefined,
        actions,
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'crawl': {
      const url = args.url ?? '';
      if (!url) {
        console.error('Error: --url is required for crawl');
        process.exit(1);
      }
      const result = await client.crawl(url, { limit: toNumber(args.limit) });
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'map': {
      const url = args.url ?? '';
      if (!url) {
        console.error('Error: --url is required for map');
        process.exit(1);
      }
      const result = await client.map(url);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'health': {
      console.log(JSON.stringify(client.health(), null, 2));
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(`[web-crawler-cli] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
