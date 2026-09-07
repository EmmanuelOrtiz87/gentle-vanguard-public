import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Search,
  BookOpen,
  Activity,
  MessageSquare,
  Camera,
  Braces,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from 'lucide-react';
import { useT } from '../hooks/useLocale';

interface KnowledgeResult {
  source: string;
  id: string;
  title: string;
  content: string;
  timestamp: string;
  relevance: number;
}

const SOURCE_CONFIG: Record<string, { icon: typeof BookOpen; label: string; color: string }> = {
  events: {
    icon: Activity,
    label: 'Events',
    color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  },
  traces: {
    icon: Activity,
    label: 'Traces',
    color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  },
  feedback: {
    icon: MessageSquare,
    label: 'Feedback',
    color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  },
  checkpoints: {
    icon: Camera,
    label: 'Checkpoints',
    color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  },
  engram: {
    icon: Braces,
    label: 'Engram',
    color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  },
};

const SOURCE_LABEL_KEYS: Record<string, string> = {
  events: 'ui.kp_source_events',
  traces: 'ui.kp_source_traces',
  feedback: 'ui.kp_source_feedback',
  checkpoints: 'ui.kp_source_checkpoints',
  engram: 'ui.kp_source_engram',
};

function KnowledgePanelInner() {
  const { tt } = useT();
  const [query, setQuery] = useState('');
  const [sources, setSources] = useState(['events', 'traces', 'feedback', 'checkpoints', 'engram']);
  const [results, setResults] = useState<KnowledgeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [pollError, setPollError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const toggleSource = (src: string) => {
    setSources((prev) => {
      const next = prev.includes(src) ? prev.filter((s) => s !== src) : [...prev, src];
      return next;
    });
  };

  const search = useCallback(
    async (q?: string, srcs?: string[]) => {
      const searchQuery = q ?? query;
      const searchSources = srcs ?? sources;
      if (!searchQuery.trim()) return;
      setLoading(true);
      setSearched(true);
      try {
        const res = await fetch(
          `/api/knowledge?q=${encodeURIComponent(searchQuery)}&sources=${searchSources.join(',')}&limit=20`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const msg = await res.json();
        setResults(msg.data?.results || []);
        setPollError(false);
      } catch {
        setResults([]);
        setPollError(true);
      }
      setLoading(false);
    },
    [query, sources],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) void search();
    else if (e.key === 'Enter') void search();
  };

  useEffect(() => {
    if (searched) void search();
  }, [sources.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const relevanceColor = (score: number) => {
    if (score >= 0.8) return 'bg-green-500';
    if (score >= 0.5) return 'bg-yellow-500';
    return 'bg-gray-300 dark:bg-gray-600';
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {tt('ui.knowledge_base')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {tt('ui.kp_unified_search')}
          </p>
        </div>
        {searched && (
          <button
            onClick={() => void search()}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> {tt('ui.refresh')}
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Search className="w-5 h-5 text-gray-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={tt('ui.kp_search_placeholder')}
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => void search()}
            disabled={loading || !query.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? tt('ui.kp_searching') : tt('ui.kp_search')}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(SOURCE_CONFIG).map(([key, cfg]) => {
            const Icon = cfg.icon;
            const active = sources.includes(key);
            return (
              <button
                key={key}
                onClick={() => toggleSource(key)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border ${
                  active
                    ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800'
                    : 'bg-gray-50 text-gray-500 border-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:border-gray-600'
                }`}
              >
                <Icon className="w-3 h-3" />
                {tt(SOURCE_LABEL_KEYS[key] ?? cfg.label)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        {loading ? (
          <div className="p-8 text-center text-gray-500">
            <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" />
            {tt('ui.kp_searching')}
          </div>
        ) : pollError ? (
          <div className="p-8 text-center">
            <div className="text-red-500 mb-2">{tt('ui.failed_reach_knowledge_api')}</div>
            <button onClick={() => void search()} className="text-sm text-blue-600 hover:underline">
              {tt('ui.kp_retry')}
            </button>
          </div>
        ) : !searched ? (
          <div className="p-8 text-center text-gray-500">
            <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>{tt('ui.enter_query_knowledge')}</p>
            <p className="text-xs mt-1">{tt('ui.toggle_sources_filter')}</p>
          </div>
        ) : results.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>{tt('ui.kp_no_results_for').replace('{query}', query)}</p>
            <p className="text-xs mt-1">{tt('ui.try_different_sources')}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {results.map((r, i) => {
              const key = `${r.source}-${r.id}-${i}`;
              const isExpanded = expanded === key;
              const cfg = SOURCE_CONFIG[r.source];
              const colorClass = cfg?.color || 'bg-gray-100 text-gray-700';
              return (
                <div key={key} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${colorClass}`}
                      >
                        {r.source.toUpperCase()}
                      </span>
                      <span className="font-medium text-gray-900 dark:text-white text-sm">
                        {r.title}
                      </span>
                      <span className="text-xs text-gray-400">{r.timestamp}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        <span className={`w-2 h-2 rounded-full ${relevanceColor(r.relevance)}`} />
                        {Math.round(r.relevance * 100)}%
                      </span>
                      <button
                        onClick={() => setExpanded(isExpanded ? null : key)}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                    {r.content}
                  </p>
                  {isExpanded && (
                    <pre className="mt-2 p-2 bg-gray-50 dark:bg-gray-900 rounded text-xs text-gray-600 dark:text-gray-400 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
                      {JSON.stringify(r, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default KnowledgePanelInner;
