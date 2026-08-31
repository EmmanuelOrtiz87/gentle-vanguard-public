#!/usr/bin/env node
/**
 * Correlation CLI — unified observability timeline (F3.6).
 *
 * Prints the unified timeline (traces + metrics + logs + token usage) for one
 * session or trace, built on the session_id ↔ trace_id ↔ token_transactions
 * correlation chain.
 *
 * Usage:
 *   npx tsx src/telemetry/correlation-cli.ts --session <sessionId>
 *   npx tsx src/telemetry/correlation-cli.ts --trace <traceId> --json
 *   npx tsx src/telemetry/correlation-cli.ts --session <id> --from 2026-08-31T00:00:00Z
 *
 * Options:
 *   --session <id>   Filter by session id (enables Nexus token_transactions join).
 *   --trace <id>     Filter by trace id.
 *   --from <iso|ms>  Inclusive lower bound.
 *   --to <iso|ms>    Exclusive upper bound.
 *   --no-tokens      Skip the Nexus token_transactions join.
 *   --json           Print raw JSON instead of the table view.
 */

import { pathToFileURL } from 'node:url';
import { queryCorrelation } from './correlation-query';

interface CliArgs {
  session?: string;
  trace?: string;
  from?: string;
  to?: string;
  noTokens?: boolean;
  json?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--session':
        args.session = argv[++i];
        break;
      case '--trace':
        args.trace = argv[++i];
        break;
      case '--from':
        args.from = argv[++i];
        break;
      case '--to':
        args.to = argv[++i];
        break;
      case '--no-tokens':
        args.noTokens = true;
        break;
      case '--json':
        args.json = true;
        break;
      default:
        if (arg.startsWith('--')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }
  return args;
}

function formatEntry(entry: {
  ts: string;
  kind: string;
  name: string;
  agent?: string;
  payload?: Record<string, unknown>;
}): string {
  const ts = entry.ts ? entry.ts.slice(11, 23) : '--:--:--.---';
  const agent = (entry.agent ?? '-').padEnd(12).slice(0, 12);
  const kind = entry.kind.toUpperCase().padEnd(5);
  let detail = entry.name;
  if (entry.kind === 'log' && entry.payload?.message) detail = `${entry.name}: ${entry.payload.message}`;
  if (entry.kind === 'metric' && entry.payload?.value !== undefined) {
    detail = `${entry.name} = ${entry.payload.value}`;
  }
  if (entry.kind === 'token') {
    const p = entry.payload ?? {};
    detail = `${p.model ?? '?'} in=${p.inputTokens ?? 0} out=${p.outputTokens ?? 0} cost=${p.cost ?? 0}`;
  }
  return `${ts}  ${kind}  ${agent}  ${detail}`;
}

export async function main(argv: string[] = process.argv): Promise<number> {
  const args = parseArgs(argv);
  if (!args.session && !args.trace) {
    console.error('Specify --session <id> or --trace <id> (see --help in header comment).');
    return 1;
  }

  const result = await queryCorrelation({
    sessionId: args.session,
    traceId: args.trace,
    from: args.from,
    to: args.to,
    includeTokens: args.noTokens ? false : undefined,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  const filter = [args.session && `session=${args.session}`, args.trace && `trace=${args.trace}`]
    .filter(Boolean)
    .join(' ');
  console.log(`\nCorrelation timeline (${filter}) — ${result.total} entries`);
  console.log(
    `Sources: ${result.sources.jsonlEvents} JSONL events indexed, ${result.sources.tokenTransactions} token transactions joined\n`,
  );
  for (const entry of result.entries) {
    console.log(formatEntry(entry));
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
