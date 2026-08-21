import { useState, useEffect } from 'react';
import { Gauge, HardDrive, Cpu, Clock, ShieldCheck, AlertTriangle } from 'lucide-react';

interface SloCheck {
  name: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  current: number;
  threshold: number;
  unit: string;
}

interface SloData {
  timestamp: string;
  passed: boolean;
  overall: { total: number; passed: number; warned: number; failed: number };
  checks: SloCheck[];
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  PASS: <ShieldCheck className="w-4 h-4 text-green-500" />,
  WARN: <AlertTriangle className="w-4 h-4 text-yellow-500" />,
  FAIL: <AlertTriangle className="w-4 h-4 text-red-500" />,
};

const STATUS_COLORS: Record<string, string> = {
  PASS: 'bg-green-50 border-green-300 dark:bg-green-900/10 dark:border-green-700',
  WARN: 'bg-yellow-50 border-yellow-300 dark:bg-yellow-900/10 dark:border-yellow-700',
  FAIL: 'bg-red-50 border-red-300 dark:bg-red-900/10 dark:border-red-700',
};

function CheckIcon({ name }: { name: string }) {
  if (name.includes('disk')) return <HardDrive className="w-5 h-5 text-blue-500" />;
  if (name.includes('memory')) return <Cpu className="w-5 h-5 text-purple-500" />;
  if (name.includes('latency')) return <Clock className="w-5 h-5 text-amber-500" />;
  return <Gauge className="w-5 h-5 text-gray-500" />;
}

export function SloPanel() {
  const [sloData, setSloData] = useState<SloData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSlo = () => {
      fetch('/api/slo')
        .then((r) => r.json())
        .then((json) => {
          if (json?.data) setSloData(json.data);
        })
        .catch(() => {
          /* dashboard not available */
        })
        .finally(() => setLoading(false));
    };
    fetchSlo();
    const interval = setInterval(fetchSlo, 15000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Gauge className="w-5 h-5 text-teal-500" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Performance SLO</h2>
        </div>
        <div className="card animate-pulse">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32 mb-3" />
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-48" />
        </div>
      </div>
    );
  }

  if (!sloData || !sloData.checks || sloData.checks.length === 0) {
    return (
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Gauge className="w-5 h-5 text-teal-500" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Performance SLO</h2>
        </div>
        <div className="card text-center py-6 text-gray-400 dark:text-gray-500">
          <Gauge className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">
            Run{' '}
            <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">
              npm run perf:slo
            </code>{' '}
            to generate SLO metrics
          </p>
        </div>
      </div>
    );
  }

  const total = sloData.overall || {
    total: sloData.checks.length,
    passed: 0,
    warned: 0,
    failed: 0,
  };

  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        <Gauge className="w-5 h-5 text-teal-500" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Performance SLO</h2>
        <span
          className={`ml-2 px-2 py-0.5 rounded text-xs font-medium ${
            sloData.passed
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
              : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
          }`}
        >
          {sloData.passed ? 'PASS' : 'WARN'}
        </span>
        <span className="text-xs text-gray-400">
          {new Date(sloData.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {/* Summary bar */}
      <div className="card mb-4">
        <div className="flex items-center gap-4 text-sm">
          <span className="text-green-600 dark:text-green-400 font-medium">
            ✅ {total.passed} passed
          </span>
          {total.warned > 0 && (
            <span className="text-yellow-600 dark:text-yellow-400 font-medium">
              ⚠️ {total.warned} warnings
            </span>
          )}
          {total.failed > 0 && (
            <span className="text-red-600 dark:text-red-400 font-medium">
              ❌ {total.failed} failed
            </span>
          )}
          <span className="text-gray-400">of {total.total} checks</span>
        </div>
      </div>

      {/* SLO Checks grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {sloData.checks.map((check, i) => {
          const pct =
            check.threshold > 0 ? Math.min(100, (check.current / check.threshold) * 100) : 0;
          const barColor =
            check.status === 'PASS'
              ? 'bg-green-500'
              : check.status === 'WARN'
                ? 'bg-yellow-500'
                : 'bg-red-500';
          return (
            <div
              key={`${check.name}-${i}`}
              className={`card border-l-4 ${STATUS_COLORS[check.status]}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <CheckIcon name={check.name} />
                  <p className="text-sm font-medium text-gray-900 dark:text-white capitalize">
                    {check.name.replace(/_/g, ' ')}
                  </p>
                </div>
                {STATUS_ICONS[check.status]}
              </div>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-2xl font-bold text-gray-900 dark:text-white">
                  {check.current}
                  {check.unit}
                </span>
                <span className="text-xs text-gray-500">
                  / {check.threshold}
                  {check.unit}
                </span>
              </div>
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Target: {'<'}
                {check.threshold}
                {check.unit}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
