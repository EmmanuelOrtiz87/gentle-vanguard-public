import { Play, Loader2, CheckCircle, XCircle, Clock, Terminal } from 'lucide-react';

interface AgentTask {
  id: string;
  agent: string;
  task: string;
  status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
  startedAt: string;
  completedAt?: string;
  execution_id?: string;
}

interface TaskControlProps {
  tasks: AgentTask[];
  connected: boolean;
  onEmitEvent?: (event: string, payload: Record<string, unknown>) => void;
}

const statusConfig: Record<string, { icon: typeof Loader2; color: string; bg: string }> = {
  running: {
    icon: Loader2,
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-900/20',
  },
  completed: {
    icon: CheckCircle,
    color: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-50 dark:bg-green-900/20',
  },
  error: {
    icon: XCircle,
    color: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-50 dark:bg-red-900/20',
  },
  cancelled: { icon: XCircle, color: 'text-gray-500', bg: 'bg-gray-50 dark:bg-gray-800' },
  pending: {
    icon: Clock,
    color: 'text-yellow-600 dark:text-yellow-400',
    bg: 'bg-yellow-50 dark:bg-yellow-900/20',
  },
};

export default function TaskControl({ tasks, connected, onEmitEvent }: TaskControlProps) {
  const running = tasks.filter((t) => t.status === 'running');
  const recent = tasks.slice(0, 10);

  return (
    <div className="space-y-3">
      {running.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
              {running.length} active task(s)
            </span>
          </div>
          {running.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 ml-6"
            >
              <span className="font-mono text-xs">{t.agent}</span>
              <span className="text-blue-400">/</span>
              <span>{t.task}</span>
            </div>
          ))}
        </div>
      )}

      {tasks.length === 0 && (
        <div className="text-center py-8 text-gray-400 dark:text-gray-500">
          <Terminal className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No tasks yet</p>
          <p className="text-xs mt-1">Tasks appear when agent activities are dispatched</p>
        </div>
      )}

      {recent.length > 0 && (
        <div className="space-y-1">
          {recent.map((t) => {
            const cfg = statusConfig[t.status] || statusConfig.pending;
            const Icon = cfg.icon;
            return (
              <div
                key={t.id}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${cfg.bg}`}
              >
                <Icon
                  className={`w-4 h-4 ${cfg.color} ${t.status === 'running' ? 'animate-spin' : ''}`}
                />
                <span className="font-mono text-xs text-gray-500 dark:text-gray-400 w-10">
                  {t.agent}
                </span>
                <span className="flex-1 text-gray-700 dark:text-gray-300 truncate">{t.task}</span>
                <span className={`text-[10px] font-medium ${cfg.color}`}>{t.status}</span>
              </div>
            );
          })}
        </div>
      )}

      {connected && onEmitEvent && (
        <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
          <p className="text-[10px] text-gray-400 mb-2">Quick actions</p>
          <div className="flex gap-2">
            <button
              onClick={() =>
                onEmitEvent('agent.dispatched', {
                  agent: 'DEV',
                  task: 'quick task',
                  execution_id: `qt-${Date.now()}`,
                })
              }
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              <Play className="w-3 h-3" /> Dispatch DEV
            </button>
            <button
              onClick={() =>
                onEmitEvent('agent.dispatched', {
                  agent: 'QA',
                  task: 'quick test',
                  execution_id: `qt-${Date.now()}`,
                })
              }
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              <Play className="w-3 h-3" /> Dispatch QA
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
