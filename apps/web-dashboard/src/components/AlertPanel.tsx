import { useState } from 'react';
import { AlertTriangle, Bell, CheckCircle2, Undo2 } from 'lucide-react';
import type { Alert } from '../hooks/useAlerts';
import { useT } from '../hooks/useLocale';

interface AlertPanelProps {
  alerts: Alert[];
}

export function AlertPanel({ alerts }: AlertPanelProps) {
  const { tt } = useT();
  const [pending, setPending] = useState<string | null>(null);
  const triggeredAlerts = alerts.filter((a) => a.triggered);
  if (triggeredAlerts.length === 0) return null;

  const setAck = async (alert: Alert, acking: boolean) => {
    setPending(alert.name);
    try {
      await fetch(`/api/alerts/${acking ? 'ack' : 'unack'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: alert.name }),
      });
    } catch {
      /* el próximo ciclo de WS reconcilia el estado */
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <Bell className="w-5 h-5 text-red-500" />
        {tt('ui.active_alerts')} ({triggeredAlerts.length})
      </h2>
      <div className="space-y-2">
        {triggeredAlerts.map((alert) => (
          <div
            key={alert.name}
            className={`card flex items-center gap-3 ${
              alert.severity === 'error'
                ? 'border-l-4 border-red-500 bg-red-50 dark:bg-red-900/10'
                : alert.severity === 'warning'
                  ? 'border-l-4 border-yellow-500 bg-yellow-50 dark:bg-yellow-900/10'
                  : 'border-l-4 border-blue-500 bg-blue-50 dark:bg-blue-900/10'
            } ${alert.acknowledged ? 'opacity-60' : ''}`}
          >
            <AlertTriangle
              className={`w-5 h-5 ${
                alert.severity === 'error'
                  ? 'text-red-500'
                  : alert.severity === 'warning'
                    ? 'text-yellow-500'
                    : 'text-blue-500'
              }`}
            />
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900 dark:text-white">{alert.rule}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {alert.actual}
                {alert.unit} {tt('ui.exceeds_threshold')} {alert.threshold}
                {alert.unit}
                {alert.acknowledged && alert.ackedAt && (
                  <span className="ml-2 inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />
                    {tt('ui.acked_at')}{' '}
                    {new Date(alert.ackedAt).toLocaleTimeString()}
                  </span>
                )}
              </p>
            </div>
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${
                alert.severity === 'error'
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                  : alert.severity === 'warning'
                    ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
              }`}
            >
              {alert.severity}
            </span>
            <button
              onClick={() => void setAck(alert, !alert.acknowledged)}
              disabled={pending === alert.name}
              title={alert.acknowledged ? tt('ui.unack') : tt('ui.ack')}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {alert.acknowledged ? (
                <>
                  <Undo2 className="w-3.5 h-3.5" /> {tt('ui.unack')}
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" /> {tt('ui.ack')}
                </>
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
