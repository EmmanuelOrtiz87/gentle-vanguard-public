#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

interface EnforceErrorBudgetArgs {
  configPath: string;
  service: string;
  json: boolean;
}

interface ErrorBudget {
  budget_seconds?: number;
  budget_runs?: number;
  slo?: string;
  period_days?: number;
}

interface Consumption {
  Service?: string;
  consumed_seconds?: number;
  consumed_runs?: number;
}

interface BudgetState {
  Service: string;
  Ratio: number;
  State: string;
  Budget?: string;
  PeriodDays?: number;
}

interface ErrorBudgetConfig {
  error_budgets: Record<string, ErrorBudget>;
}

function parseArgs(): EnforceErrorBudgetArgs {
  const raw = process.argv.slice(2);
  return {
    configPath: extractArg(raw, '--config-path') || resolve('config/sre-error-budgets.json'),
    service: extractArg(raw, '--service') || 'all',
    json: raw.includes('--json'),
  };
}

function extractArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function getErrorBudgetState(budget: ErrorBudget, currentConsumption: Consumption): BudgetState {
  let ratio = 0;
  if (budget.budget_seconds && budget.budget_seconds > 0) {
    ratio = (currentConsumption.consumed_seconds || 0) / budget.budget_seconds;
  } else if (budget.budget_runs && budget.budget_runs > 0) {
    ratio = (currentConsumption.consumed_runs || 0) / budget.budget_runs;
  }

  let state: string;
  if (ratio > 0.9) state = 'EXHAUSTED';
  else if (ratio > 0.75) state = 'CRITICAL';
  else if (ratio > 0.5) state = 'WARNING';
  else state = 'HEALTHY';

  return {
    Service: currentConsumption.Service || 'unknown',
    Ratio: Math.round(ratio * 10000) / 10000,
    State: state,
    Budget: budget.slo,
    PeriodDays: budget.period_days,
  };
}

function tryReadJson(p: string): Record<string, unknown> | null {
  try {
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  } catch { /* ignore */ }
  return null;
}

function main(): void {
  const args = parseArgs();

  if (!existsSync(args.configPath)) {
    console.error(`Config not found: ${args.configPath}`);
    process.exit(1);
  }

  let config: ErrorBudgetConfig;
  try {
    config = JSON.parse(readFileSync(args.configPath, 'utf8'));
  } catch {
    console.error(`Invalid config JSON: ${args.configPath}`);
    process.exit(1);
  }

  const results: BudgetState[] = [];
  let exitCode = 0;

  for (const [serviceName, budget] of Object.entries(config.error_budgets || {})) {
    if (args.service !== 'all' && args.service !== serviceName) continue;

    const consumptionPath = `.runtime/sre/${serviceName}-consumption.json`;
    let consumption: Consumption = { Service: serviceName, consumed_seconds: 0, consumed_runs: 0 };

    const consData = tryReadJson(consumptionPath);
    if (consData) {
      consumption = {
        Service: (consData.Service as string) || serviceName,
        consumed_seconds: (consData.consumed_seconds as number) || 0,
        consumed_runs: (consData.consumed_runs as number) || 0,
      };
    }

    const state = getErrorBudgetState(budget, consumption);
    results.push(state);

    switch (state.State) {
      case 'EXHAUSTED':
        console.error(`[SRE] Error budget EXHAUSTED for '${serviceName}' (ratio: ${state.Ratio})`);
        exitCode = 1;
        break;
      case 'CRITICAL':
        console.warn(`[SRE] Error budget CRITICAL for '${serviceName}' (ratio: ${state.Ratio})`);
        break;
      case 'WARNING':
        console.warn(`[SRE] Error budget WARNING for '${serviceName}' (ratio: ${state.Ratio})`);
        break;
      case 'HEALTHY':
        console.log(`[SRE] Error budget HEALTHY for '${serviceName}' (ratio: ${state.Ratio})`);
        break;
    }
  }

  if (args.json) {
    console.log(JSON.stringify(results));
  }

  process.exit(exitCode);
}

main();
