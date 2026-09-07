import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, ChevronDown, ChevronRight, Copy, Search } from 'lucide-react';
import { useT } from '../hooks/useLocale';

/**
 * HistoryPanel — Histórico de sesiones con filtros y drill-down (ADR-0031 follow-up).
 * No siempre acumulado: cada sesión de cada herramienta es explorable individualmente.
 * Fuente: /api/history/sessions (token_usage + transactions + traces + savings en Nexus).
 */

interface SessionRow {
  sessionId: string;
  source: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  firstAt: string | null;
  lastAt: string | null;
  models: string[];
  hasTraces: boolean;
}

interface HistoryData {
  sessions: SessionRow[];
  totals: {
    sessions: number;
    requests: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    cachedTokensSaved: number;
  };
  bySource: { source: string; sessions: number; tokens: number }[];
}

interface SessionDetail {
  session: SessionRow;
  transactions: {
    message_id: string;
    agent: string | null;
    model: string | null;
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    cost: number;
    created_at: string;
  }[];
  transactionsTotal: number;
  traces: {
    trace_id: string;
    span_id: string;
    name: string;
    start_time: number;
    duration: number;
    status: string;
    model: string | null;
    input_tokens: number;
    output_tokens: number;
  }[];
  savings: { category: string; saved: number; hits: number }[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; model: string | null; timestamp: string }[];
}

const RANGES = [
  { key: '7d', days: 7 },
  { key: '30d', days: 30 },
  { key: '90d', days: 90 },
  { key: 'all', days: 0 },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

const SOURCE_COLORS: Record<string, string> = {
  zcode: '#22D3EE',
  minimax: '#A78BFA',
  opencode: '#4ADE80',
  codex: '#F4BB4F',
  stack: '#67E8F9',
  otro: '#8B95A8',
};

const fmtTokens = (v: number) => {
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
};

const fmtWhen = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return s;
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return d.toLocaleDateString();
};

function rangeDates(range: RangeKey): { from: string | null; to: string | null } {
  const cfg = RANGES.find((r) => r.key === range)!;
  if (!cfg.days) return { from: null, to: null };
  const to = new Date();
  const from = new Date(to.getTime() - cfg.days * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

export function HistoryPanel() {
  const { tt } = useT();
  const [range, setRange] = useState<RangeKey>('30d');
  const [source, setSource] = useState('all');
  const [model, setModel] = useState('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'recent' | 'tokens' | 'requests'>('recent');
  const [page, setPage] = useState(0);
  const [limit] = useState(25);
  const [data, setData] = useState<HistoryData | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);

  const t = useCallback(
    (key: string, fallback: string) => tt(key) ?? fallback,
    [tt],
  );

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const params = new URLSearchParams();
      const { from, to } = rangeDates(range);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (source !== 'all') params.set('source', source);
      if (model !== 'all') params.set('model', model);
      if (q.trim()) params.set('q', q.trim());
      params.set('sort', sort);
      params.set('limit', String(limit));
      params.set('offset', String(page * limit));
      const res = await fetch(`/api/history/sessions?${params}`, { signal: ac.signal });
      if (!res.ok) {
        setError(true);
        return;
      }
      const payload = await res.json();
      setData(payload.data ?? null);
      setError(false);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(true);
    }
  }, [range, source, model, q, sort, page, limit]);

  useEffect(() => {
    const handle = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(handle);
  }, [load, q]);

  const openDetail = useCallback(async (sessionId: string) => {
    if (expanded === sessionId) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(sessionId);
    setDetail(null);
    setDetailLoading(true);
    detailAbortRef.current?.abort();
    const ac = new AbortController();
    detailAbortRef.current = ac;
    try {
      const res = await fetch(`/api/history/sessions/${encodeURIComponent(sessionId)}`, {
        signal: ac.signal,
      });
      if (res.ok) {
        const payload = await res.json();
        setDetail(payload.data ?? null);
      }
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
    } finally {
      setDetailLoading(false);
    }
  }, [expanded]);

  const copyId = useCallback(async (sessionId: string) => {
    try {
      await navigator.clipboard.writeText(sessionId);
    } catch {
      /* clipboard bloqueado en algunos contextos: igual muestro feedback */
    }
    setCopied(sessionId);
    setTimeout(() => setCopied((cur) => (cur === sessionId ? null : cur)), 1600);
  }, []);

  const models = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    data.sessions.forEach((s) => s.models.forEach((m) => set.add(m)));
    return [...set].sort();
  }, [data]);

  const maxTokens = useMemo(
    () => Math.max(1, ...(data?.sessions ?? []).map((s) => s.totalTokens)),
    [data],
  );

  const totals = data?.totals;
  const totalRows = totals?.sessions ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalRows / limit));
  const tokenShare =
    totals && totals.totalTokens > 0
      ? {
          prompt: (totals.promptTokens / totals.totalTokens) * 100,
          completion: (totals.completionTokens / totals.totalTokens) * 100,
        }
      : null;

  return (
    <section className="mb-8" aria-label={t('ui.history_title', 'Histórico de sesiones')} data-testid="history-panel">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <CalendarClock className="w-5 h-5" style={{ color: '#22D3EE' }} />
            {t('ui.history_title', 'Histórico de sesiones')}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t(
              'ui.history_subtitle',
              'Cada sesión de cada herramienta, individual y filtrable — no solo acumulados. Fuente: heurística por prefijo del session_id.',
            )}
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="card p-3 mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => {
                setRange(r.key);
                setPage(0);
              }}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                range === r.key
                  ? 'text-black'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
              style={range === r.key ? { background: '#22D3EE' } : undefined}
            >
              {r.key === 'all' ? t('ui.history_range_all', 'Todo') : r.key}
            </button>
          ))}
        </div>
        <select
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setPage(0);
          }}
          className="text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5"
          aria-label={t('ui.history_source', 'Fuente')}
        >
          <option value="all">{t('ui.history_source_all', 'Todas las fuentes')}</option>
          <option value="zcode">ZCode</option>
          <option value="minimax">MiniMax</option>
          <option value="opencode">OpenCode</option>
          <option value="codex">Codex</option>
          <option value="stack">Stack</option>
          <option value="otro">{t('ui.history_source_other', 'Otro')}</option>
        </select>
        <select
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            setPage(0);
          }}
          className="text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 max-w-[200px]"
          aria-label={t('ui.history_model', 'Modelo')}
        >
          <option value="all">{t('ui.history_model_all', 'Todos los modelos')}</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as typeof sort);
            setPage(0);
          }}
          className="text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5"
          aria-label={t('ui.history_sort', 'Orden')}
        >
          <option value="recent">{t('ui.history_sort_recent', 'Más recientes')}</option>
          <option value="tokens">{t('ui.history_sort_tokens', 'Más tokens')}</option>
          <option value="requests">{t('ui.history_sort_requests', 'Más requests')}</option>
        </select>
        <div className="flex items-center gap-1.5 flex-1 min-w-[180px] max-w-[280px] rounded-lg border border-gray-200 dark:border-gray-700 px-2 py-1">
          <Search className="w-3.5 h-3.5 text-gray-400" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            placeholder={t('ui.history_search', 'Buscar session_id…')}
            className="text-xs bg-transparent outline-none w-full text-gray-800 dark:text-gray-200"
          />
        </div>
      </div>

      {error && (
        <div className="card p-4 text-sm text-red-500 mb-4">
          {t('ui.history_error', 'Nexus no disponible — reintentando al cambiar filtros.')}
        </div>
      )}

      {/* Resumen del conjunto filtrado */}
      {totals && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="card p-4">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              {t('ui.history_sessions', 'Sesiones')}
            </div>
            <div className="text-2xl font-semibold tabular-nums" style={{ color: '#22D3EE' }}>
              {totals.sessions.toLocaleString()}
            </div>
            <div className="text-[10px] text-gray-400 mt-1">
              {totals.requests.toLocaleString()} {t('ui.history_requests', 'requests')}
            </div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              {t('ui.history_tokens_total', 'Tokens totales')}
            </div>
            <div className="text-2xl font-semibold tabular-nums" style={{ color: '#A78BFA' }}>
              {fmtTokens(totals.totalTokens)}
            </div>
            {tokenShare && (
              <div className="mt-1.5 h-1.5 rounded-full overflow-hidden flex" aria-hidden="true">
                <div style={{ width: `${tokenShare.prompt}%`, background: '#A78BFA' }} />
                <div style={{ width: `${tokenShare.completion}%`, background: '#22D3EE' }} />
              </div>
            )}
          </div>
          <div className="card p-4">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              {t('ui.history_avg_per_session', 'Promedio por sesión')}
            </div>
            <div className="text-2xl font-semibold tabular-nums text-gray-900 dark:text-white">
              {totals.sessions > 0 ? fmtTokens(Math.round(totals.totalTokens / totals.sessions)) : '0'}
            </div>
            <div className="text-[10px] text-gray-400 mt-1">
              {t('ui.history_in_out', 'in + out combinados')}
            </div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              {t('ui.history_cache_saved', 'Tokens ahorrados (cache)')}
            </div>
            <div className="text-2xl font-semibold tabular-nums" style={{ color: '#4ADE80' }}>
              {fmtTokens(totals.cachedTokensSaved)}
            </div>
            <div className="text-[10px] text-gray-400 mt-1">{t('ui.history_cache_note', 'response cache del stack')}</div>
          </div>
        </div>
      )}

      {/* Distribución por fuente */}
      {data && data.bySource.length > 0 && (
        <div className="card p-3 mb-4">
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {data.bySource.map((s) => (
              <span key={s.source} className="inline-flex items-center gap-1.5 text-xs">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: SOURCE_COLORS[s.source] ?? SOURCE_COLORS.otro }}
                />
                <span className="font-medium text-gray-700 dark:text-gray-300">{s.source}</span>
                <span className="text-gray-400">
                  {s.sessions} · {fmtTokens(s.tokens)}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Tabla de sesiones */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="history-table">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="px-3 py-2 font-medium"></th>
                <th className="px-3 py-2 font-medium">{t('ui.history_col_session', 'Sesión')}</th>
                <th className="px-3 py-2 font-medium">{t('ui.history_col_source', 'Fuente')}</th>
                <th className="px-3 py-2 font-medium text-right">{t('ui.history_col_tokens', 'Tokens')}</th>
                <th className="px-3 py-2 font-medium text-right">{t('ui.history_col_requests', 'Req')}</th>
                <th className="px-3 py-2 font-medium text-right">{t('ui.history_col_model', 'Modelo')}</th>
                <th className="px-3 py-2 font-medium text-right">{t('ui.history_col_activity', 'Actividad')}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.sessions ?? []).map((s) => (
                <HistoryRow
                  key={s.sessionId}
                  row={s}
                  maxTokens={maxTokens}
                  expanded={expanded === s.sessionId}
                  detail={expanded === s.sessionId ? detail : null}
                  detailLoading={expanded === s.sessionId && detailLoading}
                  copied={copied === s.sessionId}
                  onToggle={() => openDetail(s.sessionId)}
                  onCopy={() => copyId(s.sessionId)}
                  t={t}
                />
              ))}
              {data && data.sessions.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-gray-400 text-sm">
                    {t('ui.history_empty', 'Sin sesiones para los filtros actuales.')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {totals && totalRows > limit && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500">
            <span>
              {page * limit + 1}–{Math.min((page + 1) * limit, totalRows)} {t('ui.history_of', 'de')} {totalRows}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-40"
              >
                ←
              </button>
              <button
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
                className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-40"
              >
                →
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function HistoryRow(props: {
  row: SessionRow;
  maxTokens: number;
  expanded: boolean;
  detail: SessionDetail | null;
  detailLoading: boolean;
  copied: boolean;
  onToggle: () => void;
  onCopy: () => void;
  t: (key: string, fallback: string) => string;
}) {
  const { row, maxTokens, expanded, detail, detailLoading, copied, onToggle, onCopy, t } = props;
  const color = SOURCE_COLORS[row.source] ?? SOURCE_COLORS.otro;
  const pct = Math.max(2, Math.round((row.totalTokens / maxTokens) * 100));
  const modelsLabel = row.models.length > 1 ? `${row.models[0]} +${row.models.length - 1}` : row.models[0] ?? '—';

  return (
    <>
      <tr
        className="border-b border-gray-100 dark:border-gray-800 hover:bg-cyan-500/5 cursor-pointer transition-colors"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <td className="px-2 py-2 text-gray-400">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </td>
        <td className="px-3 py-2 max-w-[280px]">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCopy();
            }}
            title={row.sessionId}
            className="inline-flex items-center gap-1.5 font-mono text-xs text-gray-700 dark:text-gray-300 hover:text-cyan-500 transition-colors max-w-full"
          >
            <span className="truncate">{row.sessionId}</span>
            {copied ? (
              <span className="text-[10px] text-emerald-500">✓</span>
            ) : (
              <Copy className="w-3 h-3 opacity-40" />
            )}
          </button>
          {row.hasTraces && (
            <span
              className="ml-2 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(34,211,238,0.12)', color: '#22D3EE' }}
            >
              traces
            </span>
          )}
        </td>
        <td className="px-3 py-2">
          <span
            className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
            style={{ background: `${color}1f`, color }}
          >
            {row.source}
          </span>
        </td>
        <td className="px-3 py-2 text-right">
          <div className="font-semibold tabular-nums text-gray-900 dark:text-white">
            {fmtTokens(row.totalTokens)}
          </div>
          <div className="h-1 rounded-full bg-gray-200 dark:bg-gray-700 mt-1 overflow-hidden" aria-hidden="true">
            <div
              className="h-full rounded-full"
              style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#A78BFA,#22D3EE)' }}
            />
          </div>
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">
          {row.requests}
        </td>
        <td className="px-3 py-2 text-right text-xs text-gray-500 dark:text-gray-400 max-w-[180px] truncate" title={row.models.join(', ')}>
          {modelsLabel}
        </td>
        <td className="px-3 py-2 text-right text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {fmtWhen(row.lastAt)}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-gray-100 dark:border-gray-800">
          <td colSpan={7} className="px-6 py-4 bg-black/10 dark:bg-white/[0.02]">
            {detailLoading && <div className="text-xs text-gray-400">{t('ui.history_loading', 'Cargando detalle…')}</div>}
            {detail && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                    {t('ui.history_models_breakdown', 'Modelos')}
                  </h4>
                  {detail.session.models.map((m) => (
                    <div key={m} className="text-xs font-mono text-gray-600 dark:text-gray-300 mb-1">
                      {m}
                    </div>
                  ))}
                  <div className="mt-3 text-xs text-gray-500">
                    <div>
                      {t('ui.history_in', 'Input')}: {fmtTokens(detail.session.promptTokens)}
                    </div>
                    <div>
                      {t('ui.history_out', 'Output')}: {fmtTokens(detail.session.completionTokens)}
                    </div>
                    {detail.session.firstAt && (
                      <div className="mt-1 opacity-70">
                        {detail.session.firstAt} → {detail.session.lastAt}
                      </div>
                    )}
                  </div>
                  {detail.savings.length > 0 && (
                    <div className="mt-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                        {t('ui.history_savings', 'Ahorro (cache)')}
                      </h4>
                      {detail.savings.map((s) => (
                        <div key={s.category} className="text-xs text-emerald-500">
                          {s.category}: {fmtTokens(s.saved)} ({s.hits})
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="lg:col-span-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                    {t('ui.history_transactions', 'Mensajes')}{' '}
                    <span className="opacity-60">
                      ({Math.min(detail.transactions.length, 100)} {t('ui.history_of_total', 'de')}{' '}
                      {detail.transactionsTotal})
                    </span>
                  </h4>
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <tbody>
                        {detail.transactions.slice(0, 100).map((tx) => (
                          <tr key={tx.message_id} className="border-b border-gray-100 dark:border-gray-800/60">
                            <td className="py-1.5 pr-2 whitespace-nowrap text-gray-400">{tx.created_at}</td>
                            <td className="py-1.5 pr-2 text-gray-600 dark:text-gray-300">{tx.agent ?? '—'}</td>
                            <td className="py-1.5 pr-2 font-mono text-gray-500 max-w-[140px] truncate">{tx.model ?? '—'}</td>
                            <td className="py-1.5 pr-2 text-right tabular-nums text-gray-600 dark:text-gray-300">
                              {fmtTokens((tx.input_tokens ?? 0) + (tx.output_tokens ?? 0))}
                            </td>
                            {(tx.cache_read_tokens ?? 0) > 0 && (
                              <td className="py-1.5 text-right tabular-nums text-cyan-500">
                                cache {fmtTokens(tx.cache_read_tokens ?? 0)}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {detail.traces.length > 0 && (
                    <div className="mt-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                        {t('ui.history_traces', 'Trazas')}{' '}
                        <span className="opacity-60">({detail.traces.length})</span>
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        {detail.traces.slice(0, 12).map((tr) => (
                          <span
                            key={tr.span_id}
                            className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
                          >
                            {tr.name} · {(tr.duration / 1000).toFixed(1)}s · {tr.status}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default HistoryPanel;
