import { useState, useEffect, useCallback, useRef } from 'react';
import type { Session } from '../types/dashboard';

const SESSION_STALE_MS = 5 * 60 * 1000;

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const requestRef = useRef<AbortController | null>(null);

  const fetchSessions = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const res = await fetch('/api/agent/sessions', { signal: controller.signal });
      if (!res.ok) return;
      const data = await res.json();
      const now = Date.now();
      const list: Session[] = (data.sessions || []).map((s: any) => {
        const startTime = s.startedAt || s.createdAt || s.startTime || new Date().toISOString();
        const lastActivity = s.lastActivityAt || s.lastEventAt || s.updatedAt || startTime;
        const reportedStatus = s.status;
        const isFinished =
          reportedStatus === 'completed' || reportedStatus === 'closed' || Boolean(s.endedAt);
        const isStale =
          reportedStatus === 'active' || reportedStatus === 'awaiting_input'
            ? now - new Date(lastActivity).getTime() > SESSION_STALE_MS
            : false;
        return {
          id: s.id || s.sessionId || 'unknown',
          agent: s.agent || 'DEV',
          status: isFinished
            ? 'completed'
            : isStale
              ? 'stale'
              : reportedStatus === 'active' || reportedStatus === 'awaiting_input'
                ? 'active'
                : 'idle',
          startTime,
          lastActivity,
          tokensUsed: s.totalTokens || s.tokensUsed || 0,
          model: s.model || 'unknown',
          cost: s.totalCost || s.cost || 0,
        };
      });
      setSessions(list);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      /* best-effort */
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, []);

  useEffect(() => {
    void fetchSessions();
    const interval = setInterval(fetchSessions, 10000);
    return () => {
      clearInterval(interval);
      requestRef.current?.abort();
    };
  }, [fetchSessions]);

  return sessions;
}
