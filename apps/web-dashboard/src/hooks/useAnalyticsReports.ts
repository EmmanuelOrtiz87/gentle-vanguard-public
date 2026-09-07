import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Analytics report summary as returned by gv-analytics GET /api/reports.
 * Only the fields the dashboard widget needs are typed.
 */
export interface AnalyticsReportSummary {
  id: string;
  createdAt: string;
  mode: string;
  summary: string;
  input: string;
}

interface AnalyticsReportsResponse {
  reports: AnalyticsReportSummary[];
}

const REFRESH_MS = 15000;

/**
 * Reads the latest gv-analytics reports through the Vite proxy
 * (/gv-analytics -> http://127.0.0.1:4754). Returns an empty list when the
 * gv-analytics API is not reachable, so the dashboard never breaks.
 */
export function useAnalyticsReports(limit = 5) {
  const [reports, setReports] = useState<AnalyticsReportSummary[]>([]);
  const [available, setAvailable] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  const fetchReports = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const res = await fetch(`/gv-analytics/api/reports?limit=${limit}`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        setAvailable(false);
        return;
      }
      const data = (await res.json()) as AnalyticsReportsResponse;
      setReports(data.reports || []);
      setAvailable(true);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setAvailable(false);
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [limit]);

  useEffect(() => {
    void fetchReports();
    const interval = setInterval(fetchReports, REFRESH_MS);
    return () => {
      clearInterval(interval);
      requestRef.current?.abort();
    };
  }, [fetchReports]);

  return { reports, available };
}
