import { useState } from 'react';
import { Activity, CheckCircle, Clock, DollarSign, Cpu, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Session } from '../types/dashboard';
import { useT } from '../hooks/useLocale';

interface SessionTableProps {
  sessions: Session[];
}

const PAGE_SIZE = 15;

const statusIcons: Record<string, React.ComponentType<any>> = {
  active: Activity,
  stale: Clock,
  idle: Clock,
  completed: CheckCircle,
};

const statusColors: Record<string, string> = {
  active: 'text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400',
  idle: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20 dark:text-yellow-400',
  stale: 'text-orange-600 bg-orange-50 dark:bg-orange-900/20 dark:text-orange-400',
  completed: 'text-gray-600 bg-gray-50 dark:bg-gray-700 dark:text-gray-400',
};

export function SessionTable({ sessions }: SessionTableProps) {
  const [page, setPage] = useState(0);
  const { tt } = useT();
  const sorted = [...sessions].sort((a, b) => {
     if (a.status === 'active' && b.status !== 'active') return -1;
     if (b.status === 'active' && a.status !== 'active') return 1;
    return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
  });
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <div className="card">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        {tt('ui.sessions')} ({sessions.length})
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                {tt('ui.session')}
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                {tt('ui.agent')}
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                {tt('ui.status')}
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                <span className="flex items-center gap-1">
                  <Cpu className="w-3.5 h-3.5" />
                  {tt('ui.model')}
                </span>
              </th>
              <th className="text-right py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                {tt('ui.tokens')}
              </th>
              <th className="text-right py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                <span className="flex items-center gap-1 justify-end">
                  <DollarSign className="w-3.5 h-3.5" />
                  {tt('ui.cost')}
                </span>
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                {tt('ui.started')}
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
                  {tt('ui.no_sessions_found')}
                </td>
              </tr>
            ) : (
              pageRows.map((session) => {
                const StatusIcon = statusIcons[session.status];
                const statusLabel = tt(`ui.${session.status}`);
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
                        {statusLabel.startsWith('ui.') ? session.status : statusLabel}
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
                      <div>{new Date(session.startTime).toLocaleString()}</div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-600">
                        {tt('ui.last_activity')}: {session.lastActivity ? new Date(session.lastActivity).toLocaleString() : '-'}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, sorted.length)}{' '}
            {tt('ui.of')} {sorted.length}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(0, safePage - 1))}
              disabled={safePage === 0}
              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label={tt('ui.previous_page')}
            >
              <ChevronLeft className="w-4 h-4 text-gray-600 dark:text-gray-300" />
            </button>
            <span className="text-xs text-gray-600 dark:text-gray-300 tabular-nums px-2">
              {safePage + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
              disabled={safePage >= totalPages - 1}
              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label={tt('ui.next_page')}
            >
              <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-300" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
