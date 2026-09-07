import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import { join, dirname } from 'path';
import type { URL } from 'url';
import { DatabaseManager } from '../database/manager.ts';
import { ROOT } from '../shared.ts';
import { runValidations } from '../validations.ts';
import { getMetricHistory } from '../real-data.ts';
import {
  readJsonBody,
  RequestBodyTooLargeError,
  bridgeReady,
  bridgeToolCount,
  clients,
  deploymentTenant,
} from '../ws-hub/context.ts';
import {
  generateMetrics,
  readAuditEntries,
  prometheusMetrics,
  getTenantSloObjectives,
  calculateBurnRate,
} from '../ws-hub/metrics.ts';

// SLO metrics endpoint — GET returns latest, POST stores from perf:slo
const SLO_PATH = join(ROOT, '.runtime', 'metrics', 'slo-latest.json');

export async function metricsHandler(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: typeof import('../ws-hub/context.ts'),
  headers: Record<string, string>,
): Promise<boolean> {
  if (url.pathname === '/api/metrics') {
    const tenantIdParam = url.searchParams.get('tenantId');
    const tenantId = typeof tenantIdParam === 'string' ? tenantIdParam : undefined;
    res.writeHead(200, headers);
    res.end(JSON.stringify({ type: 'metrics', data: generateMetrics(tenantId) }));
    return true;
  }

  if (url.pathname === '/api/sse/metrics') {
    res.writeHead(200, {
      ...headers,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    const send = () => {
      res.write(
        `event: metrics\ndata: ${JSON.stringify({ type: 'metrics', data: generateMetrics() })}\n\n`,
      );
    };
    send();
    const interval = setInterval(send, 5000);
    req.on('close', () => clearInterval(interval));
    return true;
  }

  if (url.pathname === '/api/metrics/history') {
    const requested = Number(url.searchParams.get('limit') || 120);
    const requestedRange = url.searchParams.get('range');
    const ranges = new Set(['5m', '1h', '24h', '7d', '30d']);
    const range =
      requestedRange && ranges.has(requestedRange)
        ? (requestedRange as '5m' | '1h' | '24h' | '7d' | '30d')
        : undefined;
    res.writeHead(200, headers);
    res.end(
      JSON.stringify({
        type: 'metrics_history',
        range: range || 'all',
        data: getMetricHistory(requested, range),
      }),
    );
    return true;
  }

  if (url.pathname === '/metrics' || url.pathname === '/api/metrics/prometheus') {
    res.writeHead(200, {
      ...headers,
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    });
    res.end(prometheusMetrics());
    return true;
  }

  if (url.pathname === '/api/audit') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 500);
    const query = url.searchParams.get('q') || '';
    res.writeHead(200, headers);
    res.end(
      JSON.stringify({
        success: true,
        data: { entries: readAuditEntries(limit, query), query, limit },
      }),
    );
    return true;
  }

  if (url.pathname === '/api/slo' && req.method === 'POST') {
    try {
      const data = await readJsonBody<Record<string, unknown>>(req);
      mkdirSync(dirname(SLO_PATH), { recursive: true });
      writeFileSync(
        SLO_PATH,
        JSON.stringify({ ...data, ingested: new Date().toISOString() }, null, 2),
      );
      res.writeHead(200, headers);
      res.end(JSON.stringify({ success: true }));
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

  if (url.pathname === '/api/validations') {
    // HTTP fallback so Validaciones en vivo has data on first paint
    // (WS broadcast remains the live source afterwards).
    res.writeHead(200, headers);
    try {
      const validations = runValidations(bridgeReady, bridgeToolCount, clients.size);
      res.end(JSON.stringify({ type: 'validations', data: validations }));
    } catch {
      res.end(JSON.stringify({ type: 'validations', data: [] }));
    }
    return true;
  }

  if (url.pathname === '/api/slo') {
    let sloData = existsSync(SLO_PATH) ? JSON.parse(readFileSync(SLO_PATH, 'utf8')) : null;
    // No SLO file → compute live SLOs from real Nexus data so the panel
    // always reflects actual stack health instead of "waiting".
    if (!sloData) {
      try {
        const db = DatabaseManager.getInstance();
        const sql = db.getDb();
        const traceStats = sql
          .prepare(
            "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors FROM traces WHERE tenant_id = ?",
          )
          .get(deploymentTenant.tenantId) as { total: number; errors: number | null };
        const lat = db.traces.getLatencyStats(deploymentTenant.tenantId ?? 'gentle-vanguard');
        const lastSpan = sql
          .prepare('SELECT MAX(start_time) AS last FROM traces WHERE tenant_id = ?')
          .get(deploymentTenant.tenantId) as {
          last: number | null;
        };
        const alertRows = sql
          .prepare(
            'SELECT COUNT(DISTINCT name) AS total, SUM(CASE WHEN triggered = 1 THEN 1 ELSE 0 END) AS fired FROM alerts WHERE tenant_id = ? AND id IN (SELECT MAX(id) FROM alerts WHERE tenant_id = ? GROUP BY name)',
          )
          .get(deploymentTenant.tenantId, deploymentTenant.tenantId) as {
          total: number;
          fired: number | null;
        };

        const mk = (name: string, current: number, threshold: number, unit: string): any => ({
          name,
          current,
          threshold,
          unit,
          status: current <= threshold ? 'PASS' : current <= threshold * 2 ? 'WARN' : 'FAIL',
        });
        const errorRatePct =
          traceStats.total > 0 ? ((traceStats.errors ?? 0) / traceStats.total) * 100 : 0;
        const freshnessMin = lastSpan.last
          ? Math.round((Date.now() - lastSpan.last) / 60000)
          : 9999;
        const alertFiredPct =
          alertRows.total > 0 ? ((alertRows.fired ?? 0) / alertRows.total) * 100 : 0;

        const checks = [
          mk('trace_error_rate_pct', Number(errorRatePct.toFixed(2)), 5, '%'),
          mk('latency_p95_ms', lat.p95, 60000, 'ms'),
          mk('telemetry_freshness_min', freshnessMin, 60, 'min'),
          mk('alerts_firing_pct', Number(alertFiredPct.toFixed(2)), 30, '%'),
        ];
        sloData = {
          timestamp: new Date().toISOString(),
          passed: checks.every((c) => c.status === 'PASS'),
          overall: {
            total: checks.length,
            passed: checks.filter((c) => c.status === 'PASS').length,
            warned: checks.filter((c) => c.status === 'WARN').length,
            failed: checks.filter((c) => c.status === 'FAIL').length,
          },
          checks,
        };
      } catch {
        sloData = null;
      }
    }
    res.writeHead(200, headers);
    res.end(JSON.stringify({ type: 'slo', data: sloData }));
    return true;
  }

  if (url.pathname === '/api/slo/burn-rate') {
    const tenantParam = url.searchParams.get('tenant') || undefined;
    const objectives = getTenantSloObjectives(tenantParam);
    res.writeHead(200, headers);
    res.end(
      JSON.stringify({
        success: true,
        data: {
          tenant: tenantParam ?? deploymentTenant.tenantId,
          target: objectives.availabilityTargetPct,
          errorBudget: objectives.errorBudgetPct,
          latencyTargetMs: objectives.latencyTargetMs,
          windows: calculateBurnRate(tenantParam),
        },
      }),
    );
    return true;
  }

  if (url.pathname === '/api/tenants') {
    res.writeHead(200, headers);
    res.end(
      JSON.stringify({
        tenants: deploymentTenant.configured
          ? [
              {
                id: deploymentTenant.tenantId,
                name: deploymentTenant.tenantName,
                isDefault: true,
              },
            ]
          : [],
      }),
    );
    return true;
  }

  return false;
}
