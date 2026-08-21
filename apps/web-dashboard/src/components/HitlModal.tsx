import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, XCircle, HelpCircle, Clock } from 'lucide-react';
import type { HitlRequest, HitlResponse, UIFormField } from '../types/agent';

interface HitlModalProps {
  request: HitlRequest | null;
  onResolve: (response: HitlResponse) => void;
  onDismiss: () => void;
}

function isFieldFilled(field: UIFormField, value: unknown): boolean {
  if (field.type === 'boolean') return true;
  if (field.type === 'number') return typeof value === 'number' && !Number.isNaN(value);
  return typeof value === 'string' && value.trim().length > 0;
}

function ConfirmationView({
  request,
  onResolve,
}: {
  request: HitlRequest;
  onResolve: (approved: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
        <HelpCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {request.message || 'Confirm this action?'}
        </p>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => onResolve(false)}
          className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <XCircle className="w-4 h-4 inline mr-1" />
          Reject
        </button>
        <button
          onClick={() => onResolve(true)}
          className="px-4 py-2 text-sm rounded-lg bg-green-500 text-white hover:bg-green-600 transition-colors"
        >
          <CheckCircle className="w-4 h-4 inline mr-1" />
          Approve
        </button>
      </div>
    </div>
  );
}

function SelectionView({
  request,
  onResolve,
}: {
  request: HitlRequest;
  onResolve: (selection: string) => void;
}) {
  const [selected, setSelected] = useState('');
  return (
    <div className="space-y-4">
      {request.message && (
        <p className="text-sm text-gray-600 dark:text-gray-400">{request.message}</p>
      )}
      <div className="space-y-1">
        {(request.options || []).map((opt) => (
          <button
            key={opt}
            onClick={() => setSelected(opt)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              selected === opt
                ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 ring-1 ring-purple-300'
                : 'bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => selected && onResolve(selected)}
          disabled={!selected}
          className="px-4 py-2 text-sm rounded-lg bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Confirm
        </button>
      </div>
    </div>
  );
}

function FormView({
  request,
  onResolve,
}: {
  request: HitlRequest;
  onResolve: (values: Record<string, unknown>) => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const f of request.fields || []) {
      if (f.type === 'boolean') initial[f.name] = false;
      else if (f.type === 'number') initial[f.name] = 0;
      else initial[f.name] = '';
    }
    return initial;
  });
  const [attempted, setAttempted] = useState(false);

  const fields = request.fields || [];
  const missing = fields.filter((f) => f.required && !isFieldFilled(f, values[f.name]));

  const handleSubmit = () => {
    setAttempted(true);
    if (missing.length === 0) onResolve(values);
  };

  const inputClass = (field: UIFormField) =>
    `w-full px-3 py-2 text-sm border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 ${
      attempted && field.required && !isFieldFilled(field, values[field.name])
        ? 'border-red-400 dark:border-red-500'
        : 'border-gray-200 dark:border-gray-700'
    }`;

  return (
    <div className="space-y-4">
      {request.message && (
        <p className="text-sm text-gray-600 dark:text-gray-400">{request.message}</p>
      )}
      <div className="space-y-3">
        {fields.map((field) => (
          <div key={field.name}>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {field.label}
              {field.required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            {field.type === 'select' ? (
              <select
                value={String(values[field.name] || '')}
                onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
                className={inputClass(field)}
              >
                <option value="">Select...</option>
                {(field.options || []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : field.type === 'boolean' ? (
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={Boolean(values[field.name])}
                  onChange={(e) => setValues({ ...values, [field.name]: e.target.checked })}
                  className="rounded border-gray-300 text-purple-500 focus:ring-purple-500"
                />
                {field.label}
              </label>
            ) : field.type === 'textarea' ? (
              <textarea
                value={String(values[field.name] || '')}
                onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
                placeholder={field.placeholder}
                rows={3}
                className={inputClass(field)}
              />
            ) : (
              <input
                type={field.type === 'number' ? 'number' : 'text'}
                value={String(values[field.name] ?? '')}
                onChange={(e) =>
                  setValues({
                    ...values,
                    [field.name]: field.type === 'number' ? Number(e.target.value) : e.target.value,
                  })
                }
                placeholder={field.placeholder}
                className={inputClass(field)}
              />
            )}
          </div>
        ))}
      </div>
      {attempted && missing.length > 0 && (
        <p className="text-xs text-red-500">
          Required fields missing: {missing.map((f) => f.label).join(', ')}
        </p>
      )}
      <div className="flex gap-2 justify-end">
        <button
          onClick={handleSubmit}
          className="px-4 py-2 text-sm rounded-lg bg-purple-500 text-white hover:bg-purple-600 transition-colors"
        >
          Submit
        </button>
      </div>
    </div>
  );
}

const SEVERITY_STYLES: Record<string, string> = {
  info: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
  warning: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400',
  error: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
};

function ReviewView({
  request,
  onResolve,
}: {
  request: HitlRequest;
  onResolve: (approved: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {request.message || 'Review the changes below:'}
      </p>
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            {(request.review || []).map((item, i) => (
              <tr
                key={`${item.label}-${i}`}
                className="border-b border-gray-100 dark:border-gray-700 last:border-b-0"
              >
                <td className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 w-1/3 align-top">
                  {item.label}
                </td>
                <td className="px-3 py-2 text-xs text-gray-800 dark:text-gray-200 font-mono whitespace-pre-wrap">
                  {item.value}
                </td>
                <td className="px-3 py-2 text-right align-top">
                  {item.severity && (
                    <span
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        SEVERITY_STYLES[item.severity] || SEVERITY_STYLES.info
                      }`}
                    >
                      {item.severity}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => onResolve(false)}
          className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <XCircle className="w-4 h-4 inline mr-1" />
          Reject
        </button>
        <button
          onClick={() => onResolve(true)}
          className="px-4 py-2 text-sm rounded-lg bg-green-500 text-white hover:bg-green-600 transition-colors"
        >
          <CheckCircle className="w-4 h-4 inline mr-1" />
          Approve
        </button>
      </div>
    </div>
  );
}

export default function HitlModal({ request, onResolve, onDismiss }: HitlModalProps) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const onResolveRef = useRef(onResolve);

  useEffect(() => {
    onResolveRef.current = onResolve;
  }, [onResolve]);

  useEffect(() => {
    if (!request) {
      setRemaining(null);
      return;
    }
    const timeoutMs = request.timeoutMs;
    if (!timeoutMs || timeoutMs <= 0) {
      setRemaining(null);
      return;
    }
    setRemaining(timeoutMs);
    const startedAt = Date.now();
    const interval = setInterval(() => {
      const left = timeoutMs - (Date.now() - startedAt);
      if (left <= 0) {
        clearInterval(interval);
        onResolveRef.current({
          requestId: request.id,
          kind: request.kind,
          approved: false,
          reviewed: false,
          timedOut: true,
        });
      } else {
        setRemaining(left);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [request]);

  if (!request) return null;

  const typeIcons = {
    confirmation: HelpCircle,
    selection: HelpCircle,
    form: AlertTriangle,
    review: AlertTriangle,
  };
  const TypeIcon = typeIcons[request.kind];
  const secondsLeft = remaining !== null ? Math.ceil(remaining / 1000) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex items-center gap-2">
            <TypeIcon className="w-5 h-5 text-purple-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{request.title}</h3>
          </div>
          <div className="flex items-center gap-2">
            {secondsLeft !== null && (
              <span className="flex items-center gap-1 text-[10px] font-mono text-gray-500 dark:text-gray-400">
                <Clock className="w-3 h-3" />
                {secondsLeft}s
              </span>
            )}
            <span className="text-[10px] text-gray-400 capitalize">{request.kind}</span>
            <button
              onClick={onDismiss}
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
            >
              <XCircle className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        </div>
        {secondsLeft !== null && (
          <div className="h-1 bg-gray-200 dark:bg-gray-700">
            <div
              className="h-full bg-purple-500 transition-all duration-300"
              style={{ width: `${((remaining ?? 0) / (request.timeoutMs ?? 1)) * 100}%` }}
            />
          </div>
        )}
        <div className="p-4">
          {request.kind === 'confirmation' && (
            <ConfirmationView
              request={request}
              onResolve={(approved) =>
                onResolve({ requestId: request.id, kind: request.kind, approved })
              }
            />
          )}
          {request.kind === 'selection' && (
            <SelectionView
              request={request}
              onResolve={(selection) =>
                onResolve({ requestId: request.id, kind: request.kind, selection })
              }
            />
          )}
          {request.kind === 'form' && (
            <FormView
              request={request}
              onResolve={(values) =>
                onResolve({ requestId: request.id, kind: request.kind, values })
              }
            />
          )}
          {request.kind === 'review' && (
            <ReviewView
              request={request}
              onResolve={(approved) =>
                onResolve({
                  requestId: request.id,
                  kind: request.kind,
                  approved,
                  reviewed: approved,
                })
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
