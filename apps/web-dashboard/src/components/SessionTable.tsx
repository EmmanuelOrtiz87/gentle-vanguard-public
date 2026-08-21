import { Activity, CheckCircle, Clock, DollarSign, Cpu } from 'lucide-react';
import type { Session } from '../types/dashboard';

interface SessionTableProps {
  sessions: Session[];
}

const statusIcons: Record<string, React.ComponentType<any>> = {
  active: Activity,
  idle: Clock,
  completed: CheckCircle,
};

const statusColors: Record<string, string> = {
  active: 'text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400',
  idle: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20 dark:text-yellow-400',
  completed: 'text-gray-600 bg-gray-50 dark:bg-gray-700 dark:text-gray-400',
};

export function SessionTable({ sessions }: SessionTableProps) {
  const sorted = [...sessions].sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (b.status === 'active' && a.status !== 'active') return 1;
    return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
  });

  return (
    <div className="card">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        Sessions ({sessions.length})
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                Session
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                Agent
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                Status
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                <span className="flex items-center gap-1">
                  <Cpu className="w-3.5 h-3.5" />
                  Model
                </span>
              </th>
              <th className="text-right py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                Tokens
              </th>
              <th className="text-right py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                <span className="flex items-center gap-1 justify-end">
                  <DollarSign className="w-3.5 h-3.5" />
                  Cost
                </span>
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                Started
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="py-8 text-center text-sm text-gray-400 dark:text-gray-500"
                >
                  No sessions found. Run a pipeline to generate data.
                </td>
              </tr>
            ) : (
              sorted.map((session) => {
                const StatusIcon = statusIcons[session.status];
                return (
                  <tr
                    key={session.id}
                    className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <td className="py-3 px-4 text-sm text-gray-900 dark:text-white font-mono truncate max-w-[140px]">
                      {session.id}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600 dark:text-gray-400">
                      {session.agent}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusColors[session.status]}`}
                      >
                        <StatusIcon className="w-3.5 h-3.5" />
                        {session.status.charAt(0).toUpperCase() + session.status.slice(1)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600 dark:text-gray-400">
                      {session.model || '-'}
                    </td>
                    <td className="py-3 px-4 text-sm text-right text-gray-600 dark:text-gray-400 tabular-nums">
                      {session.tokensUsed.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-sm text-right text-gray-600 dark:text-gray-400 tabular-nums">
                      ${(session.cost || 0).toFixed(4)}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-500 dark:text-gray-500">
                      {new Date(session.startTime).toLocaleString()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
