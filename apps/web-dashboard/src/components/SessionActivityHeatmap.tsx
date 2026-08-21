import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Clock, Activity, Zap } from 'lucide-react';
import type { Session } from '../types/dashboard';

interface SessionActivityHeatmapProps {
  sessions: Session[];
}

const HEAT_COLORS = [
  '#e0f2fe', // 0 - very light
  '#bae6fd',
  '#7dd3fc',
  '#38bdf8',
  '#0ea5e9',
  '#0284c7', // 5 - medium
  '#0369a1',
  '#075985',
  '#0c4a6e', // 8 - very dark
];

function getHeatLevel(count: number, maxCount: number): number {
  if (count === 0 || maxCount === 0) return 0;
  const ratio = count / maxCount;
  if (ratio >= 0.9) return 8;
  if (ratio >= 0.7) return 7;
  if (ratio >= 0.5) return 6;
  if (ratio >= 0.35) return 5;
  if (ratio >= 0.2) return 4;
  if (ratio >= 0.1) return 3;
  if (ratio >= 0.05) return 2;
  return 1;
}

function toHourLabel(h: number): string {
  const period = h < 12 ? 'AM' : 'PM';
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour}${period}`;
}

export function SessionActivityHeatmap({ sessions }: SessionActivityHeatmapProps) {
  const hourlyData = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      label: toHourLabel(i),
      active: 0,
      total: 0,
    }));

    for (const s of sessions) {
      try {
        const h = new Date(s.startTime).getHours();
        const bucket = buckets[h];
        if (bucket) {
          bucket.total++;
          if (s.status === 'active') bucket.active++;
        }
      } catch {
        /* skip */
      }
    }

    const nonEmpty = buckets.filter((b) => b.total > 0);
    if (nonEmpty.length === 0) return [];

    const firstIdx = Math.max(0, buckets.findIndex((b) => b.total > 0) - 1);
    let lastIdx = 0;
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (buckets[i].total > 0) {
        lastIdx = i;
        break;
      }
    }
    lastIdx = Math.min(23, lastIdx + 1);
    return buckets.slice(firstIdx, lastIdx + 1);
  }, [sessions]);

  const maxCount = useMemo(() => {
    if (hourlyData.length === 0) return 0;
    return Math.max(...hourlyData.map((b) => b.total));
  }, [hourlyData]);

  if (hourlyData.length === 0) {
    return (
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-5 h-5 text-purple-500" />
          <h3 className="font-semibold text-gray-900 dark:text-white">Session Activity</h3>
        </div>
        <div className="text-center py-6 text-gray-400 dark:text-gray-500 text-sm">
          <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No session data yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-purple-500" />
          <h3 className="font-semibold text-gray-900 dark:text-white">Session Activity</h3>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>{sessions.length} sessions</span>
          <span className="w-px h-3 bg-gray-300 dark:bg-gray-600" />
          <Zap className="w-3 h-3 text-green-500" />
          <span>{sessions.filter((s) => s.status === 'active').length} active</span>
        </div>
      </div>

      {/* Heatmap grid */}
      <div className="flex gap-1 mb-3">
        {hourlyData.map((b) => {
          const level = getHeatLevel(b.total, maxCount);
          return (
            <div
              key={b.hour}
              className="flex-1 flex flex-col items-center gap-1"
              title={`${b.label}: ${b.total} sessions (${b.active} active)`}
            >
              <div
                className="w-full rounded-sm transition-colors hover:opacity-80"
                style={{
                  backgroundColor: HEAT_COLORS[level],
                  height: `${Math.max(8, (b.total / maxCount) * 40)}px`,
                  minHeight: '8px',
                }}
              />
              <span className="text-[10px] text-gray-500 dark:text-gray-400">{b.label}</span>
            </div>
          );
        })}
      </div>

      {/* Bar chart */}
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={hourlyData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
            <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} interval={0} />
            <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} allowDecimals={false} />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '12px',
              }}
              formatter={(value: number, name: string) => [
                value,
                name === 'total' ? 'Total Sessions' : 'Active Sessions',
              ]}
            />
            <Bar dataKey="total" fill="#0ea5e9" radius={[2, 2, 0, 0]} name="total" />
            <Bar dataKey="active" fill="#10b981" radius={[2, 2, 0, 0]} name="active" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
