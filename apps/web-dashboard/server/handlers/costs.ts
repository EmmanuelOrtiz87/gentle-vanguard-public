/**
 * GET /api/costs — executive cost dashboard (F3.5).
 *
 * Aggregates historical token data from Nexus with reference pricing from
 * config/model-pricing.json and budgets from config/token-budget-guard.json.
 * The full aggregate is cached in-memory for 5 minutes (data is historical,
 * refreshed by the token-ingest daemon, not real-time).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import { DatabaseManager } from '../database/manager.ts';
import { makeCostReport, type CostReport } from '../cost-report.ts';

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; report: CostReport } | null = null;

export function clearCostReportCache(): void {
  cache = null;
}

export async function costsHandler(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: typeof import('../ws-hub/context.ts'),
  headers: Record<string, string>,
): Promise<boolean> {
  if (url.pathname !== '/api/costs' || req.method !== 'GET') return false;

  const fresh = cache && Date.now() - cache.at < CACHE_TTL_MS;
  if (!fresh) {
    try {
      const db = DatabaseManager.getInstance();
      cache = { at: Date.now(), report: makeCostReport(db.getDb()) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(503, headers);
      res.end(JSON.stringify({ error: 'nexus-unavailable', detail: msg }));
      return true;
    }
  }
  res.writeHead(200, headers);
  res.end(
    JSON.stringify({
      type: 'costs',
      cached: Boolean(fresh),
      data: cache?.report ?? null,
    }),
  );
  return true;
}
