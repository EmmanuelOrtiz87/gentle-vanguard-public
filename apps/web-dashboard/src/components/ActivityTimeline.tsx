import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Clock } from 'lucide-react';
import type { MetricHistory } from '../types/dashboard';

interface ActivityTimelineProps {
  history: MetricHistory[];
}

function toHourLabel(h: number): string {
  const period = h < 12 ? 'AM' : 'PM';
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour}${period}`;
}

export function ActivityTimeline({ history }: ActivityTimelineProps) {
  const hourlyData = useMemo(() => {
    if (history.length === 0) return [];

    // Create 24-hour buckets
    const buckets = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      label: toHourLabel(i),
      tokens: 0,
      sessions: 0,
      mcpSkills: 0,
      commits: 0,
      count: 0,
    }));

    // Fill buckets from history data
    for (const entry of history) {
      try {
        const h = new Date(entry.timestamp).getHours();
        const bucket = buckets[h];
        if (bucket) {
          bucket.tokens += entry.tokens;
          bucket.sessions += entry.sessions || 0;
          bucket.mcpSkills += entry.mcpSkills || 0;
          bucket.commits += entry.commits || 0;
          bucket.count++;
        }
      } catch {
        // skip invalid timestamps
      }
    }

    // Only return buckets that have data + adjacent context
    const nonEmpty = buckets.filter((b) => b.count > 0);
    if (nonEmpty.length === 0) return [];

    const firstIdx = Math.max(0, buckets.findIndex((b) => b.count > 0) - 1);
    let lastIdx = 0;
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (buckets[i].count > 0) {
        lastIdx = i;
        break;
      }
    }
    lastIdx = Math.min(23, lastIdx + 1);
    return buckets.slice(firstIdx, lastIdx + 1).map((b) => ({
      ...b,
      tokens: Math.round(b.tokens / (b.count || 1)),
      sessions: Math.round(b.sessions / (b.count || 1)),
    }));
  }, [history]);

  if (hourlyData.length === 0) {
    return (
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-5 h-5 text-amber-500" />
          <h3 className="font-semibold text-gray-900 dark:text-white">24h Activity Timeline</h3>
        </div>
        <div className="text-center py-6 text-gray-400 dark:text-gray-500 text-sm">
          No temporal data yet — activity will appear here as metrics accumulate
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-5 h-5 text-amber-500" />
        <h3 className="font-semibold text-gray-900 dark:text-white">24h Activity Timeline</h3>
      </div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={hourlyData} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
            <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 11 }} interval={0} />
            <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '12px',
              }}
              formatter={(value: number, name: string) => {
                const labels: Record<string, string> = {
                  tokens: 'Avg Tokens',
                  sessions: 'Avg Sessions',
                };
                return [value.toLocaleString(), labels[name] || name];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: '11px', paddingTop: '4px' }}
              formatter={(value: string) => {
                const labels: Record<string, string> = {
                  tokens: 'Avg Tokens',
                  sessions: 'Avg Sessions',
                };
                return labels[value] || value;
              }}
            />
            <Bar dataKey="tokens" fill="#f59e0b" radius={[3, 3, 0, 0]} name="tokens" />
            <Bar dataKey="sessions" fill="#8b5cf6" radius={[3, 3, 0, 0]} name="sessions" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-gray-400 mt-2 text-center">
        Average token usage and session activity by hour (last {history.length} data points)
      </p>
    </div>
  );
}
