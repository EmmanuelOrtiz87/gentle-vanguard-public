import { useEffect, useState } from 'react';
import {
  Activity,
  Clock,
  AlertCircle,
  GitBranch,
  Search,
  ChevronDown,
  ChevronUp,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import { readCached, writeCached } from '../lib/offlineCache';

const TRACES_CACHE_KEY = 'traces';

interface Trace {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'running' | 'completed' | 'error';
  attributes: Record<string, string>;
}

interface TraceStats {
  totalTraces: number;
  avgDuration: number;
  errorRate: number;
  activeSpans: number;
}

function TraceWaterfall({ trace, allTraces }: { trace: Trace; allTraces: Trace[] }) {
  const children = allTraces.filter((t) => t.parentSpanId === trace.spanId);
  const maxDuration = Math.max(...allTraces.map((t) => t.duration || 0), 1);
  const hasChildren = children.length > 0;
  const [expanded, setExpanded] = useState(true);

  const barWidth = trace.duration ? Math.max((trace.duration / maxDuration) * 100, 2) : 0;
  const barColor =
    trace.status === 'error'
      ? 'bg-red-500'
      : trace.status === 'running'
        ? 'bg-blue-400 animate-pulse'
        : 'bg-emerald-500';

  return (
    <div className="select-none">
      <div className="flex items-center gap-2 py-1.5 px-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded group">
        <button
          onClick={() => setExpanded(!expanded)}
          className={`p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${hasChildren ? '' : 'invisible'}`}
        >
          {expanded ? (
            <ChevronDown className="w-3 h-3 text-gray-400" />
          ) : (
            <ChevronUp className="w-3 h-3 text-gray-400" />
          )}
        </button>
        <div className="flex items-center gap-1.5 min-w-[180px]">
          <span
            className={`w-1.5 h-1.5 rounded-full ${trace.status === 'completed' ? 'bg-green-500' : trace.status === 'running' ? 'bg-blue-500' : 'bg-red-500'}`}
          />
          <span className="text-xs font-mono text-gray-700 dark:text-gray-300 truncate">
            {trace.name}
          </span>
        </div>
        <div className="flex-1 h-4 bg-gray-100 dark:bg-gray-700 rounded overflow-hidden min-w-[100px]">
          <div
            className={`h-full ${barColor} rounded transition-all duration-300`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400 w-16 text-right tabular-nums">
          {trace.duration ? `${trace.duration}ms` : '-'}
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500 w-12 text-right">
          {trace.attributes.model || ''}
        </span>
      </div>
      {expanded && hasChildren && (
        <div className="ml-4 border-l-2 border-gray-200 dark:border-gray-700 pl-2">
          {children.map((child) => (
            <TraceWaterfall key={child.spanId} trace={child} allTraces={allTraces} />
          ))}
        </div>
      )}
    </div>
  );
}

function TraceDetail({ trace, allTraces }: { trace: Trace; allTraces: Trace[] }) {
  const children = allTraces.filter((t) => t.parentSpanId === trace.spanId);
  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-3">{trace.name}</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs text-gray-500">Trace ID</p>
            <p className="font-mono text-gray-800 dark:text-gray-200">{trace.traceId}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Span ID</p>
            <p className="font-mono text-gray-800 dark:text-gray-200">{trace.spanId}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Duration</p>
            <p className="font-mono text-gray-800 dark:text-gray-200">{trace.duration}ms</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Status</p>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                trace.status === 'completed'
                  ? 'text-green-700 bg-green-50 dark:text-green-300 dark:bg-green-900/20'
                  : trace.status === 'error'
                    ? 'text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-900/20'
                    : 'text-blue-700 bg-blue-50 dark:text-blue-300 dark:bg-blue-900/20'
              }`}
            >
              {trace.status}
            </span>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          {Object.entries(trace.attributes).map(([k, v]) => (
            <div key={k} className="flex gap-1">
              <span className="text-gray-500 font-medium">{k}:</span>
              <span className="text-gray-800 dark:text-gray-200 truncate">{v}</span>
            </div>
          ))}
        </div>
      </div>
      {children.length > 0 && (
        <div className="card">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Child Spans ({children.length})
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">Name</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">
                    Duration
                  </th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">Input</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">Output</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">Cost</th>
                </tr>
              </thead>
              <tbody>
                {children.map((c) => (
                  <tr key={c.spanId} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 px-3 text-gray-800 dark:text-gray-200 font-mono text-xs">
                      {c.name}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400">
                      {c.duration}ms
                    </td>
                    <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400">
                      {c.attributes.inputTokens}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400">
                      {c.attributes.outputTokens}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400">
                      ${parseFloat(c.attributes.cost || '0').toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FeedbackButtons({ traceId, spanId }: { traceId: string; spanId: string }) {
  const [sent, setSent] = useState<'up' | 'down' | null>(null);
  const sendFeedback = async (type: 'up' | 'down') => {
    setSent(type);
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ traceId, spanId, type }),
      });
    } catch {
      /* best-effort */
    }
  };
  return (
    <div className="flex items-center gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={() => sendFeedback('up')}
        className={`p-1 rounded hover:bg-green-100 dark:hover:bg-green-900/30 ${sent === 'up' ? 'text-green-500' : 'text-gray-400'}`}
      >
        <ThumbsUp className="w-3 h-3" />
      </button>
      <button
        onClick={() => sendFeedback('down')}
        className={`p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 ${sent === 'down' ? 'text-red-500' : 'text-gray-400'}`}
      >
        <ThumbsDown className="w-3 h-3" />
      </button>
    </div>
  );
}

export function TracingDashboard() {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [stats, setStats] = useState<TraceStats>({
    totalTraces: 0,
    avgDuration: 0,
    errorRate: 0,
    activeSpans: 0,
  });
  const [selectedTrace, setSelectedTrace] = useState<Trace | null>(null);
  const [search, setSearch] = useState('');
  const [filterModel, setFilterModel] = useState('');
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const loadTraces = async () => {
      try {
        const response = await fetch('/api/traces');
        const data = await response.json();
        setTraces(data.traces || []);
        setStats(data.stats || stats);
        writeCached(TRACES_CACHE_KEY, { traces: data.traces || [], stats: data.stats || stats });
        setOffline(false);
      } catch {
        const cached = readCached<{ traces: Trace[]; stats: TraceStats }>(TRACES_CACHE_KEY);
        if (cached?.data) {
          setTraces(cached.data.traces || []);
          setStats(cached.data.stats || stats);
          setOffline(true);
        }
      }
    };
    void loadTraces();
    const interval = setInterval(loadTraces, 5000);
    return () => clearInterval(interval);
  }, []);

  const rootTraces = traces.filter((t) => !t.parentSpanId || t.parentSpanId === t.traceId);
  const models = [...new Set(traces.map((t) => t.attributes.model).filter(Boolean))];

  const filteredRoots = rootTraces.filter((t) => {
    if (
      search &&
      !t.name.toLowerCase().includes(search.toLowerCase()) &&
      !t.traceId.toLowerCase().includes(search.toLowerCase())
    )
      return false;
    if (filterModel && t.attributes.model !== filterModel) return false;
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      {offline && (
        <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2 text-sm text-amber-700 dark:text-amber-300">
          Offline mode — showing cached traces (server unavailable)
        </div>
      )}
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="metric-label">Total Traces</p>
              <p className="metric-value">{stats.totalTraces}</p>
            </div>
            <Activity className="w-8 h-8 text-blue-500" />
          </div>
        </div>
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="metric-label">Avg Duration</p>
              <p className="metric-value">{stats.avgDuration}ms</p>
            </div>
            <Clock className="w-8 h-8 text-yellow-500" />
          </div>
        </div>
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="metric-label">Error Rate</p>
              <p className="metric-value">{(stats.errorRate * 100).toFixed(1)}%</p>
            </div>
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
        </div>
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="metric-label">Active Spans</p>
              <p className="metric-value">{stats.activeSpans}</p>
            </div>
            <GitBranch className="w-8 h-8 text-green-500" />
          </div>
        </div>
      </div>

      {/* Waterfall View */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Trace Waterfall</h3>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search traces..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 pr-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 w-40"
              />
            </div>
            {models.length > 0 && (
              <select
                value={filterModel}
                onChange={(e) => setFilterModel(e.target.value)}
                className="px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              >
                <option value="">All models</option>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {traces.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Activity className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No traces available. Start a session to generate trace data.</p>
            <p className="text-xs text-gray-500 mt-1">
              Traces are read from .session/context-log/*/.state.json
            </p>
          </div>
        ) : (
          <>
            {/* Waterfall header */}
            <div className="flex items-center gap-2 pb-2 border-b border-gray-200 dark:border-gray-700 mb-1 text-xs text-gray-500 font-medium">
              <div className="w-[22px]" />
              <div className="min-w-[180px]">Name</div>
              <div className="flex-1">Timeline</div>
              <div className="w-16 text-right">Duration</div>
              <div className="w-12 text-right">Model</div>
              <div className="w-16" />
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {filteredRoots.map((t) => (
                <div key={t.spanId} className="group">
                  <div
                    className="flex items-center cursor-pointer"
                    onClick={() => setSelectedTrace(selectedTrace?.spanId === t.spanId ? null : t)}
                  >
                    <TraceWaterfall trace={t} allTraces={traces} />
                    <FeedbackButtons traceId={t.traceId} spanId={t.spanId} />
                  </div>
                  {selectedTrace?.spanId === t.spanId && (
                    <div className="ml-6 mb-3">
                      <TraceDetail trace={t} allTraces={traces} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Legacy table for quick reference */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">All Spans</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-2 px-4 text-sm font-medium text-gray-500">Span ID</th>
                <th className="text-left py-2 px-4 text-sm font-medium text-gray-500">Name</th>
                <th className="text-left py-2 px-4 text-sm font-medium text-gray-500">Status</th>
                <th className="text-right py-2 px-4 text-sm font-medium text-gray-500">Duration</th>
                <th className="text-left py-2 px-4 text-sm font-medium text-gray-500">Model</th>
                <th className="text-right py-2 px-4 text-sm font-medium text-gray-500">Input</th>
                <th className="text-right py-2 px-4 text-sm font-medium text-gray-500">Output</th>
                <th className="text-right py-2 px-4 text-sm font-medium text-gray-500">Cost</th>
              </tr>
            </thead>
            <tbody>
              {traces.map((t) => (
                <tr
                  key={t.spanId}
                  className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                  onClick={() => setSelectedTrace(t)}
                >
                  <td className="py-2 px-4 text-sm font-mono text-gray-600 dark:text-gray-400">
                    {t.spanId.substring(0, 16)}
                  </td>
                  <td className="py-2 px-4 text-sm text-gray-900 dark:text-white">{t.name}</td>
                  <td className="py-2 px-4">
                    <span
                      className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                        t.status === 'completed'
                          ? 'text-green-700 bg-green-50 dark:text-green-300 dark:bg-green-900/20'
                          : t.status === 'running'
                            ? 'text-blue-700 bg-blue-50 dark:text-blue-300 dark:bg-blue-900/20'
                            : 'text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-900/20'
                      }`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="py-2 px-4 text-sm text-right text-gray-600 dark:text-gray-400 tabular-nums">
                    {t.duration ? `${t.duration}ms` : '-'}
                  </td>
                  <td className="py-2 px-4 text-sm text-gray-600 dark:text-gray-400">
                    {t.attributes.model || '-'}
                  </td>
                  <td className="py-2 px-4 text-sm text-right text-gray-600 dark:text-gray-400 tabular-nums">
                    {t.attributes.inputTokens}
                  </td>
                  <td className="py-2 px-4 text-sm text-right text-gray-600 dark:text-gray-400 tabular-nums">
                    {t.attributes.outputTokens}
                  </td>
                  <td className="py-2 px-4 text-sm text-right text-gray-600 dark:text-gray-400 tabular-nums">
                    ${parseFloat(t.attributes.cost || '0').toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default TracingDashboard;
