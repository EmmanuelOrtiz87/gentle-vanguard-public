import { useState, useEffect, useCallback, useRef } from 'react';
import type { StackTablesData } from '../types/dashboard';

const EMPTY: StackTablesData = {
  skillUsage: { skills: [], total: 0 },
  tokenUsage: { usage: [], total: 0 },
  contractResults: { results: [], total: 0 },
  routingRules: { rules: [], total: 0 },
};

export function useStackTables() {
  const [data, setData] = useState<StackTablesData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const fetchAll = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const [skillRes, tokenRes, contractRes, routingRes] = await Promise.all([
        fetch('/api/skill-usage?limit=20', { signal: controller.signal }),
        fetch('/api/token-usage', { signal: controller.signal }),
        fetch('/api/contract-results?limit=20', { signal: controller.signal }),
        fetch('/api/routing-rules', { signal: controller.signal }),
      ]);

      if (!skillRes.ok) throw new Error(`Skill usage HTTP ${skillRes.status}`);
      if (!tokenRes.ok) throw new Error(`Token usage HTTP ${tokenRes.status}`);
      if (!contractRes.ok) throw new Error(`Contract results HTTP ${contractRes.status}`);
      if (!routingRes.ok) throw new Error(`Routing rules HTTP ${routingRes.status}`);

      const skillJson = await skillRes.json();
      const tokenJson = await tokenRes.json();
      const contractJson = await contractRes.json();
      const routingJson = await routingRes.json();

      setData({
        skillUsage: { skills: skillJson.data?.skills ?? [], total: skillJson.data?.total ?? 0 },
        tokenUsage: { usage: tokenJson.data?.usage ?? [], total: tokenJson.data?.total ?? 0 },
        contractResults: {
          results: contractJson.data?.results ?? [],
          total: contractJson.data?.total ?? 0,
        },
        routingRules: { rules: routingJson.data?.rules ?? [], total: routingJson.data?.total ?? 0 },
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to fetch stack tables');
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void fetchAll();
    const interval = setInterval(fetchAll, 15000);
    return () => {
      clearInterval(interval);
      requestRef.current?.abort();
    };
  }, [fetchAll]);

  return { ...data, loading, error, refetch: fetchAll };
}
