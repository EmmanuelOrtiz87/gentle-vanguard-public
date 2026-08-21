import { GitBranch } from 'lucide-react';
import type { RoutingRuleRow } from '../types/dashboard';

interface RoutingRulesPanelProps {
  rules: RoutingRuleRow[];
  total: number;
}

export function RoutingRulesPanel({ rules, total }: RoutingRulesPanelProps) {
  if (total === 0) {
    return (
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <GitBranch className="w-5 h-5 text-sky-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Routing Rules</h3>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">No routing rules configured</p>
      </div>
    );
  }

  const sorted = [...rules].sort((a, b) => b.priority - a.priority || b.hitCount - a.hitCount);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-sky-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Routing Rules</h3>
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400">{total} rules</span>
      </div>
      <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
        {sorted.map((rule) => (
          <div
            key={rule.pattern}
            className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 group hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-medium text-gray-700 dark:text-gray-300 truncate">
                  {rule.pattern}
                </span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500">→</span>
                <span className="text-xs font-mono text-indigo-600 dark:text-indigo-400 truncate">
                  {rule.target}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                  Priority: {rule.priority}
                </span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                  Hits: {rule.hitCount}
                </span>
              </div>
            </div>
            <span
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                rule.priority >= 10
                  ? 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400'
                  : rule.priority >= 5
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
              }`}
            >
              P{rule.priority}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
