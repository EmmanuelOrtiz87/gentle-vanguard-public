import { CheckCircle, AlertTriangle, AlertCircle, RefreshCw } from 'lucide-react';
import { useValidations } from '../hooks/useValidations';

const STATUS_ICONS: Record<string, React.ReactNode> = {
  ok: <CheckCircle className="w-4 h-4 text-green-500" />,
  warn: <AlertTriangle className="w-4 h-4 text-yellow-500" />,
  error: <AlertCircle className="w-4 h-4 text-red-500" />,
};

const STATUS_COLORS: Record<string, string> = {
  ok: 'text-green-700 bg-green-50 dark:text-green-300 dark:bg-green-900/20',
  warn: 'text-yellow-700 bg-yellow-50 dark:text-yellow-300 dark:bg-yellow-900/20',
  error: 'text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-900/20',
};

export function ValidationPanel() {
  const validations = useValidations();

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center gap-2 mb-3">
        <RefreshCw className="w-4 h-4 text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Validaciones en vivo
        </h3>
      </div>
      {validations.length === 0 ? (
        <p className="text-xs text-gray-400">Esperando datos...</p>
      ) : (
        <div className="space-y-2">
          {validations.map((v) => (
            <div
              key={v.name}
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs ${STATUS_COLORS[v.status] || STATUS_COLORS.ok}`}
            >
              {STATUS_ICONS[v.status] || STATUS_ICONS.ok}
              <span className="font-medium">{v.name}:</span>
              <span className="flex-1 truncate">{v.message}</span>
              {v.value !== undefined && (
                <span className="font-mono tabular-nums text-gray-500">{v.value}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
