import { useState } from 'react';
import {
  Bot,
  User,
  CheckCircle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertTriangle,
  Info,
  FileDiff,
  FormInput,
} from 'lucide-react';
import type { AgentMessage as AgentMessageType, AgentToolCall, UIHint } from '../types/agent';

function ToolCallBadge({ status }: { status: AgentToolCall['status'] }) {
  switch (status) {
    case 'pending':
      return <Clock className="w-3.5 h-3.5 text-gray-400" />;
    case 'running':
      return <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />;
    case 'completed':
      return <CheckCircle className="w-3.5 h-3.5 text-green-500" />;
    case 'error':
      return <XCircle className="w-3.5 h-3.5 text-red-500" />;
    case 'cancelled':
      return <XCircle className="w-3.5 h-3.5 text-gray-400" />;
  }
}

function ToolCallRow({ call }: { call: AgentToolCall }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <ToolCallBadge status={call.status} />
        <code className="text-xs font-mono text-gray-700 dark:text-gray-300">{call.tool}</code>
        <span className="ml-auto flex items-center gap-1 text-xs text-gray-500">
          {call.status}
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </span>
      </button>
      {expanded && (
        <div className="px-3 py-2 text-xs font-mono bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
          {call.args && (
            <div className="mb-1">
              <span className="text-gray-500">args:</span> {JSON.stringify(call.args, null, 2)}
            </div>
          )}
          {call.result && (
            <div className="mb-1">
              <span className="text-green-600">result:</span> {call.result.slice(0, 200)}
            </div>
          )}
          {call.error && (
            <div>
              <span className="text-red-600">error:</span> {call.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DataTableHint({ hint }: { hint: UIHint }) {
  if (!hint.columns || !hint.rows) return null;
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      {hint.label && (
        <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{hint.label}</span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/50">
              {hint.columns.map((col, i) => (
                <th
                  key={i}
                  className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hint.rows.map((row, i) => (
              <tr
                key={i}
                className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/30"
              >
                {(hint.columns ?? []).map((col, j) => (
                  <td key={j} className="px-3 py-1.5 text-gray-700 dark:text-gray-300">
                    {String(row[col] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChartHint({ hint }: { hint: UIHint }) {
  const series = hint.series;
  if (!series || series.length === 0) return null;
  const maxVal = Math.max(...series.flatMap((s) => s.data));
  const barColors = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-yellow-500', 'bg-red-500'];
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
      {hint.label && (
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">{hint.label}</p>
      )}
      <div className="flex items-end gap-2 h-32">
        {series[0].data.map((val, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-[10px] text-gray-500">{val}</span>
            <div
              className={`w-full rounded-t ${series[0].color ? `bg-[${series[0].color}]` : barColors[i % barColors.length]}`}
              style={{
                height: `${(val / maxVal) * 100}%`,
                minHeight: '4px',
                backgroundColor: series[0].color || undefined,
              }}
            />
          </div>
        ))}
      </div>
      {hint.description && <p className="text-[10px] text-gray-400 mt-2">{hint.description}</p>}
    </div>
  );
}

function DiffHint({ hint }: { hint: UIHint }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      {hint.label && (
        <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <FileDiff className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{hint.label}</span>
        </div>
      )}
      <div className="grid grid-cols-2 divide-x divide-gray-200 dark:divide-gray-700">
        <div className="p-3">
          <p className="text-[10px] font-medium text-gray-500 mb-1">Before</p>
          <pre className="text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap font-mono bg-red-50 dark:bg-red-900/20 p-2 rounded">
            {hint.oldValue}
          </pre>
        </div>
        <div className="p-3">
          <p className="text-[10px] font-medium text-gray-500 mb-1">After</p>
          <pre className="text-xs text-green-600 dark:text-green-400 whitespace-pre-wrap font-mono bg-green-50 dark:bg-green-900/20 p-2 rounded">
            {hint.newValue}
          </pre>
        </div>
      </div>
    </div>
  );
}

function FormHint({
  hint,
  onAction,
}: {
  hint: UIHint;
  onAction?: (action: string, values: Record<string, unknown>) => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const f of hint.fields || []) {
      if (f.type === 'boolean') initial[f.name] = false;
      else if (f.type === 'number') initial[f.name] = 0;
      else initial[f.name] = '';
    }
    return initial;
  });

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
      <div className="flex items-center gap-2 mb-3">
        <FormInput className="w-4 h-4 text-gray-500" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {hint.label || 'Form'}
        </span>
      </div>
      <div className="space-y-2">
        {(hint.fields || []).map((field) => (
          <div key={field.name}>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {field.label}
              {field.required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            {field.type === 'select' ? (
              <select
                value={String(values[field.name] || '')}
                onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
                className="w-full px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              >
                <option value="">Select...</option>
                {(field.options || []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : field.type === 'boolean' ? (
              <input
                type="checkbox"
                checked={Boolean(values[field.name])}
                onChange={(e) => setValues({ ...values, [field.name]: e.target.checked })}
                className="rounded border-gray-300 text-purple-500 focus:ring-purple-500"
              />
            ) : field.type === 'textarea' ? (
              <textarea
                value={String(values[field.name] || '')}
                onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
                placeholder={field.placeholder}
                rows={3}
                className="w-full px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            ) : (
              <input
                type={field.type === 'number' ? 'number' : 'text'}
                value={String(values[field.name] || '')}
                onChange={(e) =>
                  setValues({
                    ...values,
                    [field.name]: field.type === 'number' ? Number(e.target.value) : e.target.value,
                  })
                }
                placeholder={field.placeholder}
                className="w-full px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            )}
          </div>
        ))}
      </div>
      {hint.action && onAction && (
        <button
          onClick={() => hint.action && onAction(hint.action, values)}
          className="mt-3 w-full px-3 py-1.5 bg-purple-500 text-white rounded text-xs font-medium hover:bg-purple-600 transition-colors"
        >
          {hint.action.replace(/_/g, ' ')}
        </button>
      )}
    </div>
  );
}

function MetricHint({ hint }: { hint: UIHint }) {
  const colorMap: Record<string, string> = {
    info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    warning: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
    error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  };
  const iconMap: Record<string, typeof Info> = {
    info: Info,
    warning: AlertTriangle,
    error: XCircle,
  };
  const colorClass = hint.severity
    ? colorMap[hint.severity]
    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
  const Icon = hint.severity ? iconMap[hint.severity] : Info;

  return (
    <div className={`rounded-lg p-3 ${colorClass}`}>
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4" />
        <span className="text-sm font-medium">{hint.label}</span>
      </div>
      <p className="text-2xl font-bold mt-1">{hint.value}</p>
      {hint.description && <p className="text-xs mt-1 opacity-80">{hint.description}</p>}
    </div>
  );
}

function ListHint({ hint, onItemClick }: { hint: UIHint; onItemClick?: (item: string) => void }) {
  const colorMap: Record<string, string> = {
    info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    warning: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
    error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  };
  const iconMap: Record<string, typeof Info> = {
    info: Info,
    warning: AlertTriangle,
    error: XCircle,
  };
  const colorClass = hint.severity
    ? colorMap[hint.severity]
    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
  const Icon = hint.severity ? iconMap[hint.severity] : Info;

  return (
    <div className={`rounded-lg p-3 ${colorClass}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4" />
        <span className="text-sm font-medium">{hint.label || 'List'}</span>
      </div>
      <ul className="space-y-1">
        {hint.items?.map((item, i) =>
          onItemClick ? (
            <li key={i}>
              <button
                onClick={() => onItemClick(item)}
                title={`Execute ${item}`}
                className="w-full text-left text-sm flex items-start gap-2 px-2 py-1 rounded hover:bg-white/60 dark:hover:bg-black/20 transition-colors"
              >
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-current flex-shrink-0" />
                {item}
              </button>
            </li>
          ) : (
            <li key={i} className="text-sm flex items-start gap-2">
              <span className="mt-1 w-1.5 h-1.5 rounded-full bg-current flex-shrink-0" />
              {item}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

function AlertHint({ hint }: { hint: UIHint }) {
  const iconMap: Record<string, typeof Info> = {
    info: Info,
    warning: AlertTriangle,
    error: XCircle,
  };
  const sevColor =
    hint.severity === 'error'
      ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
      : hint.severity === 'warning'
        ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20'
        : 'border-blue-500 bg-blue-50 dark:bg-blue-900/20';
  const Icon = hint.severity ? iconMap[hint.severity] : Info;

  return (
    <div className={`rounded-lg p-3 border-l-4 ${sevColor}`}>
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4" />
        <span className="text-sm font-medium">{hint.label || 'Alert'}</span>
      </div>
      {hint.description && <p className="text-sm mt-1">{hint.description}</p>}
    </div>
  );
}

function UIHintBadge({
  hint,
  onFormAction,
  onItemClick,
}: {
  hint: UIHint;
  onFormAction?: (action: string, values: Record<string, unknown>) => void;
  onItemClick?: (item: string) => void;
}) {
  switch (hint.type) {
    case 'metric':
      return <MetricHint hint={hint} />;
    case 'list':
      return <ListHint hint={hint} onItemClick={onItemClick} />;
    case 'alert':
      return <AlertHint hint={hint} />;
    case 'datatable':
      return <DataTableHint hint={hint} />;
    case 'chart':
      return <ChartHint hint={hint} />;
    case 'diff':
      return <DiffHint hint={hint} />;
    case 'form':
      return <FormHint hint={hint} onAction={onFormAction} />;
    default:
      return (
        <div className="rounded-lg p-3 bg-gray-100 dark:bg-gray-800">
          <p className="text-sm text-gray-500">Unknown hint: {hint.type}</p>
          {hint.description && <p className="text-xs mt-1 text-gray-400">{hint.description}</p>}
        </div>
      );
  }
}

interface AgentMessageProps {
  message: AgentMessageType;
  onFormAction?: (action: string, values: Record<string, unknown>) => void;
  onListItemClick?: (item: string) => void;
}

export function AgentMessage({ message, onFormAction, onListItemClick }: AgentMessageProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  return (
    <div
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''} ${isSystem ? 'opacity-70' : ''}`}
    >
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser
            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
            : isSystem
              ? 'bg-gray-100 dark:bg-gray-800 text-gray-500'
              : 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      <div className={`flex-1 max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div
          className={`rounded-xl px-4 py-2.5 ${
            isUser
              ? 'bg-blue-500 text-white rounded-br-sm'
              : isSystem
                ? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-bl-sm'
                : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 rounded-bl-sm shadow-sm'
          }`}
        >
          {message.streaming && (
            <span className="inline-flex items-center text-sm whitespace-pre-wrap">
              {message.content}
              <span className="streaming-cursor" aria-hidden="true" />
            </span>
          )}
          {!message.streaming && (
            <span className="text-sm whitespace-pre-wrap">{message.content}</span>
          )}
        </div>

        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-1.5 w-full">
            {message.toolCalls.map((tc) => (
              <ToolCallRow key={tc.id} call={tc} />
            ))}
          </div>
        )}

        {message.uiHints && message.uiHints.length > 0 && (
          <div className="mt-2 space-y-2 w-full">
            {message.uiHints.map((hint, i) => (
              <UIHintBadge
                key={i}
                hint={hint}
                onFormAction={onFormAction}
                onItemClick={onListItemClick}
              />
            ))}
          </div>
        )}

        <span className="text-[10px] text-gray-400 mt-1 px-1">
          {new Date(message.timestamp).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}
