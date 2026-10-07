#!/usr/bin/env node
/**
 * Records the outcome of a delegation that happened outside this codebase's TS code.
 *
 * Why this exists (found 2026-10-02): the routing learning loop was fully built and
 * fully honest, and produced almost nothing. The chain was:
 *
 *   - `adaptive-router --build` reads outcomes and writes the routing table (runs as a
 *     session step).
 *   - `src/orchestration/route-and-delegate.ts` is the only thing that called
 *     `recordRoutingOutcome`, and it has zero callers: the reference to it in
 *     `zcode-sync.ts` is a comment.
 *   - The delegation that actually happens is the orchestrator's `task` dispatch, which
 *     is not a Node process and cannot be observed from inside a script.
 *
 * Result: one row in `routing_rules`, created 2026-08-25 by a manual run. Everything
 * downstream of that was reading near-empty tables, which is why the collector had to be
 * taught that absence is not evidence.
 *
 * This CLI is the seam. Whoever dispatches an agent reports the result here, the outcome
 * lands in `routing_rules`, and the next `--build` learns from it. It is deliberately
 * cheap and idempotent: one INSERT, no orchestration, no routing decisions.
 *
 * Usage:
 *   node --import tsx src/orchestration/record-routing-outcome.ts \
 *     --pattern general --target gov-agent --success
 *   node --import tsx src/orchestration/record-routing-outcome.ts \
 *     --pattern code-review --target sdd-verify --success=false
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseManager, DEFAULT_TENANT_ID } from '../database/nexus/manager.js';

const ROOT = resolve(process.cwd());

interface Args {
  pattern: string;
  target: string;
  success: boolean;
  tenantId: string;
}

export function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const successFlag = get('--success');
  return {
    pattern: get('--pattern') ?? 'general',
    target: get('--target') ?? '',
    // `--success` with no value means true; `--success=false` is false.
    success: successFlag === undefined ? true : successFlag !== 'false' && successFlag !== '0',
    tenantId: get('--tenant') ?? DEFAULT_TENANT_ID,
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (!args.target) {
    console.error('usage: record-routing-outcome.ts --pattern <domain> --target <agent> [--success[=false]] [--tenant id]');
    process.exit(2);
  }

  const dbPath = join(ROOT, '.runtime', 'gentle-vanguard.db');
  if (!existsSync(dbPath)) {
    console.error(`Nexus database not found: ${dbPath}`);
    process.exit(1);
  }

  const manager = DatabaseManager.getInstance();
  // Signature is (pattern, target, success, tenantId) at the manager level.
  manager.recordRoutingOutcome(args.pattern, args.target, args.success, args.tenantId);
  console.log(
    JSON.stringify({ recorded: true, pattern: args.pattern, target: args.target, success: args.success }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}