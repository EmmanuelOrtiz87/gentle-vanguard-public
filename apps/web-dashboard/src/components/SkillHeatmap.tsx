import { useMemo } from 'react';
import { Cpu } from 'lucide-react';
import { useT } from '../hooks/useLocale';

interface SkillHeatmapProps {
  bySkill: Record<string, number>;
  totalSkills: number;
  totalCalls: number;
}

// Color palette by usage intensity (Tailwind)
const HEAT_COLORS = [
  'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400', // 0 calls
  'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300', // low
  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  'bg-blue-200 text-blue-800 dark:bg-blue-800/40 dark:text-blue-200',
  'bg-indigo-200 text-indigo-800 dark:bg-indigo-800/40 dark:text-indigo-200',
  'bg-indigo-300 text-indigo-900 dark:bg-indigo-700/40 dark:text-indigo-200',
  'bg-purple-300 text-purple-900 dark:bg-purple-700/40 dark:text-purple-200',
  'bg-purple-400 text-white dark:bg-purple-600/60 dark:text-white',
  'bg-violet-500 text-white dark:bg-violet-500/60 dark:text-white', // high
];

function getHeatLevel(count: number, maxCount: number): number {
  if (count === 0) return 0;
  if (maxCount === 0) return 1;
  const ratio = count / maxCount;
  if (ratio >= 0.9) return 8;
  if (ratio >= 0.7) return 7;
  if (ratio >= 0.5) return 6;
  if (ratio >= 0.35) return 5;
  if (ratio >= 0.2) return 4;
  if (ratio >= 0.1) return 3;
  return 2;
}

function getFontSize(calls: number, maxCalls: number): string {
  const ratio = calls / (maxCalls || 1);
  if (ratio >= 0.5) return 'text-sm';
  if (ratio >= 0.2) return 'text-xs';
  return 'text-[11px]';
}

export function SkillHeatmap({ bySkill, totalSkills, totalCalls }: SkillHeatmapProps) {
  const { tt } = useT();
  const entries = useMemo(() => {
    return Object.entries(bySkill).sort(([, a], [, b]) => b - a);
  }, [bySkill]);

  const maxCount = useMemo(() => {
    if (entries.length === 0) return 0;
    return Math.max(...entries.map(([, c]) => c));
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Cpu className="w-5 h-5 text-purple-500" />
          <h3 className="font-semibold text-gray-900 dark:text-white">{tt('ui.skill_activity')}</h3>
        </div>
        <div className="text-center py-6 text-gray-400 dark:text-gray-500">
          <Cpu className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">{tt('ui.no_skill_usage_yet')}</p>
          <p className="text-xs mt-1">{tt('ui.no_activity_yet')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-purple-500" />
          <h3 className="font-semibold text-gray-900 dark:text-white">{tt('ui.skill_activity')}</h3>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>
            {totalSkills} {tt('ui.skills')}
          </span>
          <span className="w-px h-3 bg-gray-300 dark:bg-gray-600" />
          <span>
            {totalCalls.toLocaleString()} {tt('ui.calls')}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {entries.map(([skill, calls]) => {
          const level = getHeatLevel(calls, maxCount);
          const fontSize = getFontSize(calls, maxCount);
          return (
            <div
              key={skill}
              className={`px-2 py-1 rounded-md ${HEAT_COLORS[level]} ${fontSize} font-medium transition-colors hover:opacity-80 cursor-default`}
              title={`${skill}: ${calls} call${calls !== 1 ? 's' : ''}`}
            >
              {skill}
              <span className="ml-1 opacity-60">{calls}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
