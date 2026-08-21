#!/usr/bin/env node
/**
 * Cost Tracker — Track, attribute, and report AI token costs per agent/task/model.
 * TS migration of scripts/utilities/telemetry/TELEMETRY-METRICS/cost-tracker.ps1
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

interface CostEntry {
  timestamp: string;
  agent: string;
  taskType: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface DailyData {
  date: string;
  totalTokens: number;
  totalCostUsd: number;
  byAgent: Record<string, { tokens: number; cost: number; count: number }>;
  byModel: Record<string, { tokens: number; cost: number; count: number }>;
  byTaskType: Record<string, { tokens: number; cost: number; count: number }>;
  entries: CostEntry[];
}

const ROOT = resolve(process.cwd());

const modelPricing: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10.0 },
  'claude-3.5-sonnet': { input: 3.0, output: 15.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
};

const budgetLimits = {
  dailyCostUsd: 5.0,
  dailyTokens: 500000,
  agentLimits: {
    BA: { tokens: 50000, cost: 0.5 },
    SAD: { tokens: 80000, cost: 0.8 },
    DEV: { tokens: 100000, cost: 1.0 },
    QA: { tokens: 40000, cost: 0.4 },
    OPS: { tokens: 30000, cost: 0.3 },
    GOV: { tokens: 20000, cost: 0.2 },
  } as Record<string, { tokens: number; cost: number }>,
};

function findRepoRoot(dir: string): string {
  let current = resolve(dir);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(current, 'config', 'orchestrator.json'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return dir;
}

const root =
  process.env.GENTLE_VANGUARD_BASE_DIR && existsSync(process.env.GENTLE_VANGUARD_BASE_DIR)
    ? process.env.GENTLE_VANGUARD_BASE_DIR
    : findRepoRoot(ROOT);
const costDir = join(root, '.session', 'cost-tracking');
const dailyFile = join(costDir, 'daily.json');
const logFile = join(costDir, 'cost-log.jsonl');

function ensureDir(): void {
  if (!existsSync(costDir)) mkdirSync(costDir, { recursive: true });
}

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = modelPricing[model] || modelPricing['claude-3.5-sonnet'];
  const inputCost = (inputTokens / 1000000) * pricing.input;
  const outputCost = (outputTokens / 1000000) * pricing.output;
  return Math.round((inputCost + outputCost) * 1000000) / 1000000;
}

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDailyData(): DailyData {
  ensureDir();
  if (existsSync(dailyFile)) {
    try {
      return JSON.parse(readFileSync(dailyFile, 'utf-8'));
    } catch {
      /* ignore */
    }
  }
  return {
    date: getTodayKey(),
    totalTokens: 0,
    totalCostUsd: 0,
    byAgent: {},
    byModel: {},
    byTaskType: {},
    entries: [],
  };
}

function saveDailyData(data: DailyData): void {
  ensureDir();
  writeFileSync(dailyFile, JSON.stringify(data, null, 2), 'utf-8');
}

function checkBudgetAlerts(daily: DailyData, agent: string): void {
  if (daily.totalCostUsd > budgetLimits.dailyCostUsd) {
    console.warn(
      `[BUDGET] Daily cost limit exceeded: $${daily.totalCostUsd} / $${budgetLimits.dailyCostUsd}`,
    );
  }
  if (daily.totalTokens > budgetLimits.dailyTokens) {
    console.warn(
      `[BUDGET] Daily token limit exceeded: ${daily.totalTokens} / ${budgetLimits.dailyTokens}`,
    );
  }
  const agentLimit = budgetLimits.agentLimits[agent];
  if (agentLimit && daily.byAgent[agent] && daily.byAgent[agent].cost > agentLimit.cost) {
    console.warn(
      `[BUDGET] Agent ${agent} cost limit exceeded: $${daily.byAgent[agent].cost} / $${agentLimit.cost}`,
    );
  }
}

function logEntry(
  agent: string,
  taskType: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  quiet: boolean,
): void {
  const cost = calculateCost(model, inputTokens, outputTokens);
  const totalTokens = inputTokens + outputTokens;
  const today = getTodayKey();
  let daily = getDailyData();

  if (daily.date !== today) {
    daily = {
      date: today,
      totalTokens: 0,
      totalCostUsd: 0,
      byAgent: {},
      byModel: {},
      byTaskType: {},
      entries: [],
    };
  }

  daily.totalTokens += totalTokens;
  daily.totalCostUsd = Math.round((daily.totalCostUsd + cost) * 1000000) / 1000000;

  if (!daily.byAgent[agent]) daily.byAgent[agent] = { tokens: 0, cost: 0, count: 0 };
  daily.byAgent[agent].tokens += totalTokens;
  daily.byAgent[agent].cost = Math.round((daily.byAgent[agent].cost + cost) * 1000000) / 1000000;
  daily.byAgent[agent].count++;

  if (!daily.byModel[model]) daily.byModel[model] = { tokens: 0, cost: 0, count: 0 };
  daily.byModel[model].tokens += totalTokens;
  daily.byModel[model].cost = Math.round((daily.byModel[model].cost + cost) * 1000000) / 1000000;
  daily.byModel[model].count++;

  if (!daily.byTaskType[taskType]) daily.byTaskType[taskType] = { tokens: 0, cost: 0, count: 0 };
  daily.byTaskType[taskType].tokens += totalTokens;
  daily.byTaskType[taskType].cost =
    Math.round((daily.byTaskType[taskType].cost + cost) * 1000000) / 1000000;
  daily.byTaskType[taskType].count++;

  const entry: CostEntry = {
    timestamp: new Date().toISOString(),
    agent,
    taskType,
    model,
    inputTokens,
    outputTokens,
    costUsd: cost,
  };
  daily.entries.push(entry);
  if (daily.entries.length > 100) daily.entries = daily.entries.slice(-100);

  saveDailyData(daily);
  appendFileSync(logFile, JSON.stringify(entry) + '\n', 'utf-8');

  checkBudgetAlerts(daily, agent);
  if (!quiet)
    console.log(
      `[COST] Logged: ${agent}/${taskType} | ${model} | ${totalTokens} tokens | $${cost}`,
    );
}

function showStatus(asJson: boolean, quiet: boolean): void {
  const daily = getDailyData();
  if (asJson) {
    console.log(JSON.stringify(daily, null, 2));
    return;
  }
  if (quiet) return;

  console.log(`\n=== Cost Status — ${daily.date} ===`);
  console.log(`Total Tokens:    ${daily.totalTokens} / ${budgetLimits.dailyTokens}`);
  console.log(`Total Cost:      $${daily.totalCostUsd} / $${budgetLimits.dailyCostUsd}`);

  if (Object.keys(daily.byAgent).length > 0) {
    console.log(`\n--- By Agent ---`);
    for (const [agent, data] of Object.entries(daily.byAgent).sort(
      (a, b) => b[1].cost - a[1].cost,
    )) {
      console.log(`  ${agent}: ${data.count} calls | ${data.tokens} tokens | $${data.cost}`);
    }
  }
  if (Object.keys(daily.byModel).length > 0) {
    console.log(`\n--- By Model ---`);
    for (const [model, data] of Object.entries(daily.byModel).sort(
      (a, b) => b[1].cost - a[1].cost,
    )) {
      console.log(`  ${model}: ${data.count} calls | ${data.tokens} tokens | $${data.cost}`);
    }
  }

  const costPct =
    budgetLimits.dailyCostUsd > 0
      ? Math.round((daily.totalCostUsd / budgetLimits.dailyCostUsd) * 100)
      : 0;
  const tokenPct =
    budgetLimits.dailyTokens > 0
      ? Math.round((daily.totalTokens / budgetLimits.dailyTokens) * 100)
      : 0;
  console.log(`\n--- Budget Utilization ---`);
  console.log(`  Cost:   ${costPct}%`);
  console.log(`  Tokens: ${tokenPct}%`);
}

function resetCounters(quiet: boolean): void {
  const today = getTodayKey();
  const daily: DailyData = {
    date: today,
    totalTokens: 0,
    totalCostUsd: 0,
    byAgent: {},
    byModel: {},
    byTaskType: {},
    entries: [],
  };
  saveDailyData(daily);
  if (!quiet) console.log(`[COST] Daily counters reset for ${today}`);
}

function main(): void {
  const args = process.argv.slice(2);
  const action = args.includes('--action') ? args[args.indexOf('--action') + 1] : 'status';
  const agent = args.includes('--agent') ? args[args.indexOf('--agent') + 1] : 'unknown';
  const taskType = args.includes('--task-type') ? args[args.indexOf('--task-type') + 1] : 'unknown';
  const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'claude-3.5-sonnet';
  const inputTokens = parseInt(
    args.includes('--input-tokens') ? args[args.indexOf('--input-tokens') + 1] : '0',
    10,
  );
  const outputTokens = parseInt(
    args.includes('--output-tokens') ? args[args.indexOf('--output-tokens') + 1] : '0',
    10,
  );
  const asJson = args.includes('--json');
  const quiet = args.includes('--quiet');

  switch (action) {
    case 'log':
      logEntry(agent, taskType, model, inputTokens, outputTokens, quiet);
      break;
    case 'status':
    case 'report':
      showStatus(asJson, quiet);
      break;
    case 'reset':
      resetCounters(quiet);
      break;
    default:
      console.error(`Unknown action: ${action}`);
      process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
