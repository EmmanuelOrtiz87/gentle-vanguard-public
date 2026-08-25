import { useEffect, useState, useMemo, useRef } from 'react';
import {
  Activity,
  Clock,
  AlertCircle,
  GitBranch,
  Search,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Download,
  ThumbsUp,
  ThumbsDown,
  Coins,
  Zap,
  Copy,
  Check,
  X,
  FileText,
} from 'lucide-react';
import { readCached, writeCached } from '../lib/offlineCache';
import { useT } from '../hooks/useLocale';

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

function TraceWaterfall({
  trace,
  allTraces,
  treeStart,
  treeDuration,
  onFocus,
}: {
  trace: Trace;
  allTraces: Trace[];
  treeStart?: number;
  treeDuration?: number;
  onFocus?: () => void;
}) {
  const { tt } = useT();
  const children = allTraces.filter((t) => t.parentSpanId === trace.spanId);
  const hasChildren = children.length > 0;
  const [expanded, setExpanded] = useState(true);

  // Compute relative timeline positioning for real waterfall effect
  const rootStart = treeStart ?? trace.startTime;
  const rootDur = treeDuration ?? Math.max(trace.duration || 1, 1);
  const leftPercent = rootDur > 0 ? Math.max(0, Math.min(99, ((trace.startTime - rootStart) / rootDur) * 100)) : 0;
  const widthPercent = rootDur > 0 ? Math.max(1, Math.min(100 - leftPercent, ((trace.duration || 1) / rootDur) * 100)) : 100;

  const barColor =
    trace.status === 'error'
      ? 'bg-red-500'
      : trace.status === 'running'
        ? 'bg-blue-400 animate-pulse'
        : 'bg-emerald-500';

  return (
    <div className="select-none">
      <div className="flex items-center gap-2 py-1.5 px-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded group transition-colors">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
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
          <span
            className="text-xs font-mono text-gray-700 dark:text-gray-300 truncate cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
            title={tt('ui.focus_trace')}
            onClick={(e) => {
              e.stopPropagation();
              onFocus?.();
            }}
          >
            {trace.name}
          </span>
        </div>
        <div className="flex-1 h-4 bg-gray-100 dark:bg-gray-900 rounded overflow-hidden min-w-[120px] relative border border-gray-200/50 dark:border-gray-700/50">
          <div
            className={`absolute h-full ${barColor} rounded transition-all duration-300 shadow-sm`}
            style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
            title={`${trace.name}: ${trace.duration || 0}ms (+${Math.round(trace.startTime - rootStart)}ms offset)`}
          />
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400 w-16 text-right tabular-nums font-mono">
          {trace.duration ? `${trace.duration}ms` : '-'}
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500 w-16 text-right truncate">
          {trace.attributes.model || '—'}
        </span>
      </div>
      {expanded && hasChildren && (
        <div className="ml-4 border-l-2 border-gray-200 dark:border-gray-700 pl-2">
          {children.map((child) => (
            <TraceWaterfall
              key={child.spanId}
              trace={child}
              allTraces={allTraces}
              treeStart={rootStart}
              treeDuration={rootDur}
              onFocus={onFocus}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Drag-select time ruler for the focused waterfall. Drag horizontally to zoom
 * the visible time window; spans outside the selection are hidden and bars rescale.
 */
function TimeRulerZoom({
  totalMs,
  range,
  onCommit,
  onReset,
}: {
  totalMs: number;
  range: { start: number; end: number } | null;
  onCommit: (r: { start: number; end: number }) => void;
  onReset: () => void;
}) {
  const { tt } = useT();
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; x1: number } | null>(null);

  const pctFromEvent = (e: React.PointerEvent): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
  };

  const selPct = drag
    ? { left: Math.min(drag.x0, drag.x1), right: Math.max(drag.x0, drag.x1) }
    : range
      ? { left: (range.start / totalMs) * 100, right: (range.end / totalMs) * 100 }
      : null;

  const fmt = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);

  return (
    <div className="flex items-center gap-3 mb-1 px-2">
      <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 w-16 shrink-0" title={tt('ui.zoom_hint')}>
        {tt('ui.time_window')}
      </span>
      <div
        ref={trackRef}
        role="slider"
        aria-label={tt('ui.zoom_hint')}
        className="relative flex-1 h-6 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200/60 dark:border-gray-700/60 cursor-col-resize select-none touch-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = pctFromEvent(e);
          setDrag({ x0: p, x1: p });
        }}
        onPointerMove={(e) => {
          if (drag) setDrag({ ...drag, x1: pctFromEvent(e) });
        }}
        onPointerUp={() => {
          if (drag) {
            const s = (Math.min(drag.x0, drag.x1) / 100) * totalMs;
            const en = (Math.max(drag.x0, drag.x1) / 100) * totalMs;
            if (en - s >= 5) onCommit({ start: s, end: en });
            setDrag(null);
          }
        }}
      >
        {/* tick marks at 25/50/75% */}
        {[25, 50, 75].map((p) => (
          <div key={p} className="absolute top-0 bottom-0 w-px bg-gray-200 dark:bg-gray-800" style={{ left: `${p}%` }} />
        ))}
        {/* active selection or committed range highlight */}
        {selPct && (
          <div
            className={`absolute top-0 bottom-0 ${drag ? 'bg-blue-500/30 border-x-2 border-blue-500' : 'bg-blue-500/15 border-x border-blue-400'}`}
            style={{ left: `${selPct.left}%`, width: `${selPct.right - selPct.left}%` }}
          />
        )}
        <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[10px] font-mono text-gray-400 pointer-events-none">0</span>
        <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] font-mono text-gray-400 pointer-events-none">{fmt(totalMs)}</span>
      </div>
      <span className="text-[10px] font-mono text-gray-500 dark:text-gray-400 w-28 shrink-0 text-right tabular-nums">
        {range ? `${fmt(range.start)} → ${fmt(range.end)}` : tt('ui.zoom_hint')}
      </span>
      {range && (
        <button
          onClick={onReset}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline shrink-0 font-medium"
          title={tt('ui.reset_zoom')}
        >
          <X className="w-3 h-3 inline mr-0.5" />
          {tt('ui.reset_zoom')}
        </button>
      )}
    </div>
  );
}

function TraceModalDetail({
  trace,
  allTraces,
  onClose,
  onFocus,
}: {
  trace: Trace;
  allTraces: Trace[];
  onClose: () => void;
  onFocus?: (spanId: string) => void;
}) {
  const { tt } = useT();
  const [copiedTrace, setCopiedTrace] = useState(false);
  const [copiedSpan, setCopiedSpan] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const children = allTraces.filter((t) => t.parentSpanId === trace.spanId);

  const copyToClipboard = async (text: string, type: 'trace' | 'span') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'trace') {
        setCopiedTrace(true);
        setTimeout(() => setCopiedTrace(false), 2000);
      } else {
        setCopiedSpan(true);
        setTimeout(() => setCopiedSpan(false), 2000);
      }
    } catch {
      /* fallback ignore */
    }
  };

  const exportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(trace, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = `trace-${trace.spanId}.json`;
    a.click();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className={`w-3 h-3 rounded-full shrink-0 ${
                trace.status === 'completed'
                  ? 'bg-green-500'
                  : trace.status === 'running'
                    ? 'bg-blue-500 animate-pulse'
                    : 'bg-red-500'
              }`}
            />
            <div className="truncate">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate">{trace.name}</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                {new Date(trace.startTime).toLocaleString()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportJson}
              className="p-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title={tt('ui.export_trace_json')}
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Key metrics grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-100 dark:border-gray-800">
            <div>
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 block">{tt('ui.status')}</span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium mt-1 ${
                  trace.status === 'completed'
                    ? 'text-green-700 bg-green-50 dark:text-green-300 dark:bg-green-900/30'
                    : trace.status === 'error'
                      ? 'text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-900/30'
                      : 'text-blue-700 bg-blue-50 dark:text-blue-300 dark:bg-blue-900/30'
                }`}
              >
                {trace.status}
              </span>
            </div>
            <div>
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 block">{tt('ui.duration')}</span>
              <span className="text-sm font-semibold text-gray-900 dark:text-white font-mono mt-0.5 block">
                {trace.duration ? `${trace.duration}ms` : '-'}
              </span>
            </div>
            <div>
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 block">{tt('ui.model')}</span>
              <span className="text-sm font-semibold text-gray-900 dark:text-white truncate mt-0.5 block">
                {trace.attributes.model || '—'}
              </span>
            </div>
            <div>
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 block">{tt('ui.cost')}</span>
              <span className="text-sm font-semibold font-mono text-emerald-600 dark:text-emerald-400 mt-0.5 block">
                ${parseFloat(trace.attributes.cost || '0').toFixed(4)}
              </span>
            </div>
          </div>

          {/* IDs & Identifiers */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {tt('ui.identifiers')}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
              <div className="flex items-center justify-between p-2.5 rounded bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800">
                <span className="text-gray-500">Trace ID:</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-800 dark:text-gray-200 truncate max-w-[180px]">{trace.traceId}</span>
                  <button
                    onClick={() => copyToClipboard(trace.traceId, 'trace')}
                    className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    {copiedTrace ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800">
                <span className="text-gray-500">Span ID:</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-800 dark:text-gray-200 truncate max-w-[180px]">{trace.spanId}</span>
                  <button
                    onClick={() => copyToClipboard(trace.spanId, 'span')}
                    className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    {copiedSpan ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Attributes */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {tt('ui.attributes_metadata')}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {Object.entries(trace.attributes).map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-900/60 border border-gray-100 dark:border-gray-800"
                >
                  <span className="text-gray-500 font-medium">{k}</span>
                  <span className="text-gray-800 dark:text-gray-200 font-mono truncate max-w-[200px]">{v || '—'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Children Spans Table */}
          {children.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {tt('ui.child_spans').replace('{n}', String(children.length))}
              </h4>
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                    <tr>
                      <th className="text-left py-2 px-3 font-medium text-gray-500">{tt('ui.name')}</th>
                      <th className="text-right py-2 px-3 font-medium text-gray-500">{tt('ui.duration')}</th>
                      <th className="text-right py-2 px-3 font-medium text-gray-500">{tt('ui.input_tokens')}</th>
                      <th className="text-right py-2 px-3 font-medium text-gray-500">{tt('ui.output_tokens')}</th>
                      <th className="text-right py-2 px-3 font-medium text-gray-500">{tt('ui.cost')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {children.map((c) => (
                      <tr key={c.spanId} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                        <td className="py-2 px-3 font-mono text-gray-800 dark:text-gray-200">{c.name}</td>
                        <td className="py-2 px-3 text-right font-mono text-gray-600 dark:text-gray-400">
                          {c.duration}ms
                        </td>
                        <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400 font-mono">
                          {c.attributes.inputTokens || 0}
                        </td>
                        <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400 font-mono">
                          {c.attributes.outputTokens || 0}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-emerald-600 dark:text-emerald-400">
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

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
          {onFocus ? (
            <button
              onClick={() => {
                onFocus(trace.spanId);
                onClose();
              }}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >
              {tt('ui.focus_subtree')}
            </button>
          ) : (
            <div />
          )}
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            {tt('ui.close')}
          </button>
        </div>
      </div>
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
        onClick={(e) => {
          e.stopPropagation();
          sendFeedback('up');
        }}
        className={`p-1 rounded hover:bg-green-100 dark:hover:bg-green-900/30 ${sent === 'up' ? 'text-green-500' : 'text-gray-400'}`}
      >
        <ThumbsUp className="w-3 h-3" />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          sendFeedback('down');
        }}
        className={`p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 ${sent === 'down' ? 'text-red-500' : 'text-gray-400'}`}
      >
        <ThumbsDown className="w-3 h-3" />
      </button>
    </div>
  );
}

export function TracingDashboard() {
  const { tt } = useT();
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
  const [tablePage, setTablePage] = useState(0);
  const [wfPage, setWfPage] = useState(0);
  const [range, setRange] = useState<'all' | '1h' | '24h' | '7d'>('all');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const loadTraces = async () => {
      try {
        const qs = range === 'all' ? '' : `?range=${range}`;
        const response = await fetch(`/api/traces${qs}`);
        const data = await response.json();
        setTraces(data.traces || []);
        setStats(data.stats || stats);
        writeCached(TRACES_CACHE_KEY, { traces: data.traces || [], stats: data.stats || stats });
        setOffline(false);
        setLastUpdate(new Date());
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const exportCsv = () => {
    const header = 'name,status,duration_ms,model,input_tokens,output_tokens,cost,start_time';
    const lines = recentSpans.map((t) =>
      [
        `"${t.name.replace(/"/g, '""')}"`,
        t.status,
        t.duration ?? '',
        t.attributes.model || '',
        t.attributes.inputTokens,
        t.attributes.outputTokens,
        t.attributes.cost,
        new Date(t.startTime).toISOString(),
      ].join(','),
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `traces-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const rootTraces = traces.filter((t) => !t.parentSpanId || t.parentSpanId === t.traceId);
  const models = [...new Set(traces.map((t) => t.attributes.model).filter(Boolean))];

  const matchesFilters = (t: Trace) => {
    if (
      search &&
      !t.name.toLowerCase().includes(search.toLowerCase()) &&
      !t.traceId.toLowerCase().includes(search.toLowerCase())
    )
      return false;
    if (filterModel && t.attributes.model !== filterModel) return false;
    return true;
  };

  const filteredRoots = rootTraces.filter(matchesFilters);

  // Computed Token and Cost totals for current filtered timeframe
  const totalTokens = useMemo(() => {
    return traces.reduce(
      (acc, t) => acc + (Number(t.attributes.inputTokens) || 0) + (Number(t.attributes.outputTokens) || 0),
      0,
    );
  }, [traces]);

  const totalCost = useMemo(() => {
    return traces.reduce((acc, t) => acc + (Number(t.attributes.cost) || 0), 0);
  }, [traces]);

  // Recent spans table: newest first, filtered, paginated (10/page).
  const recentSpans = useMemo(() => {
    return traces.filter(matchesFilters).sort((a, b) => b.startTime - a.startTime);
  }, [traces, search, filterModel]);

  const TABLE_PAGE_SIZE = 10;
  const tablePages = Math.max(1, Math.ceil(recentSpans.length / TABLE_PAGE_SIZE));
  const safeTablePage = Math.min(tablePage, tablePages - 1);
  const tableRows = recentSpans.slice(
    safeTablePage * TABLE_PAGE_SIZE,
    (safeTablePage + 1) * TABLE_PAGE_SIZE,
  );

  // Waterfall: same filters, paginated roots (10/page). Focus mode drills into one trace subtree.
  const focusRoot = focusId ? (filteredRoots.find((t) => t.spanId === focusId) ?? null) : null;
  const focusSet = focusRoot
    ? [focusRoot, ...traces.filter((t) => t.traceId === focusRoot.traceId && t.parentSpanId)]
    : [];
  const WF_PAGE_SIZE = 10;
  const wfPages = Math.max(1, Math.ceil(filteredRoots.length / WF_PAGE_SIZE));
  const safeWfPage = Math.min(wfPage, wfPages - 1);
  const wfRows = focusRoot
    ? [focusRoot]
    : filteredRoots.slice(safeWfPage * WF_PAGE_SIZE, (safeWfPage + 1) * WF_PAGE_SIZE);
  const filtersActive = Boolean(search || filterModel);

  // Time-window zoom (focus mode only): hide spans outside selection, rescale bars.
  const [zoomRange, setZoomRange] = useState<{ start: number; end: number } | null>(null);
  useEffect(() => {
    setZoomRange(null);
  }, [focusId]);
  const zoomTotalMs = focusRoot
    ? Math.max(
        focusRoot.duration || 1,
        ...focusSet.map((t) => t.startTime - focusRoot.startTime + (t.duration || 0)),
        1,
      )
    : 1;
  const zoomedFocusSet = useMemo(() => {
    if (!focusRoot || !zoomRange) return focusSet;
    const zs = focusRoot.startTime + zoomRange.start;
    const ze = focusRoot.startTime + zoomRange.end;
    return focusSet.filter((t) => {
      if (t.spanId === focusRoot.spanId) return true;
      return t.startTime + (t.duration || 0) >= zs && t.startTime <= ze;
    });
  }, [focusSet, focusRoot, zoomRange]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      {offline && (
        <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2 text-sm text-amber-700 dark:text-amber-300">
          Offline mode — showing cached traces (server unavailable)
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="card p-3.5">
          <div className="flex items-center justify-between">
            <div title={tt('ui.tip_total_traces')}>
              <p className="metric-label text-xs">{tt('ui.total_traces')}</p>
              <p className="metric-value text-xl font-bold">{stats.totalTraces}</p>
            </div>
            <Activity className="w-6 h-6 text-blue-500 opacity-80" />
          </div>
        </div>
        <div className="card p-3.5">
          <div className="flex items-center justify-between">
            <div title={tt('ui.tip_avg_duration')}>
              <p className="metric-label text-xs">{tt('ui.avg_duration')}</p>
              <p className="metric-value text-xl font-bold">{stats.avgDuration}ms</p>
            </div>
            <Clock className="w-6 h-6 text-yellow-500 opacity-80" />
          </div>
        </div>
        <div className="card p-3.5">
          <div className="flex items-center justify-between">
            <div title={tt('ui.tip_error_rate')}>
              <p className="metric-label text-xs">{tt('ui.error_rate')}</p>
              <p className="metric-value text-xl font-bold">{(stats.errorRate * 100).toFixed(1)}%</p>
            </div>
            <AlertCircle className="w-6 h-6 text-red-500 opacity-80" />
          </div>
        </div>
        <div className="card p-3.5">
          <div className="flex items-center justify-between">
            <div title={tt('ui.tip_active_spans')}>
              <p className="metric-label text-xs">{tt('ui.active_spans')}</p>
              <p className="metric-value text-xl font-bold">{stats.activeSpans}</p>
            </div>
            <GitBranch className="w-6 h-6 text-green-500 opacity-80" />
          </div>
        </div>
        <div className="card p-3.5">
          <div className="flex items-center justify-between">
            <div>
              <p className="metric-label text-xs">{tt('ui.total_tokens')}</p>
              <p className="metric-value text-xl font-bold">{totalTokens.toLocaleString()}</p>
            </div>
            <Zap className="w-6 h-6 text-purple-500 opacity-80" />
          </div>
        </div>
        <div className="card p-3.5">
          <div className="flex items-center justify-between">
            <div>
              <p className="metric-label text-xs">{tt('ui.total_cost')}</p>
              <p className="metric-value text-xl font-bold text-emerald-600 dark:text-emerald-400">
                ${totalCost.toFixed(4)}
              </p>
            </div>
            <Coins className="w-6 h-6 text-emerald-500 opacity-80" />
          </div>
        </div>
      </div>

      {/* Waterfall View */}
      <div className="card">
        <div className="flex items-start justify-between mb-1 flex-wrap gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {tt('ui.trace_waterfall')}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 max-w-2xl">
              {tt('ui.waterfall_subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0 ml-auto">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder={tt('ui.search_traces')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 pr-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 w-40"
              />
            </div>
            {models.length > 0 && (
              <select
                value={filterModel}
                onChange={(e) => setFilterModel(e.target.value)}
                className="px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              >
                <option value="">{tt('ui.all_models')}</option>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m || '—'}
                  </option>
                ))}
              </select>
            )}
            <select
              value={range}
              onChange={(e) => {
                setRange(e.target.value as typeof range);
                setWfPage(0);
                setTablePage(0);
              }}
              className="px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              title={tt('ui.tip_range')}
            >
              <option value="all">{tt('ui.range_all')}</option>
              <option value="1h">{tt('ui.range_1h')}</option>
              <option value="24h">{tt('ui.range_24h')}</option>
              <option value="7d">{tt('ui.range_7d')}</option>
            </select>
            <button
              onClick={exportCsv}
              disabled={recentSpans.length === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-gray-600 dark:text-gray-300 font-medium transition-colors"
              title={tt('ui.export_csv')}
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
          </div>
        </div>

        {/* Filter status bar */}
        <div className="flex items-center justify-between mb-2 text-xs">
          <span className="text-gray-500 dark:text-gray-400">
            {focusRoot
              ? tt('ui.focused_on').replace('{name}', focusRoot.name)
              : tt('ui.showing_of')
                  .replace('{shown}', String(filteredRoots.length))
                  .replace('{total}', String(rootTraces.length))}
          </span>
          <span className="flex items-center gap-2">
            {offline ? (
              <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                {tt('ui.offline_cached')}
              </span>
            ) : (
              lastUpdate && (
                <span className="text-green-600 dark:text-green-400 flex items-center gap-1 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  {tt('ui.live_updated')} {lastUpdate.toLocaleTimeString()}
                </span>
              )
            )}
            {filtersActive && (
              <button
                onClick={() => {
                  setSearch('');
                  setFilterModel('');
                  setWfPage(0);
                  setTablePage(0);
                }}
                className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 font-medium ml-2"
              >
                <AlertCircle className="w-3 h-3" />
                {tt('ui.clear_filters')}
              </button>
            )}
          </span>
        </div>

        {traces.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Activity className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">{tt('ui.no_traces')}</p>
            <p className="text-xs text-gray-500 mt-1">{tt('ui.traces_source')}</p>
          </div>
        ) : filteredRoots.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <Search className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">{tt('ui.no_matches')}</p>
          </div>
        ) : (
          <>
            {/* Legend */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-2 text-[11px] text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                {tt('ui.legend_completed')}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                {tt('ui.legend_running')}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                {tt('ui.legend_error')}
              </span>
              <span className="italic">— {tt('ui.legend_bar')}</span>
            </div>

            {/* Waterfall header */}
            <div className="flex items-center gap-2 pb-2 border-b border-gray-200 dark:border-gray-700 mb-1 text-xs text-gray-500 font-medium">
              <div className="w-[22px]" />
              <div className="min-w-[180px]" title={tt('ui.tip_name')}>{tt('ui.col_name')}</div>
              <div className="flex-1" title={tt('ui.tip_timeline')}>{tt('ui.col_timeline')}</div>
              <div className="w-16 text-right" title={tt('ui.tip_duration_wf')}>{tt('ui.duration')}</div>
              <div className="w-16 text-right" title={tt('ui.tip_model')}>{tt('ui.model')}</div>
              <div className="w-12" />
            </div>

            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {focusRoot && (
                <div className="flex items-center gap-4 mb-2">
                  <button
                    onClick={() => setFocusId(null)}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 font-medium"
                  >
                    <ChevronLeft className="w-3 h-3" />
                    {tt('ui.back_overview')}
                  </button>
                  <button
                    onClick={() => {
                      const payload = {
                        exportedAt: new Date().toISOString(),
                        traceId: focusRoot.traceId,
                        spanCount: focusSet.length,
                        spans: focusSet,
                      };
                      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
                      const a = document.createElement('a');
                      a.href = dataStr;
                      a.download = `trace-${focusRoot.traceId}.json`;
                      a.click();
                    }}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 font-medium"
                    title={tt('ui.export_trace_json')}
                  >
                    <Download className="w-3 h-3" />
                    {tt('ui.export_trace_json')}
                  </button>
                </div>
              )}
              {focusRoot && (
                <TimeRulerZoom
                  totalMs={zoomTotalMs}
                  range={zoomRange}
                  onCommit={setZoomRange}
                  onReset={() => setZoomRange(null)}
                />
              )}
              {wfRows.map((t) => (
                <div key={t.spanId} className="group">
                  <div
                    className="flex items-center cursor-pointer"
                    onClick={() => setSelectedTrace(t)}
                  >
                    <TraceWaterfall
                      trace={t}
                      allTraces={focusRoot ? zoomedFocusSet : traces}
                      treeStart={
                        focusRoot && zoomRange ? focusRoot.startTime + zoomRange.start : undefined
                      }
                      treeDuration={
                        focusRoot && zoomRange ? zoomRange.end - zoomRange.start : undefined
                      }
                      onFocus={() => setFocusId(t.spanId)}
                    />
                    <FeedbackButtons traceId={t.traceId} spanId={t.spanId} />
                  </div>
                </div>
              ))}
            </div>

            {!focusRoot && wfPages > 1 && (
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {safeWfPage * WF_PAGE_SIZE + 1}–{Math.min((safeWfPage + 1) * WF_PAGE_SIZE, filteredRoots.length)}{' '}
                  {tt('ui.of')} {filteredRoots.length}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setWfPage(Math.max(0, safeWfPage - 1))}
                    disabled={safeWfPage === 0}
                    className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label={tt('ui.previous_page')}
                  >
                    <ChevronLeft className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                  </button>
                  <span className="text-xs text-gray-600 dark:text-gray-300 tabular-nums px-2">
                    {safeWfPage + 1} / {wfPages}
                  </span>
                  <button
                    onClick={() => setWfPage(Math.min(wfPages - 1, safeWfPage + 1))}
                    disabled={safeWfPage >= wfPages - 1}
                    className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label={tt('ui.next_page')}
                  >
                    <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Recent Spans Table */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {tt('ui.recent_spans')}
          </h3>
          <span className="text-xs text-gray-500">
            {recentSpans.length} {tt('ui.total')}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-2 px-4 text-xs font-medium text-gray-500 uppercase">{tt('ui.name')}</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-gray-500 uppercase">{tt('ui.status')}</th>
                <th className="text-right py-2 px-4 text-xs font-medium text-gray-500 uppercase">{tt('ui.duration')}</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-gray-500 uppercase">{tt('ui.model')}</th>
                <th className="text-right py-2 px-4 text-xs font-medium text-gray-500 uppercase">{tt('ui.tokens')}</th>
                <th className="text-right py-2 px-4 text-xs font-medium text-gray-500 uppercase">{tt('ui.cost')}</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-gray-500 uppercase">{tt('ui.started')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {tableRows.map((t) => {
                const ageMin = Math.round((Date.now() - t.startTime) / 60000);
                const rel =
                  ageMin < 1
                    ? tt('ui.just_now')
                    : ageMin < 60
                      ? `${ageMin} ${tt('ui.min_ago')}`
                      : ageMin < 1440
                        ? tt('ui.hours_ago').replace('{n}', String(Math.floor(ageMin / 60)))
                        : tt('ui.days_ago').replace('{n}', String(Math.floor(ageMin / 1440)));
                return (
                  <tr
                    key={t.spanId}
                    className="hover:bg-gray-50 dark:hover:bg-gray-800/80 cursor-pointer transition-colors"
                    onClick={() => setSelectedTrace(t)}
                  >
                    <td className="py-2.5 px-4 text-sm font-medium text-gray-900 dark:text-white flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      <span className="truncate max-w-[220px]">{t.name}</span>
                    </td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
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
                    <td className="py-2.5 px-4 text-xs text-right text-gray-600 dark:text-gray-400 font-mono tabular-nums">
                      {t.duration ? `${t.duration}ms` : '-'}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-gray-600 dark:text-gray-400 truncate max-w-[120px]">
                      {t.attributes.model || '-'}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-right text-gray-600 dark:text-gray-400 font-mono tabular-nums">
                      {((Number(t.attributes.inputTokens) || 0) + (Number(t.attributes.outputTokens) || 0)).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-right font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
                      ${parseFloat(t.attributes.cost || '0').toFixed(4)}
                    </td>
                    <td
                      className="py-2.5 px-4 text-xs whitespace-nowrap"
                      title={new Date(t.startTime).toLocaleString()}
                    >
                      <span className={`font-medium ${ageMin < 5 ? 'text-green-600 dark:text-green-400' : 'text-gray-600 dark:text-gray-400'}`}>
                        {rel}
                      </span>
                      <span className="block text-[10px] text-gray-400 font-mono">
                        {new Date(t.startTime).toLocaleTimeString()}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {tablePages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {safeTablePage * TABLE_PAGE_SIZE + 1}–{Math.min((safeTablePage + 1) * TABLE_PAGE_SIZE, recentSpans.length)}{' '}
              {tt('ui.of')} {recentSpans.length}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setTablePage(Math.max(0, safeTablePage - 1))}
                disabled={safeTablePage === 0}
                className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label={tt('ui.previous_page')}
              >
                <ChevronLeft className="w-4 h-4 text-gray-600 dark:text-gray-300" />
              </button>
              <span className="text-xs text-gray-600 dark:text-gray-300 tabular-nums px-2 font-mono">
                {safeTablePage + 1} / {tablePages}
              </span>
              <button
                onClick={() => setTablePage(Math.min(tablePages - 1, safeTablePage + 1))}
                disabled={safeTablePage >= tablePages - 1}
                className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label={tt('ui.next_page')}
              >
                <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-300" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal Detail for selected Trace */}
      {selectedTrace && (
        <TraceModalDetail
          trace={selectedTrace}
          allTraces={traces}
          onClose={() => setSelectedTrace(null)}
          onFocus={(spanId) => setFocusId(spanId)}
        />
      )}
    </div>
  );
}

export default TracingDashboard;
