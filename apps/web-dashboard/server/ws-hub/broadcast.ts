import { existsSync, watch } from 'fs';
import { join } from 'path';
import { OperationalMetricsTracker } from '@gentle-vanguard/core/operational-metrics-tracker';
import { DatabaseManager } from '../database/manager.ts';
import { ROOT } from '../shared.ts';
import { clients, safeSend, prevAlertState, deploymentTenant } from './context.ts';
import { generateMetrics } from './metrics.ts';
import { broadcastValidations, evaluateAlerts } from '../handlers/validations.ts';

let prevMetrics: Record<string, unknown> | null = null;

export function startBroadcastLoop(): void {
  setInterval(() => {
    const metrics = generateMetrics();

    // Agregar métricas operacionales si existen datos
    try {
      const operationalMetrics = OperationalMetricsTracker.calculateMetrics();
      if (operationalMetrics && operationalMetrics.totalOperations > 0) {
        (metrics as any).operational = operationalMetrics;
      }
    } catch {
      // Silencioso si no hay métricas operacionales aún
    }

    const msg = JSON.stringify({ type: 'metrics', data: metrics });
    clients.forEach((c) => safeSend(c, msg));
    broadcastValidations();

    // Broadcast alert state with transitions
    const alerts = evaluateAlerts(metrics);
    const transitions = alerts.filter((a) => a.transition);
    alerts.forEach((a) => prevAlertState.set(a.name, a.triggered));
    const alertMsg = JSON.stringify({ type: 'alerts', data: alerts });
    clients.forEach((c) => safeSend(c, alertMsg));

    // Persist alert transitions to Nexus (audit trail for the Alerts panel).
    if (transitions.length > 0) {
      try {
        const db = DatabaseManager.getInstance();
        for (const a of transitions) {
          db.events.insertAlert(deploymentTenant.tenantId ?? 'gentle-vanguard', {
            name: a.name,
            rule: a.rule,
            severity: a.severity,
            triggered: a.triggered ? 1 : 0,
            actual: a.actual,
            threshold: a.threshold,
            transition: a.transition ?? undefined,
          });
        }
      } catch {
        /* DB unavailable — broadcast already sent */
      }
    }

    // Broadcast alert transitions as notifications
    if (transitions.length > 0) {
      const transitionNotifications = transitions.map((a) => ({
        type: a.transition === 'fired' ? 'alert_fired' : 'alert_resolved',
        message:
          a.transition === 'fired'
            ? `Alert: ${a.rule} triggered (${a.actual}${a.unit} ${a.direction === 'below' ? '<=' : '>='} ${a.threshold}${a.unit})`
            : `Resolved: ${a.rule} (${a.actual}${a.unit})`,
        severity: a.transition === 'fired' ? a.severity : 'info',
        timestamp: new Date().toISOString(),
      }));
      const note = JSON.stringify({ type: 'notification', notifications: transitionNotifications });
      clients.forEach((c) => safeSend(c, note));
    }

    if (prevMetrics) {
      const prev = prevMetrics as Record<string, any>;
      const curr = metrics as Record<string, any>;
      const currTokens = curr?.tokens?.used || 0;
      const prevTokens = prev?.tokens?.used || 0;
      const currSessions = curr?.sessions?.total || 0;
      const prevSessions = prev?.sessions?.total || 0;
      const currActive = curr?.sessions?.active || 0;
      const prevActive = prev?.sessions?.active || 0;
      const currEvents = curr?.events?.length || 0;
      const prevEvents = prev?.events?.length || 0;

      const notifications: Array<{
        type: string;
        message: string;
        severity: string;
        timestamp: string;
      }> = [];

      if (currTokens > prevTokens) {
        const delta = currTokens - prevTokens;
        notifications.push({
          type: 'token_usage',
          message: `+${delta} tokens (${(currTokens / 1000).toFixed(1)}K total)`,
          severity: 'info',
          timestamp: curr.timestamp,
        });
      }
      if (currSessions > prevSessions) {
        notifications.push({
          type: 'session_created',
          message: `Nueva sesión creada (${currSessions} total)`,
          severity: 'info',
          timestamp: curr.timestamp,
        });
      }
      if (currActive !== prevActive) {
        notifications.push({
          type: 'session_status',
          message: `Sesiones activas: ${prevActive} → ${currActive}`,
          severity: currActive > prevActive ? 'info' : 'warning',
          timestamp: curr.timestamp,
        });
      }
      if (currEvents > prevEvents) {
        const delta = currEvents - prevEvents;
        notifications.push({
          type: 'new_events',
          message: `${delta} nuevo(s) evento(s) en timeline`,
          severity: 'info',
          timestamp: curr.timestamp,
        });
      }

      if (notifications.length > 0) {
        const note = JSON.stringify({ type: 'notification', notifications });
        clients.forEach((c) => safeSend(c, note));
      }
    }

    prevMetrics = metrics;
  }, 5000);
}

// File watcher en .runtime/metrics/ — broadcast inmediato ante cambios reales
export function startMetricsWatcher(): void {
  const METRICS_WATCH_DIR = join(ROOT, '.runtime', 'metrics');
  if (existsSync(METRICS_WATCH_DIR)) {
    try {
      let watchTimer: ReturnType<typeof setTimeout> | null = null;
      const DEBOUNCE_MS = 200;
      watch(METRICS_WATCH_DIR, (_eventType, filename) => {
        if (!filename || !filename.endsWith('.json')) return;
        if (watchTimer) clearTimeout(watchTimer);
        watchTimer = setTimeout(() => {
          const metrics = generateMetrics();
          const msg = JSON.stringify({ type: 'metrics', data: metrics });
          clients.forEach((c) => safeSend(c, msg));
          console.log(`[WATCH] metrics file changed: ${filename} → broadcast`);
        }, DEBOUNCE_MS);
      });
      console.log('[WATCH] .runtime/metrics/ watcher started');
    } catch (err) {
      console.warn('[WATCH] Could not start metrics watcher:', (err as Error).message);
    }
  }
}
