import { useCallback, useEffect, useRef, useState } from 'react';
import { Recycle } from 'lucide-react';
import { useT } from '../hooks/useLocale';

interface HygieneFinding {
  pid: number;
  name: string;
  kind: string;
  action: string;
  reason: string;
  ageHours: number;
}

interface HygieneReport {
  timestamp: string;
  mode: 'dry-run' | 'apply';
  scanned: number;
  findings: HygieneFinding[];
  killed: number[];
  cleanedFiles: string[];
  keptHealthy: { classId: string; pid: number; ageHours: number }[];
}

const ACTION_STYLES: Record<string, string> = {
  kill: 'text-red-600 dark:text-red-400',
  recycle: 'text-red-600 dark:text-red-400',
  'clean-pidfile': 'text-amber-600 dark:text-amber-400',
  report: 'text-gray-500 dark:text-gray-400',
};

export function ProcessHygienePanel() {
  const { tt } = useT();
  const [report, setReport] = useState<HygieneReport | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetch('/api/process-hygiene', { signal });
      if (!response.ok) return;
      const payload = await response.json();
      setReport(payload.data ?? null);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      // keep the last good report on transient errors
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

  if (!report) return null;

  const actionable = report.findings.filter((f) => f.action !== 'report');
  const ranAt = new Date(report.timestamp).toLocaleString();

  return (
    <section className="mb-8" aria-label={tt('ui.hygiene_title')}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {tt('ui.hygiene_title')}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">{tt('ui.hygiene_source')}</p>
        </div>
        <span
          className={`text-xs font-medium ${actionable.length === 0 ? 'text-emerald-600' : 'text-amber-600'}`}
        >
          {tt('ui.hygiene_last_run')}: {ranAt} ({report.mode})
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        <Chip label={`${report.scanned} ${tt('ui.hygiene_scanned')}`} />
        <Chip label={`${report.keptHealthy.length} ${tt('ui.hygiene_healthy')}`} tone="ok" />
        <Chip
          label={`${report.findings.length} ${tt('ui.hygiene_findings')}`}
          tone={actionable.length > 0 ? 'warn' : 'ok'}
        />
        {report.killed.length > 0 && <Chip label={`${report.killed.length} ${tt('ui.hygiene_reaped')}`} tone="bad" />}
      </div>

      {report.findings.length === 0 ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">{tt('ui.hygiene_clean')}</p>
      ) : (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2 text-left">{tt('ui.hygiene_kind')}</th>
                <th className="px-3 py-2 text-left">{tt('ui.hygiene_pid')}</th>
                <th className="px-3 py-2 text-left">{tt('ui.hygiene_age')}</th>
                <th className="px-3 py-2 text-left">{tt('ui.hygiene_reason')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {report.findings.map((f, i) => (
                <tr key={`${f.pid}-${i}`} className="bg-white dark:bg-gray-900">
                  <td className={`px-3 py-1.5 font-medium ${ACTION_STYLES[f.action] ?? ''}`}>{f.kind}</td>
                  <td className="px-3 py-1.5 tabular-nums text-gray-700 dark:text-gray-300">{f.pid || '—'}</td>
                  <td className="px-3 py-1.5 tabular-nums text-gray-500 dark:text-gray-400">
                    {f.ageHours.toFixed(1)}
                  </td>
                  <td className="px-3 py-1.5 text-gray-600 dark:text-gray-300">{f.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Chip({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'ok' | 'warn' | 'bad' }) {
  const tones: Record<string, string> = {
    neutral: 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300',
    ok: 'border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400',
    warn: 'border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400',
    bad: 'border-red-300 dark:border-red-700 text-red-700 dark:text-red-400',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 ${tones[tone]}`}>
      <Recycle className="w-3 h-3" />
      {label}
    </span>
  );
}
