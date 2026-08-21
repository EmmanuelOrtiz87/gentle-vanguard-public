#!/usr/bin/env node
/**
 * Planning & Estimation Framework — Generate task estimates, PR sizes, cost projections.
 * TS migration of scripts/utilities/planning/planning-estimator.ps1
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

const modelPricing: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10.0 },
  'claude-3.5-sonnet': { input: 3.0, output: 15.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
};

const baseTime: Record<number, number> = { 1: 3, 2: 15, 3: 60, 4: 240, 5: 480 };
const baseTokens: Record<number, number> = { 1: 1000, 2: 4000, 3: 15000, 4: 40000, 5: 80000 };

const taskMultipliers: Record<string, number> = {
  feature: 1.0,
  bugfix: 0.7,
  refactor: 0.8,
  documentation: 0.3,
  test: 0.5,
  security: 1.2,
  performance: 0.9,
  infrastructure: 0.6,
};

const factorMultipliers: Record<string, number> = {
  'external-dependency': 1.3,
  'security-impact': 1.5,
  'breaking-change': 1.4,
  'cross-platform': 1.2,
  'performance-critical': 1.3,
  'no-tests': 1.2,
  'legacy-code': 1.3,
};

interface Estimate {
  taskType: string;
  complexity: number;
  factors: string[];
  model: string;
  estimatedTime: string;
  estimatedMinutes: number;
  estimatedTokens: number;
  estimatedCost: number;
  confidence: string;
}

interface PRSize {
  size: string;
  filesChanged: number;
  linesChanged: number;
  reviewTime: string;
  mergeWindow: string;
  reviewersRequired: number;
}

function getEstimate(
  taskType: string,
  complexity: number,
  factors: string[],
  model: string,
): Estimate {
  const baseMins = baseTime[complexity] || 60;
  const taskMult = taskMultipliers[taskType] || 1.0;
  let factorMult = 1.0;
  const appliedFactors: string[] = [];

  for (const f of factors) {
    if (factorMultipliers[f]) {
      factorMult *= factorMultipliers[f];
      appliedFactors.push(f);
    }
  }

  const estimatedMinutes = Math.round(baseMins * taskMult * factorMult);
  const estimatedTokens = Math.round((baseTokens[complexity] || 15000) * taskMult * factorMult);

  const pricing = modelPricing[model] || modelPricing['claude-3.5-sonnet'];
  const inputRatio = 0.7;
  const outputRatio = 0.3;
  const inputCost = ((estimatedTokens * inputRatio) / 1000000) * pricing.input;
  const outputCost = ((estimatedTokens * outputRatio) / 1000000) * pricing.output;
  const estimatedCost = Math.round((inputCost + outputCost) * 10000) / 10000;

  const timeFormatted =
    estimatedMinutes < 60
      ? `${estimatedMinutes} min`
      : estimatedMinutes < 1440
        ? `${Math.round((estimatedMinutes / 60) * 10) / 10} hours`
        : `${Math.round((estimatedMinutes / 1440) * 10) / 10} days`;

  const confidence = complexity <= 2 ? 'high' : complexity <= 3 ? 'medium' : 'low';

  return {
    taskType,
    complexity,
    factors: appliedFactors,
    model,
    estimatedTime: timeFormatted,
    estimatedMinutes,
    estimatedTokens,
    estimatedCost,
    confidence,
  };
}

function getPRSize(filesChanged: number, linesChanged: number): PRSize {
  let size = 'XS';
  let reviewTime = '5 min';
  let mergeWindow = 'Same day';
  let reviewersRequired = 0;

  if (linesChanged > 1000 || filesChanged > 30) {
    size = 'XL';
    reviewTime = '2+ hours';
    mergeWindow = '3-5 days';
    reviewersRequired = 2;
  } else if (linesChanged > 500 || filesChanged > 15) {
    size = 'L';
    reviewTime = '1 hour';
    mergeWindow = '2-3 days';
    reviewersRequired = 2;
  } else if (linesChanged > 200 || filesChanged > 5) {
    size = 'M';
    reviewTime = '30 min';
    mergeWindow = '1-2 days';
    reviewersRequired = 1;
  } else if (linesChanged > 50 || filesChanged > 2) {
    size = 'S';
    reviewTime = '15 min';
    mergeWindow = 'Same day';
    reviewersRequired = 0;
  }

  return { size, filesChanged, linesChanged, reviewTime, mergeWindow, reviewersRequired };
}

function showReport(
  taskType: string,
  complexity: number,
  factors: string[],
  model: string,
  filesChanged: number,
  linesChanged: number,
  asJson: boolean,
  quiet: boolean,
): Estimate {
  const estimate = getEstimate(taskType, complexity, factors, model);
  const prSize = getPRSize(filesChanged, linesChanged);

  if (asJson) {
    console.log(JSON.stringify({ estimate, prSize }, null, 2));
    return estimate;
  }

  if (!quiet) {
    console.log(`\n=== Planning & Estimation Report ===`);
    console.log(`Task Type:     ${estimate.taskType}`);
    console.log(`Complexity:    ${estimate.complexity}/5`);
    if (estimate.factors.length > 0) console.log(`Factors:       ${estimate.factors.join(', ')}`);
    console.log(`Model:         ${estimate.model}`);
    console.log(`\n--- Estimate ---`);
    console.log(`Time:          ${estimate.estimatedTime}`);
    console.log(`Tokens:        ${estimate.estimatedTokens}`);
    console.log(`Cost:          $${estimate.estimatedCost}`);
    console.log(`Confidence:    ${estimate.confidence}`);
    console.log(`\n--- PR Classification ---`);
    console.log(`PR Size:       ${prSize.size}`);
    console.log(`Review Time:   ${prSize.reviewTime}`);
    console.log(`Merge Window:  ${prSize.mergeWindow}`);
    console.log(`Reviewers:     ${prSize.reviewersRequired}`);
    if (prSize.size === 'XL')
      console.log(`\n[WARN] XL PR detected — MUST split into smaller PRs (< 1000 lines)`);
    if (estimate.confidence === 'low')
      console.log(`[WARN] Low confidence estimate — consider breaking down into smaller tasks`);
  }

  return estimate;
}

function main(): void {
  const args = process.argv.slice(2);
  const action = args.includes('--action') ? args[args.indexOf('--action') + 1] : 'estimate';
  const taskType = args.includes('--task-type') ? args[args.indexOf('--task-type') + 1] : 'feature';
  const complexity = parseInt(
    args.includes('--complexity') ? args[args.indexOf('--complexity') + 1] : '3',
    10,
  );
  const filesChanged = parseInt(
    args.includes('--files-changed') ? args[args.indexOf('--files-changed') + 1] : '5',
    10,
  );
  const linesChanged = parseInt(
    args.includes('--lines-changed') ? args[args.indexOf('--lines-changed') + 1] : '200',
    10,
  );
  const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'claude-3.5-sonnet';
  const asJson = args.includes('--json');
  const quiet = args.includes('--quiet');
  const factorsStr = args.includes('--factors') ? args[args.indexOf('--factors') + 1] : '';
  const factors = factorsStr
    ? factorsStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const root =
    process.env.GENTLE_VANGUARD_BASE_DIR && existsSync(process.env.GENTLE_VANGUARD_BASE_DIR)
      ? process.env.GENTLE_VANGUARD_BASE_DIR
      : resolve(process.cwd());

  switch (action) {
    case 'estimate':
    case 'report':
      showReport(taskType, complexity, factors, model, filesChanged, linesChanged, asJson, quiet);
      break;
    case 'pr-size': {
      const prSize = getPRSize(filesChanged, linesChanged);
      if (asJson) console.log(JSON.stringify(prSize));
      else
        console.log(
          `PR Size: ${prSize.size} | Review: ${prSize.reviewTime} | Merge: ${prSize.mergeWindow} | Reviewers: ${prSize.reviewersRequired}`,
        );
      break;
    }
    case 'velocity': {
      const metricsFile = join(root, '.session', 'velocity-metrics.json');
      if (existsSync(metricsFile)) console.log(readFileSync(metricsFile, 'utf-8'));
      else console.log('No velocity data yet. Metrics will be collected as tasks are completed.');
      break;
    }
    default:
      console.error(`Unknown action: ${action}`);
      process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
