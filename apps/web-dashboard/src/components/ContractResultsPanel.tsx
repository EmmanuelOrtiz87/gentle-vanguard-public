import { FileCheck } from 'lucide-react';
import type { ContractResultRow } from '../types/dashboard';

interface ContractResultsPanelProps {
  results: ContractResultRow[];
  total: number;
}

export function ContractResultsPanel({ results, total }: ContractResultsPanelProps) {
  if (total === 0) {
    return (
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <FileCheck className="w-5 h-5 text-emerald-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Contract Results</h3>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">No contract results yet</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FileCheck className="w-5 h-5 text-emerald-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Contract Results</h3>
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400">{total} results</span>
      </div>
      <div className="space-y-2 max-h-[280px] overflow-y-auto">
        {results.map((row, idx) => {
          const iconKey = row.id ?? idx;
          const passed =
            row.result === 'pass' || row.result === 'valid' || row.result === 'success';
          return (
            <div
              key={iconKey}
              className="flex items-start gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50"
            >
              <div
                className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                  passed ? 'bg-emerald-400' : 'bg-red-400'
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate"
                    title={row.contract_id}
                  >
                    {row.contract_id}
                  </span>
                  <span
                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                      passed
                        ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                    }`}
                  >
                    {row.result}
                  </span>
                </div>
                {row.score !== undefined && row.score !== null && (
                  <div className="mt-1 flex items-center gap-1">
                    <div className="h-1 flex-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          row.score >= 80
                            ? 'bg-emerald-400'
                            : row.score >= 50
                              ? 'bg-amber-400'
                              : 'bg-red-400'
                        }`}
                        style={{ width: `${row.score}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">
                      {row.score}%
                    </span>
                  </div>
                )}
                <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                  {row.created_at ? new Date(row.created_at).toLocaleString() : ''}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
