import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, Package, RefreshCw, Workflow } from 'lucide-react';
import { useT } from '../hooks/useLocale';

type Status = 'DRAFT' | 'VALIDATED' | 'PACKAGED' | 'REVIEW' | 'APPROVED' | 'PUBLISHED' | 'MEASURED' | 'FAILED';
interface Job { id: string; date: string; platform: string; campaign: string; title?: string; status: Status; }
interface ContentOpsData { jobs: Job[]; byStatus: Record<string, number>; byPlatform: Record<string, number>; byDate: Record<string, number>; validation: Array<{ id: string; errors: string[] }>; }
interface PreviewData { job: Job; validation: string[]; packaged: boolean; output: string | null; caption: string | null; publication: Record<string, unknown> | null; }
type ViewMode = 'table' | 'kanban';

const NEXT: Partial<Record<Status, Status>> = {
  DRAFT: 'VALIDATED', VALIDATED: 'PACKAGED', PACKAGED: 'REVIEW', REVIEW: 'APPROVED', APPROVED: 'PUBLISHED', PUBLISHED: 'MEASURED',
};

export function ContentOpsPanel() {
  const { tt } = useT();
  const [data, setData] = useState<ContentOpsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Status | 'ALL'>('ALL');
  const [platformFilter, setPlatformFilter] = useState('ALL');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('table');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/content-operations');
      const payload = await response.json();
      if (!payload.success) throw new Error(payload.error || tt('ui.cops_load_error'));
      setData(payload.data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : tt('ui.cops_load_error'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const operate = async (id: string, action: 'transition' | 'package', to?: Status) => {
    setMessage(null);
    try {
      const response = await fetch('/api/content-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, to }),
      });
      const payload = await response.json();
      if (!payload.success) throw new Error(payload.error || tt('ui.cops_op_failed'));
      setMessage(`${id}: ${action === 'package' ? tt('ui.cops_package_created') : tt('ui.cops_moved_to').replace('{to}', String(to))}`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : tt('ui.cops_op_failed'));
    }
  };

  const loadPreview = async (id: string) => {
    try {
      const response = await fetch(`/api/content-operations/${encodeURIComponent(id)}`);
      const payload = await response.json();
      if (!payload.success) throw new Error(payload.error || tt('ui.cops_preview_unavailable'));
      setPreview(payload.data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : tt('ui.cops_preview_unavailable'));
    }
  };

  const platforms = Array.from(new Set((data?.jobs || []).map((job) => job.platform))).sort();
  const visibleJobs = (data?.jobs || []).filter((job) =>
    (statusFilter === 'ALL' || job.status === statusFilter) &&
    (platformFilter === 'ALL' || job.platform === platformFilter),
  );

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{tt('ui.content_operations')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{tt('ui.cops_subtitle')}</p>
        </div>
        <button onClick={() => void load()} className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700" title={tt('ui.cops_refresh_title')}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {message && <div className="mb-4 text-sm text-blue-700 dark:text-blue-300">{message}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
        {Object.entries(data?.byStatus || {}).map(([status, count]) => (
          <div key={status} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            <p className="text-xs text-gray-500">{status}</p>
            <p className="text-xl font-semibold text-gray-900 dark:text-white">{count}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">{tt('ui.by_platform')}</h2>
          <div className="flex flex-wrap gap-2">{Object.entries(data?.byPlatform || {}).map(([platform, count]) => <span key={platform} className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 rounded">{platform}: {count}</span>)}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">{tt('ui.calendar')}</h2>
          <div className="flex flex-wrap gap-2">{Object.entries(data?.byDate || {}).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => <span key={date} className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 rounded">{date}: {count}</span>)}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select aria-label={tt('ui.cops_filter_status')} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as Status | 'ALL')} className="text-sm border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800">
          <option value="ALL">{tt('ui.all_statuses')}</option>
          {Object.keys(data?.byStatus || {}).map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <select aria-label={tt('ui.cops_filter_platform')} value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value)} className="text-sm border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800">
          <option value="ALL">{tt('ui.all_platforms')}</option>
          {platforms.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
        </select>
        <span className="text-sm text-gray-500">{tt('ui.cops_showing_of').replace('{shown}', String(visibleJobs.length)).replace('{total}', String(data?.jobs.length || 0))}</span>
        <div className="ml-auto inline-flex border border-gray-300 dark:border-gray-600 rounded overflow-hidden" role="group" aria-label={tt('ui.cops_view_aria')}>
          <button onClick={() => setViewMode('table')} className={`px-3 py-2 text-xs ${viewMode === 'table' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>{tt('ui.table')}</button>
          <button onClick={() => setViewMode('kanban')} className={`px-3 py-2 text-xs ${viewMode === 'kanban' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>{tt('ui.kanban')}</button>
        </div>
      </div>

      {viewMode === 'kanban' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          {(['DRAFT', 'VALIDATED', 'PACKAGED', 'REVIEW', 'APPROVED', 'PUBLISHED', 'MEASURED', 'FAILED'] as Status[]).map((status) => {
            const columnJobs = visibleJobs.filter((job) => job.status === status);
            return <section key={status} className="min-h-32 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3" aria-label={`${status} jobs`}>
              <div className="flex items-center justify-between mb-3"><h2 className="text-xs font-semibold tracking-wider text-gray-500">{status}</h2><span className="text-xs text-gray-500">{columnJobs.length}</span></div>
              <div className="space-y-2">
                {columnJobs.map((job) => <button key={job.id} onClick={() => void loadPreview(job.id)} className="w-full text-left rounded border border-gray-200 dark:border-gray-700 p-3 hover:border-blue-400 dark:hover:border-blue-500">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{job.title || job.id}</p>
                  <p className="mt-1 text-xs text-gray-500">{job.platform} · {job.date}</p>
                </button>)}
                {columnJobs.length === 0 && <p className="text-xs text-gray-500 py-3">{tt('ui.no_jobs')}</p>}
              </div>
            </section>;
          })}
        </div>
      )}

      {viewMode === 'table' && <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-500">
            <th className="px-4 py-3">{tt('ui.job')}</th><th className="px-4 py-3">{tt('ui.platform')}</th><th className="px-4 py-3">{tt('ui.date')}</th><th className="px-4 py-3">{tt('ui.status')}</th><th className="px-4 py-3">{tt('ui.actions')}</th>
          </tr></thead>
          <tbody>
            {visibleJobs.map((job) => {
              const errors = data?.validation.find((item) => item.id === job.id)?.errors || [];
              const next = NEXT[job.status];
              return <tr key={job.id} className="border-b border-gray-100 dark:border-gray-700 align-top">
                <td className="px-4 py-3"><p className="font-medium text-gray-900 dark:text-white">{job.title || job.id}</p><p className="text-xs text-gray-500">{job.campaign}</p></td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{job.platform}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{job.date}</td>
                <td className="px-4 py-3"><span className="inline-flex items-center gap-1"><Workflow className="w-3 h-3" />{job.status}</span>{errors.length > 0 && <p className="text-xs text-red-600 mt-1">{tt('ui.cops_validation_issues').replace('{n}', String(errors.length))}</p>}</td>
                <td className="px-4 py-3"><div className="flex flex-wrap gap-2">
                  <button onClick={() => void loadPreview(job.id)} className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100">{tt('ui.preview')}</button>
                  {next && <button onClick={() => void operate(job.id, 'transition', next)} className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">{tt('ui.cops_advance_to').replace('{to}', String(next))}</button>}
                  {job.status === 'VALIDATED' && errors.length === 0 && <button onClick={() => void operate(job.id, 'package')} className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100"><Package className="w-3 h-3" />{tt('ui.package')}</button>}
                  {job.status === 'APPROVED' && <CheckCircle className="w-4 h-4 text-green-600" aria-label={tt('ui.approved')} />}
                </div></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>}
      {preview && (
        <div className="mt-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div><h2 className="font-semibold text-gray-900 dark:text-white">{tt('ui.cops_package_preview').replace('{id}', preview.job.id)}</h2><p className="text-xs text-gray-500">{preview.packaged ? tt('ui.cops_packaged_at').replace('{at}', String(preview.output)) : tt('ui.cops_not_packaged')}</p></div>
            <button onClick={() => setPreview(null)} className="text-sm text-gray-500 hover:text-gray-800">{tt('ui.close')}</button>
          </div>
          {preview.validation.length > 0 && <p className="text-sm text-red-600 mb-3">{preview.validation.join(' · ')}</p>}
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs bg-gray-50 dark:bg-gray-900 rounded p-3 text-gray-700 dark:text-gray-300">{preview.caption || tt('ui.cops_no_caption')}</pre>
        </div>
      )}
    </main>
  );
}

export default ContentOpsPanel;
