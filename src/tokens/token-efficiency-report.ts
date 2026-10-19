#!/usr/bin/env node
/** Read-only token efficiency report grouped by model and agent. */
import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface EfficiencyRow {
  model: string;
  agent: string;
  samples: number;
  totalTokens: number;
  averageTokens: number;
  p50Tokens: number;
  p95Tokens: number;
  cacheReadTokens: number;
  cacheReadRatio: number;
  attention: 'normal' | 'review-context' | 'insufficient-samples';
}

export interface ReviewContextDiagnostic {
  model: string;
  agent: string;
  samples: number;
  baselineAverageTokens: number;
  baselineP95Tokens: number;
  cacheReadRatio: number;
  targetAverageTokens: number;
  targetP95Tokens: number;
  projectedAverageTokens: number;
  projectedP95Tokens: number;
  estimatedSavingsTokens: number;
  estimatedReductionPct: number;
  compressionPlan: string[];
}

export interface TokenSavingsRow {
  category: string;
  savedTokens: number;
  samples: number;
  latestAt: string | null;
}

export interface RealizedTokenSavings {
  categories: TokenSavingsRow[];
  totalSavedTokens: number;
  contextOptimizationSavedTokens: number;
  responseCacheSavedTokens: number;
}

export interface ProviderLatencyDiagnostic {
  provider: string;
  model: string;
  operation: string;
  samples: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  errorRate: number;
}

export function percentile(values: number[], value: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((value / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function parseAttributes(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function looksLikeProviderTrace(name: string, model: string | null, attrs: Record<string, unknown>): boolean {
  if (model?.trim()) return true;
  if (firstString(attrs.provider, attrs.providerId, attrs.llmProvider, attrs.model, attrs.modelId)) {
    return true;
  }
  return /(?:^|[.:/-])(llm|provider|chat|completion|gemini|opencode|cloud)(?:$|[.:/-])/i.test(name);
}

export function collectProviderLatencyDiagnostics(
  db: Database.Database,
  options: { windowDays?: number; minSamples?: number } = {},
): ProviderLatencyDiagnostic[] {
  const windowDays = options.windowDays ?? 30;
  const minSamples = options.minSamples ?? 1;
  const cutoffMs = Date.now() - windowDays * 86_400_000;
  const rows = db
    .prepare(
      `SELECT name,
              model,
              duration,
              status,
              attributes
       FROM traces
       WHERE tenant_id = ? AND start_time >= ? AND COALESCE(duration, 0) > 0`,
    )
    .all('gentle-vanguard', cutoffMs) as Array<{
    name: string;
    model: string | null;
    duration: number;
    status: string | null;
    attributes: string | null;
  }>;

  const groups = new Map<
    string,
    {
      provider: string;
      model: string;
      operation: string;
      durations: number[];
      errors: number;
    }
  >();

  for (const row of rows) {
    const attrs = parseAttributes(row.attributes);
    if (!looksLikeProviderTrace(row.name, row.model, attrs)) continue;
    const provider =
      firstString(attrs.provider, attrs.providerId, attrs.llmProvider, attrs.source) ?? row.name;
    const model = firstString(row.model, attrs.model, attrs.modelId) ?? 'unknown';
    const operation = firstString(attrs.operation, attrs.kind) ?? row.name;
    const key = `${provider}\u0000${model}\u0000${operation}`;
    const group =
      groups.get(key) ?? { provider, model, operation, durations: [], errors: 0 };
    group.durations.push(Math.max(0, Number(row.duration) || 0));
    if (/^(?:error|failed|failure)$/i.test(row.status ?? '')) group.errors += 1;
    groups.set(key, group);
  }

  return [...groups.values()]
    .filter((group) => group.durations.length >= minSamples)
    .map((group) => ({
      provider: group.provider,
      model: group.model,
      operation: group.operation,
      samples: group.durations.length,
      p50Ms: percentile(group.durations, 50),
      p95Ms: percentile(group.durations, 95),
      maxMs: Math.max(...group.durations),
      errorRate: Number((group.errors / group.durations.length).toFixed(4)),
    }))
    .sort((a, b) => b.p95Ms - a.p95Ms);
}

export function reviewContextDiagnostics(
  rows: EfficiencyRow[],
  options: { targetAverageTokens?: number; targetP95Tokens?: number } = {},
): ReviewContextDiagnostic[] {
  const targetAverageTokens = options.targetAverageTokens ?? 80_000;
  const targetP95Tokens = options.targetP95Tokens ?? 180_000;

  return rows
    .filter((row) => row.attention === 'review-context')
    .map((row) => {
      const projectedAverageTokens = Math.min(row.averageTokens, targetAverageTokens);
      const projectedP95Tokens = Math.min(row.p95Tokens, targetP95Tokens);
      const estimatedSavingsTokens = Math.max(
        0,
        (row.averageTokens - projectedAverageTokens) * row.samples,
      );
      const estimatedReductionPct =
        row.averageTokens > 0
          ? Number(
              (((row.averageTokens - projectedAverageTokens) / row.averageTokens) * 100).toFixed(1),
            )
          : 0;

      return {
        model: row.model,
        agent: row.agent,
        samples: row.samples,
        baselineAverageTokens: row.averageTokens,
        baselineP95Tokens: row.p95Tokens,
        cacheReadRatio: row.cacheReadRatio,
        targetAverageTokens,
        targetP95Tokens,
        projectedAverageTokens,
        projectedP95Tokens,
        estimatedSavingsTokens,
        estimatedReductionPct,
        compressionPlan: [
          'Keep system invariants, task acceptance criteria, commands, paths, versions, and errors verbatim.',
          'Replace repeated historical prose, duplicated logs, and already-confirmed context with short cited summaries.',
          'Prefer bounded file excerpts and metric snapshots over full transcript or report dumps.',
          'Track realized savings through Nexus token_savings categories context-compaction and delegation-compression.',
          'Measure again with token:efficiency after the next real provider window.',
        ],
      } satisfies ReviewContextDiagnostic;
    })
    .sort((a, b) => b.estimatedSavingsTokens - a.estimatedSavingsTokens);
}

export function summarizeRealizedTokenSavings(rows: TokenSavingsRow[]): RealizedTokenSavings {
  const totalSavedTokens = rows.reduce((sum, row) => sum + row.savedTokens, 0);
  const contextOptimizationSavedTokens = rows
    .filter((row) => row.category === 'context-compaction' || row.category === 'delegation-compression')
    .reduce((sum, row) => sum + row.savedTokens, 0);
  const responseCacheSavedTokens = rows
    .filter((row) => row.category === 'response-cache')
    .reduce((sum, row) => sum + row.savedTokens, 0);

  return {
    categories: [...rows].sort((a, b) => b.savedTokens - a.savedTokens),
    totalSavedTokens,
    contextOptimizationSavedTokens,
    responseCacheSavedTokens,
  };
}

export function collectRealizedTokenSavings(
  db: Database.Database,
  options: { windowDays?: number } = {},
): RealizedTokenSavings {
  const windowDays = options.windowDays ?? 30;
  const cutoff = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const rows = db
    .prepare(
      `SELECT COALESCE(NULLIF(category, ''), 'unknown') category,
              COALESCE(SUM(saved_tokens), 0) saved_tokens,
              COUNT(*) samples,
              MAX(created_at) latest_at
       FROM token_savings
       WHERE tenant_id = ? AND created_at >= ?
       GROUP BY COALESCE(NULLIF(category, ''), 'unknown')`,
    )
    .all('gentle-vanguard', cutoff) as Array<{
    category: string;
    saved_tokens: number;
    samples: number;
    latest_at: string | null;
  }>;

  return summarizeRealizedTokenSavings(
    rows.map((row) => ({
      category: row.category,
      savedTokens: Math.max(0, row.saved_tokens),
      samples: row.samples,
      latestAt: row.latest_at,
    })),
  );
}

export function collectTokenEfficiency(
  db: Database.Database,
  options: { windowDays?: number; minSamples?: number } = {},
): EfficiencyRow[] {
  const windowDays = options.windowDays ?? 30;
  const minSamples = options.minSamples ?? 20;
  const cutoff = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const rows = db
    .prepare(
      `SELECT COALESCE(NULLIF(model, ''), 'unknown') model,
              COALESCE(NULLIF(agent, ''), 'unknown') agent,
              COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) + COALESCE(reasoning_tokens, 0) total,
              COALESCE(cache_read_tokens, 0) cache_read
       FROM token_transactions
       WHERE tenant_id = ? AND created_at >= ?`,
    )
    .all('gentle-vanguard', cutoff) as Array<{
    model: string;
    agent: string;
    total: number;
    cache_read: number;
  }>;

  const groups = new Map<
    string,
    { model: string; agent: string; values: number[]; cache: number }
  >();
  for (const row of rows) {
    const key = `${row.model}\u0000${row.agent}`;
    const group = groups.get(key) ?? { model: row.model, agent: row.agent, values: [], cache: 0 };
    group.values.push(Math.max(0, row.total));
    group.cache += Math.max(0, row.cache_read);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => {
      const totalTokens = group.values.reduce((sum, value) => sum + value, 0);
      const averageTokens = Math.round(totalTokens / group.values.length);
      // cache_read_tokens is reported as a separate provider dimension and is
      // not necessarily included in input_tokens, so it must not be subtracted
      // from totalTokens when deriving a bounded diagnostic ratio.
      const observedTokens = Math.max(1, totalTokens + group.cache);
      return {
        model: group.model,
        agent: group.agent,
        samples: group.values.length,
        totalTokens,
        averageTokens,
        p50Tokens: percentile(group.values, 50),
        p95Tokens: percentile(group.values, 95),
        cacheReadTokens: group.cache,
        cacheReadRatio: Number((group.cache / observedTokens).toFixed(4)),
        attention:
          group.values.length < minSamples
            ? 'insufficient-samples'
            : averageTokens >= 100_000 || percentile(group.values, 95) >= 250_000
              ? 'review-context'
              : 'normal',
      } satisfies EfficiencyRow;
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);
}

function main(): void {
  const db = new Database(resolve('.runtime', 'gentle-vanguard.db'), { readonly: true });
  try {
    const rows = collectTokenEfficiency(db);
    const diagnostics = reviewContextDiagnostics(rows);
    const realizedSavings = collectRealizedTokenSavings(db);
    const providerLatency = collectProviderLatencyDiagnostics(db);
    const report = {
      generatedAt: new Date().toISOString(),
      source: 'nexus',
      readOnly: true,
      rows,
      reviewContext: rows.filter((row) => row.attention === 'review-context').length,
      reviewContextDiagnostics: diagnostics,
      realizedSavings,
      providerLatency,
    };
    mkdirSync(resolve('reports', 'audits'), { recursive: true });
    writeFileSync(
      join(resolve('reports', 'audits'), 'token-efficiency-latest.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`Token efficiency (read-only): ${rows.length} model/agent groups`);
      for (const row of rows.slice(0, 15)) {
        console.log(
          `  ${row.attention.padEnd(18)} ${row.model}/${row.agent}: avg=${row.averageTokens} p95=${row.p95Tokens} samples=${row.samples}`,
        );
      }
      if (providerLatency.length > 0) {
        console.log(`Provider latency: ${providerLatency.length} groups`);
        for (const row of providerLatency.slice(0, 10)) {
          console.log(
            `  ${row.provider}/${row.model}/${row.operation}: p50=${row.p50Ms}ms p95=${row.p95Ms}ms samples=${row.samples}`,
          );
        }
      }
    }
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
