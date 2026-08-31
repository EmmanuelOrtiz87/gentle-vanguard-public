#!/usr/bin/env node
/**
 * continuous-eval-cli.ts — CLI entry for the continuous evaluation pipeline.
 *
 * Usage:
 *   npx tsx src/eval/continuous-eval-cli.ts            # run + persist + trend
 *   npx tsx src/eval/continuous-eval-cli.ts --gate     # exit 1 on regression
 *   npx tsx src/eval/continuous-eval-cli.ts --threshold 10 --limit 500 --json
 *   npx tsx src/eval/continuous-eval-cli.ts --db path/to/db.sqlite
 */

import { pathToFileURL } from 'url';
import {
  runContinuousEval,
  openNexus,
  resolveDbPath,
  type EvalRunResult,
} from './continuous-eval.js';

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

function printHuman(result: EvalRunResult): void {
  const { dataset, scores, trend, gate, runId } = result;
  if (runId === null) {
    console.log(
      `[EVAL] No labeled sessions with activity yet — run skipped (not persisted, gate neutral).`,
    );
    console.log(
      `[EVAL] The dataset grows as sessions close with terminal status + recorded activity.`,
    );
    return;
  }
  console.log(`[EVAL] Continuous eval run #${runId}`);
  console.log(`[EVAL] Dataset: ${dataset.items.length} sessions (${dataset.positives} positive / ${dataset.negatives} negative)`);
  console.log(`[EVAL] Scores:`);
  console.log(`         successRate:        ${(scores.successRate * 100).toFixed(1)}%`);
  console.log(`         tokenEfficiency:    ${scores.tokenEfficiency.toFixed(3)}`);
  console.log(`         durationEfficiency: ${scores.durationEfficiency.toFixed(3)}`);
  console.log(`         aggregateScore:     ${scores.aggregateScore.toFixed(4)}`);
  console.log(`[EVAL] Tokens: avg ${scores.avgTokens} / median ${scores.medianTokens} / p95 ${scores.p95Tokens}`);
  console.log(`[EVAL] Duration (ms): median ${scores.medianDurationMs} / p95 ${scores.p95DurationMs}`);
  if (trend.direction === 'first-run') {
    console.log(`[EVAL] Trend: first run (no baseline)`);
  } else {
    const sign = (trend.deltaPercent ?? 0) >= 0 ? '+' : '';
    console.log(
      `[EVAL] Trend: ${trend.direction} (${sign}${trend.deltaPercent}% vs run #${trend.previousRunId}: ${trend.previousAggregateScore?.toFixed(4)} -> ${scores.aggregateScore.toFixed(4)})`,
    );
  }
  if (gate.enabled) {
    const label = gate.passed ? 'PASS' : 'FAIL';
    console.log(`[EVAL] Gate: ${label} — ${gate.reason}`);
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const gate = args.includes('--gate');
  const json = args.includes('--json');
  const threshold = Number(argValue(args, 'threshold') ?? 5);
  const limit = Number(argValue(args, 'limit') ?? 200);
  const tokenBudget = Number(argValue(args, 'token-budget') ?? 50_000);
  const durationBudgetMs = Number(argValue(args, 'duration-budget-ms') ?? 120_000);
  const dbPath = resolveDbPath(argValue(args, 'db'));

  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      [
        'Usage: continuous-eval-cli [--gate] [--threshold N] [--limit N] [--json]',
        '                          [--token-budget N] [--duration-budget-ms N] [--db PATH]',
        '',
        '  --gate             fail (exit 1) if aggregate score drops more than --threshold % vs previous run',
        '  --threshold N      gate regression threshold in percent (default 5)',
        '  --limit N          max recent sessions in the dataset (default 200)',
        '  --json             machine-readable output',
      ].join('\n'),
    );
    return 0;
  }

  let db;
  try {
    db = openNexus(dbPath);
  } catch (err) {
    console.error(`[EVAL] FATAL: ${(err as Error).message}`);
    return 1;
  }

  try {
    const result = runContinuousEval(db, {
      gate,
      limit: Number.isFinite(limit) ? limit : 200,
      gateThresholdPercent: Number.isFinite(threshold) ? threshold : 5,
      tokenBudget: Number.isFinite(tokenBudget) ? tokenBudget : 50_000,
      durationBudgetMs: Number.isFinite(durationBudgetMs) ? durationBudgetMs : 120_000,
    });
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHuman(result);
    }
    if (gate && !result.gate.passed) return 1;
    return 0;
  } catch (err) {
    console.error(`[EVAL] FATAL: ${(err as Error).message}`);
    return 1;
  } finally {
    db.close();
  }
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  void main().then((code) => process.exit(code));
}
