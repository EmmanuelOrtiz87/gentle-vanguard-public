import { useMemo } from 'react';
import { Cpu, TrendingUp } from 'lucide-react';
import type { SkillUsageRow } from '../types/dashboard';

interface SkillUsagePanelProps {
  skills: SkillUsageRow[];
  total: number;
}

export function SkillUsagePanel({ skills, total }: SkillUsagePanelProps) {
  const sorted = useMemo(() => [...skills].sort((a, b) => b.count - a.count), [skills]);

  if (total === 0) {
    return (
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Cpu className="w-5 h-5 text-indigo-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Skill Usage</h3>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">No skill usage data yet</p>
      </div>
    );
  }

  const maxCount = sorted[0]?.count ?? 1;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-indigo-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Skill Usage</h3>
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400">{total} skills</span>
      </div>
      <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
        {sorted.map((skill) => {
          const pct = maxCount > 0 ? (skill.count / maxCount) * 100 : 0;
          return (
            <div key={skill.skillId} className="group">
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span
                  className="font-medium text-gray-700 dark:text-gray-300 truncate max-w-[160px]"
                  title={skill.skillId}
                >
                  {skill.skillId}
                </span>
                <span className="text-gray-500 dark:text-gray-400 ml-2 whitespace-nowrap">
                  {skill.count} calls
                </span>
              </div>
              <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-400 dark:bg-indigo-500 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                <span>{skill.tokensUsed.toLocaleString()} tokens</span>
                <span>${skill.cost.toFixed(4)}</span>
              </div>
            </div>
          );
        })}
      </div>
      {total > 0 && (
        <div className="mt-3 pt-2 border-t border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500">
            <TrendingUp className="w-3 h-3" />
            <span>Most used: {sorted[0]?.skillId ?? 'N/A'}</span>
          </div>
        </div>
      )}
    </div>
  );
}
