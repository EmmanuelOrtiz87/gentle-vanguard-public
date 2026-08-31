import { existsSync, readFileSync } from 'fs';
import { runValidations } from '../validations.ts';
import {
  clients,
  safeSend,
  bridgeReady,
  bridgeToolCount,
  ALERTS_CONFIG_PATH,
  prevAlertState,
} from '../ws-hub/context.ts';

export function broadcastValidations(): void {
  try {
    const validations = runValidations(bridgeReady, bridgeToolCount, clients.size);
    const msg = JSON.stringify({ type: 'validations', data: validations });
    clients.forEach((c) => {
      try {
        safeSend(c, msg);
      } catch {
        /* ignore send errors */
      }
    });
  } catch (err) {
    console.error(
      '[WS-VALIDATIONS] broadcast error:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

export function evaluateAlerts(metrics: any): Array<{
  name: string;
  rule: string;
  actual: number;
  threshold: number;
  severity: string;
  triggered: boolean;
  unit: string;
  direction: 'above' | 'below';
  transition?: string;
}> {
  try {
    if (!existsSync(ALERTS_CONFIG_PATH)) return [];
    const config = JSON.parse(readFileSync(ALERTS_CONFIG_PATH, 'utf-8'));
    return Object.entries(config.rules || {})
      .map(([name, rule]: [string, any]) => {
        if (rule.enabled === false) return null;
        const actual = rule.metric
          .split('.')
          .reduce((obj: any, key: string) => obj?.[key], metrics as any);
        const below = rule.direction === 'below';
        const triggered =
          typeof actual === 'number' &&
          typeof rule.threshold === 'number' &&
          (below ? actual <= rule.threshold : actual >= rule.threshold);
        const wasTriggered = prevAlertState.get(name) || false;
        let transition: string | undefined;
        if (triggered && !wasTriggered) transition = 'fired';
        else if (!triggered && wasTriggered) transition = 'resolved';
        return {
          name,
          rule: rule.label || name,
          actual: actual ?? 0,
          threshold: rule.threshold,
          severity: rule.severity || 'info',
          triggered,
          unit: rule.unit || '',
          direction: below ? 'below' : 'above',
          transition,
        };
      })
      .filter(Boolean) as any[];
  } catch {
    return [];
  }
}
