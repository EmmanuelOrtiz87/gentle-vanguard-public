import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ROOT } from '../shared.ts';

// ─── Stack Capabilities (Fase 1/2: anomalies, circuit breakers, DB healing) ────

export const ANOMALY_STATE_PATH = join(ROOT, '.runtime', 'anomaly-state.json');
export const ANOMALY_ALERTS_PATH = join(ROOT, '.runtime', 'anomaly-alerts.json');
export const CIRCUIT_BREAKER_STATE_PATH = join(
  ROOT,
  '.runtime',
  'circuit-breaker-v2',
  'state.json',
);
export const DB_HEALING_STATE_PATH = join(ROOT, '.runtime', 'db-healing', 'state.json');

export function getStackCapabilities() {
  const empty: ReturnType<typeof buildStackCapabilities> = buildStackCapabilities(
    undefined,
    undefined,
    undefined,
  );
  try {
    const anomalyState = existsSync(ANOMALY_STATE_PATH)
      ? (JSON.parse(readFileSync(ANOMALY_STATE_PATH, 'utf-8')) as {
          predictions?: Array<{ type: string; probability: number; timeToOccurrence: number }>;
          lastAlert: number;
          alertCount: number;
        })
      : undefined;

    const anomalyAlerts = existsSync(ANOMALY_ALERTS_PATH)
      ? (JSON.parse(readFileSync(ANOMALY_ALERTS_PATH, 'utf-8')) as {
          alerts?: Array<{
            id: string;
            type: 'CRITICAL' | 'WARNING' | 'PREDICTION';
            category: string;
            message: string;
            confidence: number;
            detectedAt: string;
            recommendation?: string;
            autoHealed?: boolean;
            autoHealingAction?: string;
          }>;
        })
      : undefined;

    const circuitState = existsSync(CIRCUIT_BREAKER_STATE_PATH)
      ? (JSON.parse(readFileSync(CIRCUIT_BREAKER_STATE_PATH, 'utf-8')) as Record<
          string,
          {
            name: string;
            state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
            config: {
              failureThreshold: number;
              successThreshold: number;
              resetTimeout: number;
            };
            metrics: { failures: number; successes: number };
            openedAt: number | null;
            lastStateChange: number;
          }
        >)
      : undefined;

    const dbHealing = existsSync(DB_HEALING_STATE_PATH)
      ? (JSON.parse(readFileSync(DB_HEALING_STATE_PATH, 'utf-8')) as {
          lastHealTime: number;
          healCount: number;
          healAttempts: number;
          lastError: string | null;
          lastBackup: string | null;
          metrics: {
            vacuumCount: number;
            checkpointCount: number;
            reindexCount: number;
            analyzeCount: number;
            pruneCount: number;
          };
        })
      : undefined;

    return buildStackCapabilities(anomalyState, anomalyAlerts, circuitState, dbHealing);
  } catch (err) {
    console.error('[real-data] Error reading stack capabilities:', err);
    return empty;
  }
}

export function buildStackCapabilities(
  anomalyState?: { predictions?: unknown[]; lastAlert?: number; alertCount?: number },
  anomalyAlerts?: { alerts?: unknown[] },
  circuitState?: Record<string, { state: string }>,
  dbHealing?: unknown,
) {
  const alerts = anomalyAlerts?.alerts ?? [];
  const predictions = anomalyState?.predictions ?? [];

  const critical = alerts.filter((a: any) => a.type === 'CRITICAL').length;
  const warning = alerts.filter((a: any) => a.type === 'WARNING').length;
  const autoHealed = alerts.filter((a: any) => a.autoHealed).length;

  const breakers = Object.entries(circuitState ?? {}).map(([key, b]: [string, any]) => ({
    name: b.name || key,
    state: b.state,
    failureThreshold: b.config?.failureThreshold ?? 0,
    successThreshold: b.config?.successThreshold ?? 0,
    resetTimeout: b.config?.resetTimeout ?? 0,
    failures: b.metrics?.failures ?? 0,
    successes: b.metrics?.successes ?? 0,
    openedAt: b.openedAt ?? null,
    lastStateChange: b.lastStateChange ?? 0,
  }));

  return {
    anomalies: {
      total: alerts.length + predictions.length,
      critical,
      warning,
      predictions: predictions.length,
      autoHealed,
      latest: (alerts as any[]).slice(-10).reverse(),
    },
    circuitBreakers: {
      total: breakers.length,
      open: breakers.filter((b) => b.state === 'OPEN').length,
      halfOpen: breakers.filter((b) => b.state === 'HALF_OPEN').length,
      closed: breakers.filter((b) => b.state === 'CLOSED').length,
      breakers,
    },
    dbHealing: (dbHealing as any) ?? null,
    lastUpdated: new Date().toISOString(),
  };
}
