import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { MetricHistory } from '../types/dashboard';

interface LiveChartProps {
  data: MetricHistory[];
}

export function LiveChart({ data }: LiveChartProps) {
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="card">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Metrics History</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatTime}
              tick={{ fill: '#6b7280', fontSize: 12 }}
            />
            <YAxis tick={{ fill: '#6b7280', fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="tokens"
              stroke="#0ea5e9"
              strokeWidth={2}
              dot={false}
              name="Tokens"
            />
            <Line
              type="monotone"
              dataKey="sessions"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
              name="Sessions"
            />
            <Line
              type="monotone"
              dataKey="cost"
              stroke="#8b5cf6"
              strokeWidth={2}
              dot={false}
              name="Cost ($)"
            />
            {(data.length === 0 || data.some((d) => (d as any).latency)) && (
              <Line
                type="monotone"
                dataKey="latency"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
                name="Latency (ms)"
              />
            )}
            <Line
              type="monotone"
              dataKey="mcpSkills"
              stroke="#ec4899"
              strokeWidth={2}
              dot={false}
              name="MCP Skills"
            />
            <Line
              type="monotone"
              dataKey="commits"
              stroke="#f97316"
              strokeWidth={2}
              dot={false}
              name="Commits"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
