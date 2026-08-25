#!/usr/bin/env node
/**
 * Research Trends CLI — command-line interface for the Last30Days trend engine.
 *
 * Commands:
 *   npx tsx src/research/research-trends-cli.ts fetch --timeframe 7d --sources github,hackernews
 *   npx tsx src/research/research-trends-cli.ts themes --query "typescript OR rust"
 *   npx tsx src/research/research-trends-cli.ts report --output markdown [--json]
 *   npx tsx src/research/research-trends-cli.ts browse
 *   npx tsx src/research/research-trends-cli.ts status
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { createInterface } from 'readline';
import { pathToFileURL } from 'url';
import {
  fetchTrends,
  queryThemes,
  renderMarkdown,
  formatEngagement,
  deserializeReport,
  type Trend,
  type TrendReport,
  type TrendSource,
  type Timeframe,
} from './research-trends.js';

const ROOT = resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd());
const REPORT_DIR = join(ROOT, '.session', 'trends');

const SOURCES: TrendSource[] = ['github', 'hackernews', 'stackoverflow', 'devto', 'reddit'];
const TIMEFRAMES: Timeframe[] = ['24h', '7d', '30d'];

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
Last30Days Research Trends CLI

Usage:
  npx tsx src/research/research-trends-cli.ts <command> [options]

Commands:
  fetch   Fetch trends from live sources (cached 24h)
  themes  Search themes/trends by tag query
  report  Render a markdown/JSON report
  browse  Interactive TUI to browse trends
  status  Show cached report status

Options:
  --timeframe <24h|7d|30d>   Aggregation window (default 7d)
  --sources <list>           Comma-separated: github,hackernews,stackoverflow,devto,reddit
  --query "typescript OR rust"  Theme search query
  --output <markdown|json>   Report format
  --force                    Bypass the 24h cache
  --json                     Machine-readable JSON output

Examples:
  npx tsx src/research/research-trends-cli.ts fetch --timeframe 7d --sources github,hackernews
  npx tsx src/research/research-trends-cli.ts themes --query "typescript OR rust"
  npx tsx src/research/research-trends-cli.ts report --output markdown
  npx tsx src/research/research-trends-cli.ts browse
`);
}

function latestReportPath(timeframe: Timeframe): string {
  return join(REPORT_DIR, `report-${timeframe}.json`);
}

function loadCached(timeframe: Timeframe): TrendReport | null {
  const file = latestReportPath(timeframe);
  if (!existsSync(file)) return null;
  try {
    return deserializeReport(JSON.parse(readFileSync(file, 'utf-8')));
  } catch {
    return null;
  }
}

async function cmdFetch(args: CliArgs, force: boolean): Promise<void> {
  const timeframe = (args.timeframe ?? '7d') as Timeframe;
  if (!TIMEFRAMES.includes(timeframe)) {
    console.error(`Error: --timeframe must be one of ${TIMEFRAMES.join(', ')}`);
    process.exit(1);
  }
  const sources = (args.sources ?? SOURCES.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as TrendSource[];

  if (!force) {
    const cached = loadCached(timeframe);
    if (cached) {
      console.log(JSON.stringify(cached, null, 2));
      console.error(`[research-trends] served from cache (${timeframe}). Use --force to refresh.`);
      return;
    }
  }

  const result = await fetchTrends({ timeframe, sources });
  console.log(JSON.stringify(result.report, null, 2));
  if (result.cached) {
    console.error('[research-trends] served from cache. Use --force to refresh.');
  }
}

async function cmdThemes(args: CliArgs): Promise<void> {
  const timeframe = (args.timeframe ?? '7d') as Timeframe;
  const query = args.query ?? '';
  if (!query) {
    console.error('Error: --query is required for themes');
    process.exit(1);
  }
  let report = loadCached(timeframe);
  if (!report) {
    const result = await fetchTrends({ timeframe });
    report = result.report;
  }
  const { matchedThemes, matchedTrends } = queryThemes(report, query);
  console.log(
    JSON.stringify(
      {
        query,
        timeframe,
        matchedThemes,
        matchedTrends,
      },
      null,
      2,
    ),
  );
}

async function cmdReport(args: CliArgs): Promise<void> {
  const timeframe = (args.timeframe ?? '7d') as Timeframe;
  const output = args.output ?? 'markdown';
  const asJson = output === 'json' || args.json === 'true';
  let report = loadCached(timeframe);
  if (!report) {
    const result = await fetchTrends({ timeframe });
    report = result.report;
  }
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const md = renderMarkdown(report);
  if (args.file) {
    writeFileSync(resolve(ROOT, args.file), md, 'utf-8');
    console.log(`[research-trends] report written to ${args.file}`);
  } else {
    console.log(md);
  }
}

function colorize(entry: Trend): string {
  const colors: Record<string, string> = {
    github: '\x1b[36m',
    hackernews: '\x1b[33m',
    stackoverflow: '\x1b[32m',
    devto: '\x1b[35m',
    reddit: '\x1b[34m',
  };
  return `${colors[entry.source] ?? ''}${entry.source}\x1b[0m`;
}

async function cmdBrowse(args: CliArgs): Promise<void> {
  const timeframe = (args.timeframe ?? '7d') as Timeframe;
  let report = loadCached(timeframe);
  if (!report) {
    console.error('[research-trends] fetching fresh trends (first browse)…');
    const result = await fetchTrends({ timeframe });
    report = result.report;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const viewTrends = (trends: Trend[], title: string): void => {
    console.log(`\n=== ${title} ===`);
    trends.forEach((t, i) => {
      const eng = formatEngagement(t);
      console.log(
        `${String(i + 1).padStart(2)}) ${t.title} [${colorize(t)}]${eng ? ` — ${eng}` : ''}`,
      );
      console.log(`    ${t.url}`);
    });
  };

  const menu = (): void => {
    console.log('\n── Last30Days Trend Browser ──');
    console.log('  1) Hottest');
    console.log('  2) Emerging');
    console.log('  3) Themes');
    console.log('  t <n>) Show trend details');
    console.log('  q) Quit');
  };

  const details = (index: number): void => {
    const pool = [...report.hottest, ...report.emerging];
    const t = pool[index - 1];
    if (!t) {
      console.log('  Invalid selection.');
      return;
    }
    console.log(`\n── ${t.title} ──`);
    console.log(`  Source: ${colorize(t)}`);
    console.log(`  URL: ${t.url}`);
    console.log(`  Engagement: ${formatEngagement(t) || 'n/a'}`);
    console.log(`  Tags: ${t.tags.length ? t.tags.join(', ') : 'n/a'}`);
    console.log(`  Created: ${t.createdAt.toISOString()}`);
    if (t.description) console.log(`  Description: ${t.description.slice(0, 300)}`);
  };

  menu();
  rl.on('line', async (line) => {
    const input = line.trim().toLowerCase();
    if (input === 'q' || input === 'quit' || input === 'exit') {
      rl.close();
      return;
    }
    if (input === '1' || input === 'h') {
      viewTrends(report.hottest, 'Hottest');
    } else if (input === '2' || input === 'e') {
      viewTrends(report.emerging, 'Emerging');
    } else if (input === '3' || input === 'th') {
      console.log('\n=== Themes ===');
      report.themes.forEach((th, i) => {
        console.log(`  ${String(i + 1).padStart(2)}) #${th.tag} — ${th.count} trends`);
        for (const t of th.trends.slice(0, 5)) {
          console.log(`     - ${t.title} (${t.source})`);
        }
      });
    } else if (/^t\s*\d+$/.test(input)) {
      const n = parseInt(input.replace(/^t\s*/, ''), 10);
      details(n);
    } else {
      menu();
    }
  });
  await new Promise<void>((resolvePromise) => rl.on('close', () => resolvePromise()));
}

function cmdStatus(args: CliArgs): void {
  const timeframe = (args.timeframe ?? '7d') as Timeframe;
  const file = latestReportPath(timeframe);
  if (!existsSync(file)) {
    console.log(
      JSON.stringify(
        { timeframe, report: null, message: 'No cached report. Run fetch first.' },
        null,
        2,
      ),
    );
    return;
  }
  const stat = statSync(file);
  const report = loadCached(timeframe);
  console.log(
    JSON.stringify(
      {
        timeframe,
        reportFile: file,
        mtime: stat.mtime.toISOString(),
        sizeBytes: stat.size,
        trends: report ? report.hottest.length + report.emerging.length : 0,
        themes: report ? report.themes.length : 0,
        timestamp: report ? report.timestamp : null,
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    process.exit(command ? 0 : 1);
  }

  const force = args.force === 'true';

  switch (command) {
    case 'fetch':
      await cmdFetch(args, force);
      break;
    case 'themes':
      await cmdThemes(args);
      break;
    case 'report':
      await cmdReport(args);
      break;
    case 'browse':
      await cmdBrowse(args);
      break;
    case 'status':
      cmdStatus(args);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(`[research-trends-cli] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
