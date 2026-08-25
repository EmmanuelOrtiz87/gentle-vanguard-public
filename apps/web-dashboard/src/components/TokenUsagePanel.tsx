import { Coins } from 'lucide-react';
import type { TokenUsageRow } from '../types/dashboard';
import { useT } from '../hooks/useLocale';

interface TokenUsagePanelProps {
  usage: TokenUsageRow[];
  total: number;
}

export function TokenUsagePanel({ usage, total }: TokenUsagePanelProps) {
  const { tt } = useT();

  if (total === 0) {
    return (
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Coins className="w-5 h-5 text-amber-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{tt('ui.token_usage_cost')}</h3>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">{tt('ui.no_token_usage_yet')}</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Coins className="w-5 h-5 text-amber-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{tt('ui.token_usage_cost')}</h3>
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {total} {tt('ui.sessions_word')}
        </span>
      </div>
      <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className="text-left py-2 pr-2 font-medium text-gray-500 dark:text-gray-400">
                {tt('ui.session')}
              </th>
              <th className="text-right py-2 px-1 font-medium text-gray-500 dark:text-gray-400">
                {tt('ui.prompt')}
              </th>
              <th className="text-right py-2 px-1 font-medium text-gray-500 dark:text-gray-400">
                {tt('ui.completion')}
              </th>
              <th className="text-right py-2 px-1 font-medium text-gray-500 dark:text-gray-400">
                {tt('ui.cost')}
              </th>
              <th className="text-right py-2 pl-2 font-medium text-gray-500 dark:text-gray-400">
                {tt('ui.last_used')}
              </th>
            </tr>
          </thead>
          <tbody>
            {usage.map((row) => (
              <tr
                key={row.session_id}
                className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <td
                  className="py-1.5 pr-2 font-mono text-[10px] text-gray-700 dark:text-gray-300 truncate max-w-[100px]"
                  title={row.session_id}
                >
                  {row.session_id}
                </td>
                <td className="py-1.5 px-1 text-right text-gray-600 dark:text-gray-400">
                  {row.prompt?.toLocaleString() ?? 0}
                </td>
                <td className="py-1.5 px-1 text-right text-gray-600 dark:text-gray-400">
                  {row.completion?.toLocaleString() ?? 0}
                </td>
                <td className="py-1.5 px-1 text-right text-gray-600 dark:text-gray-400">
                  ${row.cost?.toFixed(4) ?? '0.0000'}
                </td>
                <td className="py-1.5 pl-2 text-right text-gray-400 dark:text-gray-500 whitespace-nowrap">
                  {row.last_used ? new Date(row.last_used).toLocaleDateString() : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
