#!/usr/bin/env node
/**
 * Secret Scanner CLI — scan files, directories or URLs for secrets / API keys.
 *
 * Exit codes:
 *   0  no secrets found
 *   1  secrets found
 *   2  usage / runtime error
 *
 * Usage:
 *   npx tsx src/secret-scanner-cli.ts --scan <file|url> [options]
 *   npx tsx src/secret-scanner-cli.ts --dir <dir> [options]
 *   npx tsx src/secret-scanner-cli.ts --scan <file> --dir <dir> [options]
 *
 * Options:
 *   --scan <path|url>    Scan a single file or URL
 *   --dir <path>         Recursively scan a directory
 *   --redact             Redact secret values (default from config, true)
 *   --no-redact          Show full secret values
 *   --entropy            Enable Shannon entropy false-positive filtering
 *   --patterns <mode>    Pattern set: builtin | all (default from config)
 *   --ignore-ext <list>  Extra comma-separated extensions to skip
 *   --json               Emit the full report as JSON
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildReport,
  getPatternCount,
  loadConfig,
  redactSecret,
  scanFiles,
  scanUrl,
  type PatternMode,
  type SecretMatch,
} from './secret-scanner.js';

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
  const cfg = loadConfig();
  console.log(`
Secret Scanner CLI — native secrets / API keys detector

Usage:
  npx tsx src/secret-scanner-cli.ts --scan <file|url> [options]
  npx tsx src/secret-scanner-cli.ts --dir <dir> [options]

Options:
  --scan <path|url>    Scan a single file or URL
  --dir <path>         Recursively scan a directory
  --redact             Redact secret values (default: ${cfg.redactByDefault})
  --no-redact          Show full secret values
  --entropy            Enable Shannon entropy false-positive filtering
  --patterns <mode>    Pattern set: builtin | all (default: ${cfg.patterns})
  --ignore-ext <list>  Extra comma-separated extensions to skip, e.g. "json,yml"
  --json               Emit the full report as JSON

Exit codes:
  0  no secrets found
  1  secrets found
  2  usage or runtime error
`);
}

/** Remove any known secret from surrounding context text so redacted output is safe. */
function redactContext(context: string, secrets: string[]): string {
  let out = context;
  for (const value of secrets) {
    if (!value) continue;
    out = out.split(value).join(redactSecret(value));
  }
  return out;
}

function formatMatch(m: SecretMatch): string {
  const risk = m.pattern.risk.toUpperCase().padEnd(6);
  const label = m.pattern.name;
  const value = redactSecret(m.match);
  const at = m.source ? `${m.source}:${m.line}` : `line ${m.line}`;
  const entropy = m.entropyScore !== undefined ? `  [entropy ${m.entropyScore.toFixed(2)}]` : '';
  return `  [${risk}] ${label}${entropy}\n          ${at}\n          ${value}`;
}

function printSummary(matches: SecretMatch[], patternCount: number): void {
  const byCategory = new Map<string, number>();
  const byRisk = new Map<string, number>();
  for (const m of matches) {
    byCategory.set(m.pattern.category, (byCategory.get(m.pattern.category) ?? 0) + 1);
    byRisk.set(m.pattern.risk, (byRisk.get(m.pattern.risk) ?? 0) + 1);
  }
  console.log('');
  console.log(`Secret Scanner — ${matches.length} match(es) found (${patternCount} patterns active)`);
  console.log('─'.repeat(60));
  for (const m of matches) {
    console.log(formatMatch(m));
  }
  console.log('');
  console.log('By category:');
  for (const [cat, n] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${n}`);
  }
  console.log('');
  console.log('By risk:');
  for (const risk of ['high', 'medium', 'low'] as const) {
    const n = byRisk.get(risk) ?? 0;
    console.log(`  ${risk}: ${n}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help === 'true' || args.h === 'true') {
    printUsage();
    process.exit(0);
  }

  const scanTarget = args.scan;
  const dirTarget = args.dir;
  const targets: string[] = [];
  if (scanTarget) targets.push(scanTarget);
  if (dirTarget) targets.push(dirTarget);

  if (targets.length === 0) {
    console.error('Error: provide at least one --scan <path|url> or --dir <path>');
    printUsage();
    process.exit(2);
  }

  const config = loadConfig();
  const redact = args['no-redact'] === 'true' ? false : args.redact === 'true' ? true : config.redactByDefault;
  const entropy = args.entropy === 'true';
  const patterns: PatternMode = args.patterns === 'builtin' ? 'builtin' : 'all';
  const ignoreExt = args['ignore-ext']
    ? args['ignore-ext']
        .split(',')
        .map((e) => e.trim())
        .filter((e) => e.length > 0)
    : undefined;

  const scanOpts = { entropy, patterns };
  const fileOpts = { entropy, patterns, ignoreExtensions: ignoreExt };

  const matches: SecretMatch[] = [];
  const errors: string[] = [];

  for (const target of targets) {
    try {
      if (/^https?:\/\//i.test(target)) {
        const urlMatches = await scanUrl(target, scanOpts);
        matches.push(...urlMatches);
      } else if (!existsSync(target)) {
        errors.push(`${target}: path does not exist`);
      } else {
        const fileMatches = await scanFiles([resolve(target)], fileOpts);
        matches.push(...fileMatches);
      }
    } catch (e) {
      errors.push(`${target}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`[secret-scanner] ${err}`);
    }
    process.exit(2);
  }

  const patternCount = getPatternCount(patterns);

  if (args.json === 'true') {
    const report = buildReport(matches, { redact });
    const allSecrets = Array.from(new Set(matches.map((m) => m.match)));
    const output = {
      ...report,
      patternCount,
      scannedAt: report.scannedAt,
      matches: report.matches.map((m) => ({
        pattern: m.pattern.name,
        category: m.pattern.category,
        risk: m.pattern.risk,
        match: redact ? redactSecret(m.match) : m.match,
        context: redact ? redactContext(m.context, allSecrets) : m.context,
        line: m.line,
        source: m.source,
        ...(m.entropyScore !== undefined ? { entropyScore: Number(m.entropyScore.toFixed(2)) } : {}),
      })),
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    printSummary(matches, patternCount);
  }

  process.exit(matches.length > 0 ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(`[secret-scanner-cli] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  });
}
