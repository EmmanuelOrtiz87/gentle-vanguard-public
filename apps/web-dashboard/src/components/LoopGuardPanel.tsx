import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useT } from '../hooks/useLocale';

interface LoopGuardStatus {
  timestamp: string;
  guardModule: boolean;
  guardTests: boolean;
  liveMetrics: boolean;
  selfTest: boolean;
  selfTestDetail: string;
  resumeLog: { taskId: string; count: number; isLoop: boolean }[];
  watchtowerStatus: string;
}

export function LoopGuardPanel() {
  const { tt } = useT();
  const [status, setStatus] = useState<LoopGuardStatus | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetch('/api/loop-guard', { signal });
      if (!response.ok) return;
      const payload = await response.json();
      setStatus(payload.data ?? null);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
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
    const interval = window.setInterval(poll, 15000);
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
      window.clearInterval(interval);
    };
  }, [refresh]);

  if (!status) return null;

  const allOk = status.guardModule && status.guardTests && status.liveMetrics && status.selfTest;
  const hasLoop = status.resumeLog.some((r) => r.isLoop);

  return (
    <section className="mb-8" aria-label={tt('ui.loopguard_title') ?? 'Loop Guard'}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            {tt('ui.loopguard_title') ?? 'Loop Guard (ADR-0022)'}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {tt('ui.loopguard_source') ?? 'Orchestrator anti-loop — intent/tool/ping-pong/stalled'}
          </p>
        </div>
        <span className={`text-xs font-medium ${allOk ? 'text-emerald-600' : 'text-amber-600'}`}>
          {status.watchtowerStatus} • {new Date(status.timestamp).toLocaleString()}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        <Chip label="guard module" tone={status.guardModule ? 'ok' : 'bad'} />
        <Chip label="guard tests (5/5)" tone={status.guardTests ? 'ok' : 'bad'} />
        <Chip label="live metrics" tone={status.liveMetrics ? 'ok' : 'warn'} />
        <Chip
          label={`self-test: ${status.selfTestDetail}`}
          tone={status.selfTest ? 'ok' : 'warn'}
        />
        {hasLoop && <Chip label="loop detected" tone="bad" />}
      </div>

      {status.resumeLog.length > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2 text-left">task_id</th>
                <th className="px-3 py-2 text-left">count</th>
                <th className="px-3 py-2 text-left">loop</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {status.resumeLog.map((r) => (
                <tr key={r.taskId} className="bg-white dark:bg-gray-900">
                  <td className="px-3 py-1.5 font-mono text-gray-700 dark:text-gray-300">
                    {r.taskId.slice(0, 40)}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-gray-500 dark:text-gray-400">
                    {r.count}
                  </td>
                  <td
                    className={`px-3 py-1.5 font-medium ${r.isLoop ? 'text-red-600' : 'text-emerald-600'}`}
                  >
                    {r.isLoop ? 'LOOP' : 'ok'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Chip({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'ok' | 'warn' | 'bad';
}) {
  const tones: Record<string, string> = {
    neutral: 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300',
    ok: 'border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400',
    warn: 'border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400',
    bad: 'border-red-300 dark:border-red-700 text-red-700 dark:text-red-400',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 ${tones[tone]}`}
    >
      <ShieldCheck className="w-3 h-3" />
      {label}
    </span>
  );
}
