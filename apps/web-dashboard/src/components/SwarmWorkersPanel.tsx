import { useState } from 'react';
import {
  Cpu,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Terminal,
  FileText,
} from 'lucide-react';
import type { SwarmWorkerEntry, SwarmWorkerData } from '../types/dashboard';
import { useT } from '../hooks/useLocale';

interface SwarmWorkersPanelProps {
  data?: SwarmWorkerData;
}

function formatDuration(started: string, finished?: string): string {
  const start = new Date(started).getTime();
  const end = finished ? new Date(finished).getTime() : Date.now();
  const durationMs = end - start;

  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60000) return `${Math.floor(durationMs / 1000)}s`;
  if (durationMs < 3600000)
    return `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`;
  return `${Math.floor(durationMs / 3600000)}h ${Math.floor((durationMs % 3600000) / 60000)}m`;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function getStatusIcon(status: SwarmWorkerEntry['status']) {
  switch (status) {
    case 'running':
      return <Cpu className="w-4 h-4 text-blue-500 animate-pulse" />;
    case 'completed':
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-500" />;
    case 'timeout':
      return <Clock className="w-4 h-4 text-amber-500" />;
    default:
      return <AlertTriangle className="w-4 h-4 text-gray-400" />;
  }
}

function getStatusColor(status: SwarmWorkerEntry['status']): string {
  switch (status) {
    case 'running':
      return 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
    case 'completed':
      return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
    case 'failed':
      return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
    case 'timeout':
      return 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800';
    default:
      return 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700';
  }
}

function getStatusBadgeColor(status: SwarmWorkerEntry['status']): string {
  switch (status) {
    case 'running':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
    case 'completed':
      return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
    case 'failed':
      return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
    case 'timeout':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
    default:
      return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
  }
}

function WorkerCard({ worker }: { worker: SwarmWorkerEntry }) {
  const [expanded, setExpanded] = useState(false);
  const { tt } = useT();
  const duration = formatDuration(worker.started, worker.finished);
  const statusLabel = tt(`ui.${worker.status}`);

  return (
    <div className={`rounded-lg border p-3 transition-all ${getStatusColor(worker.status)}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {getStatusIcon(worker.status)}
          <span className="font-medium text-sm text-gray-900 dark:text-white truncate">
            {worker.skill}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${getStatusBadgeColor(worker.status)}`}
          >
            {statusLabel.startsWith('ui.') ? worker.status : statusLabel}
          </span>
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            title={expanded ? tt('ui.collapse') : tt('ui.expand')}
          >
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-gray-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-500" />
            )}
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatTimestamp(worker.started)}
        </span>
        <span className="flex items-center gap-1">
          <Terminal className="w-3 h-3" />
          {duration}
        </span>
        {worker.exitCode !== null && (
          <span
            className={`font-mono ${worker.exitCode === 0 ? 'text-green-600' : 'text-red-600'}`}
          >
            exit: {worker.exitCode}
          </span>
        )}
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 space-y-2">
          {worker.output && (
            <div>
              <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                <FileText className="w-3 h-3" />
                <span>{tt('ui.output')}</span>
              </div>
              <pre className="text-xs bg-gray-900 text-gray-100 p-2 rounded max-h-32 overflow-auto font-mono">
                {worker.output}
              </pre>
            </div>
          )}
          {worker.error && (
            <div>
              <div className="flex items-center gap-1 text-xs text-red-500 mb-1">
                <AlertTriangle className="w-3 h-3" />
                <span>{tt('ui.error_word')}</span>
              </div>
              <pre className="text-xs bg-red-900/20 text-red-100 p-2 rounded max-h-32 overflow-auto font-mono border border-red-800">
                {worker.error}
              </pre>
            </div>
          )}
          <div className="text-xs text-gray-400">
            {tt('ui.worker_dir')} <code className="text-gray-500">{worker.workerDir}</code>
          </div>
        </div>
      )}
    </div>
  );
}

export function SwarmWorkersPanel({ data }: SwarmWorkersPanelProps) {
  const { tt } = useT();

  if (!data || data.workers.length === 0) {
    return (
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Cpu className="w-5 h-5 text-purple-500" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{tt('ui.swarm_workers')}</h2>
        </div>
        <div className="text-center py-8 text-gray-400 dark:text-gray-500">
          <Cpu className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">{tt('ui.no_active_workers')}</p>
          <p className="text-xs mt-1">{tt('ui.workers_hint')}</p>
        </div>
      </div>
    );
  }

  const { activeCount, completedCount, failedCount, workers, reports } = data;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-purple-500" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{tt('ui.swarm_workers')}</h2>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            {activeCount} {tt('ui.active_plural')}
          </span>
          <span className="px-2 py-1 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
            {completedCount} {tt('ui.done_badge')}
          </span>
          {failedCount > 0 && (
            <span className="px-2 py-1 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
              {failedCount} {tt('ui.failed_plural')}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2 text-center">
          <p className="text-xs text-gray-500 dark:text-gray-400">{tt('ui.total_workers')}</p>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{workers.length}</p>
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2 text-center">
          <p className="text-xs text-blue-600 dark:text-blue-400">{tt('ui.active')}</p>
          <p className="text-lg font-bold text-blue-700 dark:text-blue-300">{activeCount}</p>
        </div>
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-2 text-center">
          <p className="text-xs text-green-600 dark:text-green-400">{tt('ui.completed')}</p>
          <p className="text-lg font-bold text-green-700 dark:text-green-300">{completedCount}</p>
        </div>
        <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-2 text-center">
          <p className="text-xs text-purple-600 dark:text-purple-400">{tt('ui.reports')}</p>
          <p className="text-lg font-bold text-purple-700 dark:text-purple-300">{reports}</p>
        </div>
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {workers.map((worker, index) => (
          <WorkerCard key={`${worker.skill}-${index}`} worker={worker} />
        ))}
      </div>
    </div>
  );
}
