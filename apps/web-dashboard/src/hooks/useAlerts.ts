import { useState, useCallback } from 'react';
import { useSharedWs } from './useSharedWs';
import { readCached, writeCached } from '../lib/offlineCache';

const ALERTS_CACHE_KEY = 'alerts';

export interface Alert {
  name: string;
  rule: string;
  actual: number;
  threshold: number;
  severity: string;
  triggered: boolean;
  unit: string;
  transition?: string;
}

export function useAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>(() => {
    const cached = readCached<Alert[]>(ALERTS_CACHE_KEY);
    return cached?.data ?? [];
  });

  const handleMessage = useCallback((msg: Record<string, unknown>) => {
    if (msg.type === 'alerts') {
      const list = (msg.data as Alert[]) || [];
      setAlerts(list);
      writeCached(ALERTS_CACHE_KEY, list);
    }
  }, []);

  useSharedWs(handleMessage, [handleMessage]);

  const triggeredAlerts = alerts.filter((a) => a.triggered);

  return { alerts, triggeredAlerts };
}
