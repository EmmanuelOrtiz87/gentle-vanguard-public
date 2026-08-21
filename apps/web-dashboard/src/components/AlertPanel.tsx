import { AlertTriangle, Bell } from 'lucide-react';
import type { Alert } from '../hooks/useAlerts';

interface AlertPanelProps {
  alerts: Alert[];
}

export function AlertPanel({ alerts }: AlertPanelProps) {
  const triggeredAlerts = alerts.filter((a) => a.triggered);
  if (triggeredAlerts.length === 0) return null;

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <Bell className="w-5 h-5 text-red-500" />
        Active Alerts ({triggeredAlerts.length})
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
            }`}
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
                {alert.unit} exceeds threshold of {alert.threshold}
                {alert.unit}
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
          </div>
        ))}
      </div>
    </div>
  );
}
