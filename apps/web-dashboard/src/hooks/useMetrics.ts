import { useState, useEffect, useCallback } from 'react';
import type { DashboardData, MetricHistory } from '../types/dashboard';
import { useSharedWs } from './useSharedWs';
import { saveOfflineCache, loadOfflineCache, hasFreshOfflineCache } from '../lib/offline-storage';
import { readCached, writeCached } from '../lib/offlineCache';

const metricsCacheKey = (tenantId?: string) => `metrics:${tenantId || 'default'}`;

export interface Notification {
  type: string;
  message: string;
  severity: string;
  timestamp: string;
}

const FALLBACK_DATA: DashboardData = {
  tokens: { used: 0, limit: 0, cost: 0, byModel: [] },
  sessions: { total: 0, active: 0, today: 0, avgDuration: 0 },
  git: { commits: 0, prsMerged: 0, contributors: 0 },
  health: { status: 'unknown', routing: 0 },
};

export function useMetrics(_useWebSocketMode = false, initialTenantId?: string) {
  const [data, setData] = useState<DashboardData>(() => {
    // Try to load from offline cache on init
    const cached = readCached<DashboardData>(metricsCacheKey(initialTenantId));
    if (cached?.data) return cached.data;
    const legacy = loadOfflineCache(initialTenantId);
    return legacy ? (legacy as DashboardData) : FALLBACK_DATA;
  });
  const [tenantId, setTenantId] = useState<string | undefined>(initialTenantId);
  const [history, setHistory] = useState<MetricHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOffline, setIsOffline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number>(() => {
    const cached = readCached<DashboardData>(metricsCacheKey(initialTenantId));
    return cached?.cachedAt ?? 0;
  });

  const updateFromPayload = useCallback(
    (payload: Partial<DashboardData> & { timestamp?: string }) => {
      const newData = {
        ...payload,
        system: payload.system ?? data.system,
      } as DashboardData;

      setData((prev) => ({
        ...prev,
        ...payload,
        system: payload.system ?? prev.system,
      }));

      // Save to offline cache
      saveOfflineCache(newData, tenantId);
      writeCached(metricsCacheKey(tenantId), newData);

      setHistory((prev) => {
        const tokens = payload.tokens?.used ?? 0;
        const sessions = payload.sessions?.active ?? 0;
        const cost = payload.tokens?.cost ?? 0;
        const latency = payload.latency?.avg ?? 0;
        const mcpSkills = (payload as any).mcp?.skills?.total ?? 0;
        const commits = (payload as any).git?.commits ?? 0;
        const newEntry: MetricHistory = {
          timestamp: payload.timestamp || new Date().toISOString(),
          tokens,
          sessions,
          cost,
          latency,
          mcpSkills,
          commits,
        };
        return [...prev, newEntry].slice(-20);
      });
    },
    [tenantId, data.system],
  );

  const { connected: wsConnected } = useSharedWs(
    useCallback(
      (msg: any) => {
        if (msg.type === 'metrics') {
          updateFromPayload(msg.data);
        } else if (msg.type === 'notification') {
          setNotifications((prev) => {
            const notes: Notification[] = msg.notifications || [];
            const updated = [...notes, ...prev];
            return updated.slice(0, 20);
          });
          setTimeout(() => {
            setNotifications((prev) => prev.slice(0, -1));
          }, 8000);
        }
      },
      [updateFromPayload],
    ),
  );

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const params = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
      const res = await fetch(`/api/metrics${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const message = await res.json();
      if (message.type === 'metrics') {
        updateFromPayload(message.data);
        writeCached(metricsCacheKey(tenantId), {
          ...message.data,
          system: message.data.system ?? data.system,
        } as DashboardData);
      }
      setError(null);
      setIsOffline(false);
      setLastUpdated(Date.now());
    } catch (err) {
      // Serve cached data and flag offline mode
      const cached = readCached<DashboardData>(metricsCacheKey(tenantId));
      if (cached?.data) {
        updateFromPayload(cached.data as Partial<DashboardData>);
        setError('Offline mode — showing cached data');
        setIsOffline(true);
        setLastUpdated(cached.cachedAt ?? 0);
      } else {
        // Try the legacy single-key cache as a fallback
        const legacy = loadOfflineCache(tenantId);
        if (legacy) {
          updateFromPayload(legacy as Partial<DashboardData>);
          setError('Offline mode — showing cached data');
          setIsOffline(true);
        } else {
          setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
          setIsOffline(false);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [updateFromPayload, tenantId, data.system]);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Solo ejecutar al montar, evita recarga infinita

  const dismissNotification = useCallback((index: number) => {
    setNotifications((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return {
    data,
    history,
    loading,
    error,
    wsConnected,
    refetch: fetchMetrics,
    notifications,
    dismissNotification,
    tenantId,
    setTenantId,
    offlineMode: !wsConnected && hasFreshOfflineCache(tenantId),
    isOffline,
    lastUpdated,
  };
}
