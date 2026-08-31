import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleDollarSign, TrendingUp, Gauge, Lightbulb } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useT } from '../hooks/useLocale';

interface CostSlice {
  key: string;
  costUsd: number;
  totalTokens: number;
  sharePct: number;
}

interface CostReport {
  generatedAt: string;
  currency: string;
  totals: {
    costUsd: number;
    totalTokens: number;
    monthToDateCostUsd: number;
  };
  perDay: { date: string; costUsd: number; totalTokens: number }[];
  perAgent: CostSlice[];
  perModel: CostSlice[];
  topSessions: {
    sessionId: string;
    costUsd: number;
    totalTokens: number;
    transactions: number;
    lastActivity: string;
  }[];
  monthlyProjection: { from7d: number; from30d: number };
  budget: {
    dailyTokens: number;
    usedTodayTokens: number;
    usedTodayPct: number;
    softThresholdPct: number;
    hardThresholdPct: number;
    status: 'ok' | 'soft' | 'hard';
  };
  insight: string;
  unpricedModels: string[];
}

const fmtUsd = (value: number) =>
  `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtTokens = (value: number) => `${(value / 1e6).toFixed(1)}M`;

export function CostPanel() {
  const { tt } = useT();
  const [report, setReport] = useState<CostReport | null>(null);
  const [error, setError] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetch('/api/costs', { signal });
      if (!response.ok) {
        setError(true);
        return;
      }
      const payload = await response.json();
      setReport(payload.data ?? null);
      setError(false);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(true);
    }
  }, []);

  useEffect(() => {
    const poll = () => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      void refresh(controller.signal);
    };
    poll();
    // Server caches the aggregate for 5 min; poll slightly faster than that.
    const interval = window.setInterval(poll, 4 * 60 * 1000);
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
      window.clearInterval(interval);
    };
  }, [refresh]);

  if (error) {
    return (
      <section className="mb-8" aria-label={tt('ui.costs_title') ?? 'Runtime Costs'}>
        <div className="card p-4 text-xs text-red-500">
          {tt('ui.costs_unavailable') ?? 'Cost data unavailable (Nexus offline)'}
        </div>
      </section>
    );
  }
  if (!report) return null;

  const budgetTone =
    report.budget.status === 'hard'
      ? 'text-red-500'
      : report.budget.status === 'soft'
        ? 'text-amber-500'
        : 'text-emerald-500';

  return (
    <section className="mb-8" aria-label={tt('ui.costs_title') ?? 'Runtime Costs'} data-testid="cost-panel">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <CircleDollarSign className="w-5 h-5" style={{ color: '#00BFFF' }} />
            {tt('ui.costs_title') ?? 'Runtime Costs'}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {tt('ui.costs_subtitle') ??
              'Spend over historical Nexus token data (last 30 days) — reference pricing'}
          </p>
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {new Date(report.generatedAt).toLocaleString()}
        </span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="card p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-1">
            <CircleDollarSign className="w-4 h-4" style={{ color: '#00BFFF' }} />
            {tt('ui.costs_spent_month') ?? 'Spent this month'}
          </div>
          <div
            className="text-2xl font-semibold tabular-nums"
            data-testid="cost-card-month"
            style={{ color: '#00BFFF' }}
          >
            {fmtUsd(report.totals.monthToDateCostUsd)}
          </div>
          <div className="text-[10px] text-gray-400 mt-1">
            {fmtTokens(report.totals.totalTokens)} {tt('ui.costs_tokens_30d') ?? 'tokens (30d)'}
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-1">
            <TrendingUp className="w-4 h-4" style={{ color: '#A855F7' }} />
            {tt('ui.costs_projection') ?? 'Monthly projection'}
          </div>
          <div
            className="text-2xl font-semibold tabular-nums"
            data-testid="cost-card-projection"
            style={{ color: '#A855F7' }}
          >
            {fmtUsd(report.monthlyProjection.from30d)}
          </div>
          <div className="text-[10px] text-gray-400 mt-1">
            7d run-rate: {fmtUsd(report.monthlyProjection.from7d)}
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-1">
            <Gauge className="w-4 h-4" />
            {tt('ui.costs_budget_usage') ?? 'Budget usage (today)'}
          </div>
          <div className={`text-2xl font-semibold tabular-nums ${budgetTone}`} data-testid="cost-card-budget">
            {report.budget.usedTodayPct.toFixed(1)}%
          </div>
          <div className="text-[10px] text-gray-400 mt-1">
            {fmtTokens(report.budget.usedTodayTokens)} / {fmtTokens(report.budget.dailyTokens)}{' '}
            {tt('ui.costs_daily_limit') ?? 'daily limit'}
          </div>
        </div>
      </div>

      {/* Insight */}
      <div
        className="flex items-start gap-2 rounded-lg border px-3 py-2 mb-4 text-xs"
        style={{ borderColor: '#A855F7', color: '#A855F7' }}
        data-testid="cost-insight"
      >
        <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{report.insight}</span>
      </div>
      {report.unpricedModels.length > 0 && (
        <p className="text-[10px] text-gray-400 mb-4" data-testid="cost-unpriced">
          {tt('ui.costs_unpriced') ?? 'Unpriced models (cost counted as $0)'}:{' '}
          {report.unpricedModels.join(', ')}
        </p>
      )}

      {/* Cost per day chart */}
      <div className="card p-4 mb-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
          {tt('ui.costs_per_day') ?? 'Cost per day (30d)'}
        </h3>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={report.perDay} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#30363d" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9, fill: '#8b949e' }}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis tick={{ fontSize: 9, fill: '#8b949e' }} width={48} />
              <Tooltip
                cursor={{ fill: 'rgba(0,191,255,0.08)' }}
                contentStyle={{
                  background: '#0D1117',
                  border: '1px solid #30363d',
                  borderRadius: 8,
                  fontSize: 11,
                }}
                formatter={(value: number) => [fmtUsd(value), 'cost']}
              />
              <Bar dataKey="costUsd" fill="#00BFFF" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Breakdown by model / agent */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
        <BreakdownTable
          title={tt('ui.costs_by_model') ?? 'By model'}
          rows={report.perModel.slice(0, 8)}
        />
        <BreakdownTable
          title={tt('ui.costs_by_agent') ?? 'By agent'}
          rows={report.perAgent.slice(0, 8)}
        />
      </div>

      {/* Top sessions */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white p-4 pb-2">
          {tt('ui.costs_top_sessions') ?? 'Top 5 most expensive sessions'}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2 text-left">{tt('ui.session') ?? 'session'}</th>
                <th className="px-3 py-2 text-right">{tt('ui.cost') ?? 'cost'}</th>
                <th className="px-3 py-2 text-right">{tt('ui.costs_tokens') ?? 'tokens'}</th>
                <th className="px-3 py-2 text-right">{tt('ui.costs_txns') ?? 'messages'}</th>
                <th className="px-3 py-2 text-right">{tt('ui.last_used') ?? 'last activity'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {report.topSessions.map((s) => (
                <tr key={s.sessionId} className="bg-white dark:bg-gray-900">
                  <td
                    className="px-3 py-1.5 font-mono text-[10px] text-gray-700 dark:text-gray-300 truncate max-w-[160px]"
                    title={s.sessionId}
                  >
                    {s.sessionId}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-700 dark:text-gray-300">
                    {fmtUsd(s.costUsd)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-500 dark:text-gray-400">
                    {s.totalTokens.toLocaleString()}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-500 dark:text-gray-400">
                    {s.transactions}
                  </td>
                  <td className="px-3 py-1.5 text-right text-gray-400 dark:text-gray-500 whitespace-nowrap">
                    {s.lastActivity ? s.lastActivity.slice(0, 16) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: CostSlice[] }) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white p-4 pb-2">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
            <tr>
              <th className="px-3 py-2 text-left">model/agent</th>
              <th className="px-3 py-2 text-right">cost</th>
              <th className="px-3 py-2 text-right">tokens</th>
              <th className="px-3 py-2 text-right">%</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((r) => (
              <tr key={r.key} className="bg-white dark:bg-gray-900">
                <td className="px-3 py-1.5 font-mono text-[10px] text-gray-700 dark:text-gray-300 truncate max-w-[140px]" title={r.key}>
                  {r.key}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-700 dark:text-gray-300">
                  {fmtUsd(r.costUsd)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-500 dark:text-gray-400">
                  {r.totalTokens.toLocaleString()}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: '#A855F7' }}>
                  {r.sharePct.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default CostPanel;
