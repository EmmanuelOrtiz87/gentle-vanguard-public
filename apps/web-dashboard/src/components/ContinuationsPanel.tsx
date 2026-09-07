import { useCallback, useEffect, useRef, useState } from 'react';
import { TerminalSquare } from 'lucide-react';
import { useT } from '../hooks/useLocale';

interface ActiveContinuation {
  id: string;
  operation: string;
  command: string;
  workflowId: string;
  revision: string | null;
  version: number;
  createdAt: string;
}

interface PendingAck {
  resource: string;
  revision: string;
  stagedAt: string;
}

interface ContinuationsData {
  active: ActiveContinuation[];
  pendingAcks: PendingAck[];
  capabilities: { contract: string; protocol: string; status: string; operations: string[] }[];
  contracts: { continuation: string; ack: string };
  generatedAt: string;
}

/**
 * "What do I run now?" panel — every live transaction publishes the verbatim
 * re-entry command (gentle-vanguard.continuation/v1) and every staged terminal
 * transition waits for its exact acknowledgement token
 * (gentle-vanguard.ack/v1). Read-only by design: burning authority is a CLI
 * action, not a dashboard button.
 */
export function ContinuationsPanel() {
  const { tt } = useT();
  const [data, setData] = useState<ContinuationsData | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetch('/api/continuations', { signal });
      if (!response.ok) return;
      const payload = await response.json();
      setData(payload.data ?? null);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      // keep the last good snapshot on transient errors
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

  if (!data) return null;
  if (data.active.length === 0 && data.pendingAcks.length === 0) return null;

  return (
    <section className="mb-8" aria-label={tt('ui.cont_title')}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {tt('ui.cont_title')}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">{tt('ui.cont_source')}</p>
        </div>
        <span className="text-xs font-medium text-cyan-600 dark:text-cyan-400">
          {data.contracts.continuation}
        </span>
      </div>

      {data.active.length > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-x-auto mb-3">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2 text-left">{tt('ui.cont_workflow')}</th>
                <th className="px-3 py-2 text-left">{tt('ui.cont_operation')}</th>
                <th className="px-3 py-2 text-left">{tt('ui.cont_command')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {data.active.map((c) => (
                <tr key={c.id} className="bg-white dark:bg-gray-900">
                  <td className="px-3 py-1.5 font-medium text-gray-700 dark:text-gray-300">
                    {c.workflowId}
                  </td>
                  <td className="px-3 py-1.5 text-cyan-700 dark:text-cyan-400">{c.operation}</td>
                  <td className="px-3 py-1.5">
                    <code className="inline-flex items-center gap-1.5 font-mono text-[11px] bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded px-1.5 py-0.5">
                      <TerminalSquare className="w-3 h-3 shrink-0" />
                      {c.command}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.pendingAcks.length > 0 && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <span className="font-medium">{tt('ui.cont_pending_acks')}:</span>{' '}
          {data.pendingAcks.map((a) => a.resource).join(', ')} —{' '}
          {tt('ui.cont_ack_hint')}
        </div>
      )}
    </section>
  );
}
