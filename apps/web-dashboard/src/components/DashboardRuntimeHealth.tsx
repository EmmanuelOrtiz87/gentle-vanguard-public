import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Clock3, Gauge, Wifi } from 'lucide-react';
import { useT } from '../hooks/useLocale';

interface RuntimeHealth {
  status: string;
  httpRequests: number;
  httpErrors: number;
  httpErrorRate: number;
  httpLatencyAvgMs: number;
  wsConnectionsPeak: number;
}

export function DashboardRuntimeHealth() {
  const { tt } = useT();
  const [runtime, setRuntime] = useState<RuntimeHealth | null>(null);
  const [error, setError] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetch('/api/health', { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      setRuntime(payload.components?.dashboard ?? null);
      setError(false);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(true);
    }
  }, []);

  useEffect(() => {
    const poll = () => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      void refresh(controller.signal);
    };
    poll();
    const interval = window.setInterval(() => {
      poll();
    }, 15000);
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
      window.clearInterval(interval);
    };
  }, [refresh]);

  if (!runtime && !error) return null;

  return (
    <section className="mb-8" aria-label={tt('ui.dashboard_runtime_title')}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {tt('ui.dashboard_runtime_title')}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">{tt('ui.dashboard_runtime_source')}</p>
        </div>
        <span className={`text-xs font-medium ${error ? 'text-amber-600' : 'text-emerald-600'}`}>
          {error ? tt('ui.dashboard_runtime_unavailable') : tt('ui.dashboard_runtime_live')}
        </span>
      </div>
      {runtime && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <RuntimeMetric icon={Activity} label={tt('ui.dashboard_http_requests')} value={runtime.httpRequests.toLocaleString()} />
          <RuntimeMetric icon={Gauge} label={tt('ui.dashboard_http_errors')} value={`${runtime.httpErrors} (${(runtime.httpErrorRate * 100).toFixed(2)}%)`} />
          <RuntimeMetric icon={Clock3} label={tt('ui.dashboard_http_latency')} value={`${runtime.httpLatencyAvgMs.toFixed(1)} ms`} />
          <RuntimeMetric icon={Wifi} label={tt('ui.dashboard_ws_peak')} value={runtime.wsConnectionsPeak.toLocaleString()} />
        </div>
      )}
    </section>
  );
}

function RuntimeMetric({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-xs">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-white tabular-nums">{value}</div>
    </div>
  );
}
