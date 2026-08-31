import { existsSync, readFileSync } from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import type { URL } from 'url';
import { DatabaseManager } from '../database/manager.ts';
import {
  getTraces,
  getCloudMetrics,
  getSkillUsageFromDb,
  getTokenUsageFromDb,
  getContractResultsFromDb,
  getRoutingRulesFromDb,
} from '../real-data.ts';
import {
  readJsonBody,
  RequestBodyTooLargeError,
  ALERTS_CONFIG_PATH,
  deploymentTenant,
} from '../ws-hub/context.ts';
import { generateMetrics } from '../ws-hub/metrics.ts';

export async function observabilityHandler(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: typeof import('../ws-hub/context.ts'),
  headers: Record<string, string>,
): Promise<boolean> {
  if (url.pathname === '/api/traces') {
    const rangeParam = url.searchParams.get('range') || '';
    const rangeMs =
      rangeParam === '1h'
        ? 3_600_000
        : rangeParam === '24h'
          ? 86_400_000
          : rangeParam === '7d'
            ? 604_800_000
            : 0;
    res.writeHead(200, headers);
    res.end(JSON.stringify(getTraces(rangeMs, deploymentTenant.tenantId)));
    return true;
  }

  if (url.pathname === '/api/feedback' && req.method === 'POST') {
    try {
      const { traceId, spanId, type } = await readJsonBody<{
        traceId?: string;
        spanId?: string;
        type?: string;
      }>(req);
      if (!traceId || !spanId || !type) {
        res.writeHead(400, headers);
        res.end(JSON.stringify({ error: 'traceId, spanId, type required' }));
        return true;
      }
      if (type !== 'up' && type !== 'down') {
        res.writeHead(400, headers);
        res.end(JSON.stringify({ error: 'type must be up or down' }));
        return true;
      }
      const db = DatabaseManager.getInstance();
      db.traces.insertFeedback(deploymentTenant.tenantId ?? 'gentle-vanguard', {
        trace_id: traceId,
        span_id: spanId,
        type,
      });
      const stats = db.traces.getFeedbackStats(deploymentTenant.tenantId ?? 'gentle-vanguard');
      res.writeHead(200, headers);
      res.end(JSON.stringify({ ok: true, score: stats.score }));
    } catch (e) {
      res.writeHead(e instanceof RequestBodyTooLargeError ? 413 : 400, headers);
      res.end(
        JSON.stringify({
          error: e instanceof RequestBodyTooLargeError ? 'Request body too large' : 'Invalid JSON',
        }),
      );
    }
    return true;
  }

  if (url.pathname === '/api/alerts') {
    let alerts: Record<string, unknown>[] = [];
    try {
      if (existsSync(ALERTS_CONFIG_PATH)) {
        const config = JSON.parse(readFileSync(ALERTS_CONFIG_PATH, 'utf-8'));
        const metrics = generateMetrics();
        alerts = Object.entries(config.rules || {})
          .filter(([, rule]: [string, any]) => rule.enabled !== false)
          .map(([name, rule]: [string, any]) => {
            const actual = rule.metric
              .split('.')
              .reduce((obj: any, key: string) => obj?.[key], metrics as any);
            const below = rule.direction === 'below';
            const triggered =
              typeof actual === 'number' &&
              typeof rule.threshold === 'number' &&
              (below ? actual <= rule.threshold : actual >= rule.threshold);
            return {
              name,
              rule: rule.label || name,
              actual: actual ?? 0,
              threshold: rule.threshold,
              severity: rule.severity || 'info',
              triggered,
              unit: rule.unit || '',
            };
          });
      }
    } catch {
      /* best-effort */
    }
    res.writeHead(200, headers);
    res.end(JSON.stringify({ alerts }));
    return true;
  }

  if (url.pathname === '/api/cloud/metrics') {
    res.writeHead(200, headers);
    res.end(JSON.stringify({ type: 'cloud', data: getCloudMetrics() }));
    return true;
  }

  // ─── Stack Tables API (Wave 37: SQLite-backed) ─────────────────────
  if (url.pathname === '/api/skill-usage') {
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    res.writeHead(200, headers);
    res.end(
      JSON.stringify({
        type: 'skill-usage',
        data: getSkillUsageFromDb(limit, deploymentTenant.tenantId),
      }),
    );
    return true;
  }

  if (url.pathname === '/api/token-usage') {
    const sessionId = url.searchParams.get('sessionId') || undefined;
    res.writeHead(200, headers);
    res.end(
      JSON.stringify({
        type: 'token-usage',
        data: getTokenUsageFromDb(sessionId, deploymentTenant.tenantId),
      }),
    );
    return true;
  }

  if (url.pathname === '/api/contract-results') {
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    res.writeHead(200, headers);
    res.end(JSON.stringify({ type: 'contract-results', data: getContractResultsFromDb(limit) }));
    return true;
  }

  if (url.pathname === '/api/routing-rules') {
    res.writeHead(200, headers);
    res.end(
      JSON.stringify({
        type: 'routing-rules',
        data: getRoutingRulesFromDb(deploymentTenant.tenantId),
      }),
    );
    return true;
  }

  return false;
}
