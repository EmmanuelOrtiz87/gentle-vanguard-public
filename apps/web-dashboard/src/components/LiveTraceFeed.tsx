import { useState, useMemo, useRef, useEffect } from 'react';
import { Activity, Search, ArrowDown } from 'lucide-react';
import { useLiveTraces } from '../hooks/useLiveTraces';

type FilterType = 'all' | 'active' | 'completed';
const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500',
  running: 'bg-green-500',
  completed: 'bg-blue-500',
  error: 'bg-red-500',
  idle: 'bg-gray-400',
};

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 2000) return 'now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

function getStatus(trace: { model?: string; turnCount?: number }): string {
  if (!trace.model) return 'idle';
  return 'active';
}

export function LiveTraceFeed() {
  const traces = useLiveTraces();
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    let items = traces;
    if (filter === 'active') {
      items = items.filter((t) => t.model && t.turnCount > 0);
    }
    if (filter === 'completed') {
      items = items.filter((t) => !t.model || t.turnCount === 0);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (t) => t.id.toLowerCase().includes(q) || t.model.toLowerCase().includes(q),
      );
    }
    return items;
  }, [traces, filter, search]);

  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [filtered.length, autoScroll]);

  const filterCounts = useMemo(
    () => ({
      all: traces.length,
      active: traces.filter((t) => t.model && t.turnCount > 0).length,
      completed: traces.filter((t) => !t.model || t.turnCount === 0).length,
    }),
    [traces],
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Activity className="w-4 h-4 text-blue-500" />
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Live Traces</h3>
        {traces.length > 0 && (
          <span className="ml-auto text-xs text-gray-400">{traces.length} active</span>
        )}
      </div>

      {/* Search bar */}
      <div className="relative mb-3">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
        <input
          type="text"
          placeholder="Search by ID or model..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Filter buttons */}
      <div className="flex items-center gap-1 mb-3">
        {(['all', 'active', 'completed'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2 py-1 text-xs rounded-md font-medium transition-colors ${
              filter === f
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            <span className="ml-1 opacity-60">({filterCounts[f]})</span>
          </button>
        ))}
        <button
          onClick={() => setAutoScroll(!autoScroll)}
          className={`ml-auto p-1 rounded ${autoScroll ? 'text-blue-500' : 'text-gray-400'}`}
          title={autoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}
        >
          <ArrowDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Trace list */}
      {filtered.length === 0 ? (
        <p className="text-xs text-gray-400 py-4 text-center">
          {search ? 'No traces match your search' : 'No activity yet'}
        </p>
      ) : (
        <div ref={listRef} className="space-y-1.5 max-h-64 overflow-y-auto">
          {filtered.map((t) => {
            const status = getStatus(t);
            return (
              <div
                key={t.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded bg-blue-50 dark:bg-blue-900/10 text-xs hover:bg-blue-100 dark:hover:bg-blue-900/20 transition-colors"
              >
                <span
                  className={`w-2 h-2 rounded-full ${STATUS_COLORS[status] || 'bg-gray-400'} ${status === 'active' ? 'animate-pulse' : ''}`}
                />
                <span
                  className="font-mono text-gray-600 dark:text-gray-400 truncate min-w-0 flex-1"
                  title={t.id}
                >
                  {t.id.length > 20 ? `${t.id.slice(0, 20)}...` : t.id}
                </span>
                <span className="text-gray-500 whitespace-nowrap">{t.turnCount} turns</span>
                <span className="text-gray-400 ml-auto hidden sm:inline">{t.model}</span>
                <span
                  className="text-gray-400 whitespace-nowrap"
                  title={new Date(t.timestamp).toLocaleString()}
                >
                  {timeAgo(t.timestamp)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
