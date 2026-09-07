import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useT } from '../hooks/useLocale';

interface GuardrailsStatus {
  timestamp: string;
  inputModeration: boolean;
  outputModeration: boolean;
  config: boolean;
  adr: boolean;
  selfTest: boolean;
  selfTestDetail: string;
  watchtowerStatus: string;
}

export function GuardrailsPanel() {
  const { tt } = useT();
  const [status, setStatus] = useState<GuardrailsStatus | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetch('/api/guardrails', { signal });
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

  const allOk =
    status.inputModeration &&
    status.outputModeration &&
    status.config &&
    status.adr &&
    status.selfTest;

  return (
    <section className="mb-8" aria-label={tt('ui.guardrails_title') ?? 'Guardrails'}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-600" />
            {tt('ui.guardrails_title') ?? 'Guardrails (F3.2, ADR-0023)'}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {tt('ui.guardrails_source') ??
              'Input/output/tool rails — Llama Guard 3 + NeMo (soft WARN)'}
          </p>
        </div>
        <span className={`text-xs font-medium ${allOk ? 'text-emerald-600' : 'text-amber-600'}`}>
          {status.watchtowerStatus} • {new Date(status.timestamp).toLocaleString()}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        <Chip label="input moderation" tone={status.inputModeration ? 'ok' : 'bad'} />
        <Chip label="output moderation" tone={status.outputModeration ? 'ok' : 'bad'} />
        <Chip label="config" tone={status.config ? 'ok' : 'warn'} />
        <Chip label="ADR-0023" tone={status.adr ? 'ok' : 'warn'} />
        <Chip
          label={`self-test: ${status.selfTestDetail}`}
          tone={status.selfTest ? 'ok' : 'warn'}
        />
      </div>
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
      <ShieldAlert className="w-3 h-3" />
      {label}
    </span>
  );
}
