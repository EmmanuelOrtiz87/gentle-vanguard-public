import { BarChart3, ExternalLink, FileText } from 'lucide-react';
import { useAnalyticsReports, type AnalyticsReportSummary } from '../hooks/useAnalyticsReports';
import { useT } from '../hooks/useLocale';

const MODE_LABEL: Record<string, string> = {
  url: 'URL',
  request: 'Request',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function truncate(text: string, max = 90): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * Dashboard widget that surfaces the latest gv-analytics reports without
 * opening the analytics app. Reads through the Vite proxy (/gv-analytics).
 * Renders nothing when the analytics API is unreachable.
 */
export function AnalyticsWidget() {
  const { tt } = useT();
  const { reports, available } = useAnalyticsReports(5);

  if (!available) return null;

  return (
    <section className="mb-8" aria-label={tt('ui.analytics_widget_title')}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {tt('ui.analytics_widget_title')}
          </h2>
        </div>
        <a
          href="http://127.0.0.1:4754"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
        >
          {tt('ui.analytics_widget_open')}
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {reports.length === 0 ? (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 text-sm text-gray-500 dark:text-gray-400">
          {tt('ui.analytics_widget_empty')}
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {reports.map((report: AnalyticsReportSummary) => (
              <li
                key={report.id}
                className="bg-white dark:bg-gray-900 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {report.summary || truncate(report.input)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                      {truncate(report.input)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                      <FileText className="w-3 h-3" />
                      {MODE_LABEL[report.mode] ?? report.mode}
                    </span>
                    <span className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">
                      {formatDate(report.createdAt)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
