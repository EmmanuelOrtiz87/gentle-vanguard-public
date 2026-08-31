import { useState, useEffect, useCallback, useRef } from 'react';
import type { DashboardData, MetricHistory } from '../types/dashboard';
import { useSharedWs } from './useSharedWs';
import { saveOfflineCache, loadOfflineCache, hasFreshOfflineCache } from '../lib/offline-storage';
import { readCached, writeCached } from '../lib/offlineCache';
import type { HistoryRange } from '../types/dashboard';

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
  const dataRef = useRef(data);
  const hasDataRef = useRef(false);
  const [tenantId, setTenantId] = useState<string | undefined>(initialTenantId);
  const [history, setHistory] = useState<MetricHistory[]>([]);
  const [historyRange, setHistoryRange] = useState<HistoryRange>('1h');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const metricsRequestRef = useRef<AbortController | null>(null);
  const historyRequestRef = useRef<AbortController | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number>(() => {
    const cached = readCached<DashboardData>(metricsCacheKey(initialTenantId));
    return cached?.cachedAt ?? 0;
  });

  // Derived data-freshness state. Thresholds:
  //   live   — last update ≤ 20s ago (within two WS push cycles)
  //   stale  — last update > 20s but ≤ 90s (WS may have missed a push)
  //   error  — isOffline or explicit error
  //   loading — no data received yet
  const STALE_THRESHOLD_MS = 20_000;
  const ERROR_THRESHOLD_MS = 90_000;
  const dataState: 'live' | 'stale' | 'error' | 'loading' = (() => {
    if (loading && lastUpdated === 0) return 'loading';
    if (isOffline || (error !== null && lastUpdated === 0)) return 'error';
    if (lastUpdated === 0) return 'loading';
    const age = Date.now() - lastUpdated;
    if (age > ERROR_THRESHOLD_MS) return 'error';
    if (age > STALE_THRESHOLD_MS) return 'stale';
    return 'live';
  })();

  const updateFromPayload = useCallback(
    (payload: Partial<DashboardData> & { timestamp?: string }) => {
      // Keep the last visible snapshot while the next one arrives.
      const newData = {
        ...dataRef.current,
        ...payload,
        system: payload.system ?? dataRef.current.system,
      } as DashboardData;
      dataRef.current = newData;
      hasDataRef.current = true;
      setData(newData);
      setLoading(false);
      setIsOffline(false);
      setLastUpdated(payload.timestamp ? Date.parse(payload.timestamp) || Date.now() : Date.now());

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
    [tenantId],
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
    metricsRequestRef.current?.abort();
    const controller = new AbortController();
    metricsRequestRef.current = controller;
    if (!hasDataRef.current) setLoading(true);
    try {
      const params = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
      const res = await fetch(`/api/metrics${params}`, { signal: controller.signal });
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
      if (err instanceof DOMException && err.name === 'AbortError') return;
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
      if (metricsRequestRef.current === controller) {
        metricsRequestRef.current = null;
        setLoading(false);
      }
    }
  }, [updateFromPayload, tenantId]);

  const fetchHistory = useCallback(async () => {
    historyRequestRef.current?.abort();
    const controller = new AbortController();
    historyRequestRef.current = controller;
    try {
      const res = await fetch(`/api/metrics/history?limit=2000&range=${historyRange}`, {
        signal: controller.signal,
      });
      if (!res.ok) return;
      const message = await res.json();
      if (message.type !== 'metrics_history' || !Array.isArray(message.data)) return;
      setHistory(
        message.data.map((snapshot: Record<string, unknown>) => ({
          timestamp: String(snapshot.timestamp || new Date().toISOString()),
          tokens: Number(snapshot.tokens_used || 0),
          sessions: Number(snapshot.sessions_active || 0),
          cost: Number(snapshot.cost || 0),
          latency: Number(snapshot.latency_avg || 0),
          mcpSkills: Number(snapshot.mcp_skills || 0),
          commits: Number(snapshot.commits || 0),
        })),
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      // Live updates remain available when historical storage is temporarily unavailable.
    } finally {
      if (historyRequestRef.current === controller) historyRequestRef.current = null;
    }
  }, [historyRange]);

  useEffect(() => {
    void fetchMetrics();
    void fetchHistory();
    // WebSocket is the live source; HTTP is a quiet recovery path.
    const interval = setInterval(() => {
      if (!_useWebSocketMode || !wsConnected) void fetchMetrics();
    }, 15000);
    return () => {
      clearInterval(interval);
      metricsRequestRef.current?.abort();
      historyRequestRef.current?.abort();
    };
  }, [fetchHistory, fetchMetrics, _useWebSocketMode, wsConnected]);

  const dismissNotification = useCallback((index: number) => {
    setNotifications((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return {
    data,
    history,
    historyRange,
    setHistoryRange,
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
    dataState,
  };
}
