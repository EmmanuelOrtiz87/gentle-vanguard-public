import { useCallback, useEffect, useState } from 'react';
import { FileSearch, RefreshCw, ShieldCheck } from 'lucide-react';
import { useT } from '../hooks/useLocale';

interface AuditEntry {
  timestamp?: string;
  event?: string;
  actor?: string;
  action?: string;
  status?: string;
  resource?: string;
  [key: string]: unknown;
}

interface AuditResponse {
  entries: AuditEntry[];
  query: string;
  limit: number;
}

export default function AuditPanel() {
  const { tt } = useT();
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/audit?limit=200&q=${encodeURIComponent(query)}`);
      const payload = await response.json() as { success?: boolean; data?: AuditResponse; error?: string };
      if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error || tt('ui.audit_unavailable'));
      setEntries(payload.data.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : tt('ui.audit_unavailable'));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { void load(); }, [load]);

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-400" /><h1 className="text-2xl font-bold text-gray-900 dark:text-white">{tt('ui.audit_log')}</h1></div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{tt('ui.audit_subtitle')}</p>
        </div>
        <button onClick={() => void load()} className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700" title={tt('ui.audit_refresh')} aria-label={tt('ui.audit_refresh')}><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>

      <div className="card mb-6">
        <label className="block text-xs uppercase tracking-wider text-gray-500 mb-2" htmlFor="audit-search">{tt('ui.search_evidence')}</label>
        <div className="flex gap-3">
          <div className="relative flex-1"><FileSearch className="absolute left-3 top-2.5 w-4 h-4 text-gray-500" /><input id="audit-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tt('ui.audit_search_placeholder')} className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white" /></div>
          <button onClick={() => void load()} className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700">{tt('ui.search')}</button>
        </div>
      </div>

      {error && <div className="card text-red-400 mb-6">{error}</div>}
      {!loading && !error && entries.length === 0 && <div className="card text-center py-14"><ShieldCheck className="w-8 h-8 mx-auto mb-3 text-gray-500" /><h2 className="font-semibold text-gray-900 dark:text-white">{tt('ui.no_audit_entries_match')}</h2><p className="text-sm text-gray-500 mt-1">{tt('ui.audit_empty_hint')}</p></div>}
      {entries.length > 0 && <div className="card overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-500"><th className="px-3 py-3">{tt('ui.time')}</th><th className="px-3 py-3">{tt('ui.event')}</th><th className="px-3 py-3">{tt('ui.actor')}</th><th className="px-3 py-3">{tt('ui.status')}</th><th className="px-3 py-3">{tt('ui.evidence')}</th></tr></thead><tbody>{entries.map((entry, index) => <tr key={`${entry.timestamp || 'entry'}-${index}`} className="border-b border-gray-100 dark:border-gray-700 align-top"><td className="px-3 py-3 whitespace-nowrap text-gray-500">{entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '—'}</td><td className="px-3 py-3 font-medium text-gray-900 dark:text-white">{String(entry.event || entry.action || 'event')}</td><td className="px-3 py-3 text-gray-600 dark:text-gray-300">{String(entry.actor || 'system')}</td><td className="px-3 py-3">{String(entry.status || 'recorded')}</td><td className="px-3 py-3 max-w-xl"><code className="text-xs text-gray-500 break-all">{JSON.stringify(entry)}</code></td></tr>)}</tbody></table></div>}
    </main>
  );
}
