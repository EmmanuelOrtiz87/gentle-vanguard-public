import { useState } from 'react';
import {
  Activity,
  ShieldCheck,
  Database,
  AlertTriangle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Sparkles,
  HeartPulse,
} from 'lucide-react';
import type {
  StackCapabilities,
  StackAnomaly,
  StackCircuitBreaker,
  StackDbHealing,
} from '../types/dashboard';

interface StackCapabilitiesPanelProps {
  data?: StackCapabilities;
}

function formatTimestamp(ts: number | string): string {
  if (!ts) return '—';
  const date = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function getAnomalyIcon(type: StackAnomaly['type']) {
  switch (type) {
    case 'CRITICAL':
      return <XCircle className="w-4 h-4 text-red-500" />;
    case 'WARNING':
      return <AlertTriangle className="w-4 h-4 text-amber-500" />;
    case 'PREDICTION':
      return <Sparkles className="w-4 h-4 text-blue-500" />;
    default:
      return <AlertTriangle className="w-4 h-4 text-gray-400" />;
  }
}

function getAnomalyBadge(type: StackAnomaly['type']): string {
  switch (type) {
    case 'CRITICAL':
      return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
    case 'WARNING':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
    case 'PREDICTION':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
    default:
      return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
  }
}

function getCircuitColor(state: StackCircuitBreaker['state']): string {
  switch (state) {
    case 'OPEN':
      return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
    case 'HALF_OPEN':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
    case 'CLOSED':
      return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
    default:
      return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
  }
}

function AnomalyCard({ anomaly }: { anomaly: StackAnomaly }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 transition-all">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {getAnomalyIcon(anomaly.type)}
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${getAnomalyBadge(anomaly.type)}`}
          >
            {anomaly.type}
          </span>
          <span className="font-medium text-sm text-gray-900 dark:text-white truncate">
            {anomaly.message}
          </span>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors flex-shrink-0"
        >
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </button>
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatTimestamp(anomaly.detectedAt)}
        </span>
        <span>conf: {(anomaly.confidence * 100).toFixed(0)}%</span>
        <span className="text-gray-400 dark:text-gray-500">{anomaly.category}</span>
        {anomaly.autoHealed && (
          <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
            <HeartPulse className="w-3 h-3" />
            auto-healed
          </span>
        )}
      </div>
      {expanded && anomaly.recommendation && (
        <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
          <span className="text-gray-400 dark:text-gray-500">Recommendation: </span>
          {anomaly.recommendation}
          {anomaly.autoHealingAction && (
            <div className="mt-1 text-blue-600 dark:text-blue-400">
              Action: {anomaly.autoHealingAction}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CircuitBreakerCard({ breaker }: { breaker: StackCircuitBreaker }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 flex items-center justify-between">
      <div className="min-w-0">
        <p className="font-medium text-sm text-gray-900 dark:text-white truncate">{breaker.name}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {breaker.failures} failures · {breaker.successes} successes
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${getCircuitColor(breaker.state)}`}
        >
          {breaker.state}
        </span>
      </div>
    </div>
  );
}

function DbHealingCard({ healing }: { healing: StackDbHealing }) {
  const stats = [
    { label: 'Heals', value: healing.healCount },
    { label: 'Attempts', value: healing.healAttempts },
    { label: 'Vacuums', value: healing.metrics.vacuumCount },
    { label: 'Checkpoints', value: healing.metrics.checkpointCount },
    { label: 'Reindexes', value: healing.metrics.reindexCount },
    { label: 'Analyzes', value: healing.metrics.analyzeCount },
    { label: 'Prunes', value: healing.metrics.pruneCount },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map((s) => (
        <div key={s.label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2 text-center">
          <p className="text-xs text-gray-500 dark:text-gray-400">{s.label}</p>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{s.value}</p>
        </div>
      ))}
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2 text-center">
        <p className="text-xs text-gray-500 dark:text-gray-400">Last Heal</p>
        <p className="text-sm font-bold text-gray-900 dark:text-white">
          {formatTimestamp(healing.lastHealTime)}
        </p>
      </div>
    </div>
  );
}

export function StackCapabilitiesPanel({ data }: StackCapabilitiesPanelProps) {
  const empty = !data || (!data.anomalies.total && data.circuitBreakers.total === 0 && !data.dbHealing);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-emerald-500" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Stack Capabilities
          </h2>
        </div>
        {data && (
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-1 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
              {data.anomalies.critical} critical
            </span>
            <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              {data.anomalies.warning} warnings
            </span>
            <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              {data.circuitBreakers.open} open CB
            </span>
          </div>
        )}
      </div>

      {empty ? (
        <div className="text-center py-8 text-gray-400 dark:text-gray-500">
          <ShieldCheck className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Stack capabilities idle</p>
          <p className="text-xs mt-1">
            Anomalies, circuit breakers and DB healing reports will appear here
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Anomalies */}
          {data!.anomalies.total > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Anomalies</h3>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {data!.anomalies.total} total · {data!.anomalies.autoHealed} auto-healed
                </span>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {data!.anomalies.latest.map((anomaly, index) => (
                  <AnomalyCard key={anomaly.id || index} anomaly={anomaly} />
                ))}
              </div>
            </div>
          )}

          {/* Circuit Breakers */}
          {data!.circuitBreakers.total > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="w-4 h-4 text-purple-500" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                  Circuit Breakers
                </h3>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {data!.circuitBreakers.closed} closed · {data!.circuitBreakers.halfOpen} half-open
                  · {data!.circuitBreakers.open} open
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {data!.circuitBreakers.breakers.map((breaker) => (
                  <CircuitBreakerCard key={breaker.name} breaker={breaker} />
                ))}
              </div>
            </div>
          )}

          {/* DB Healing */}
          {data!.dbHealing && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Database className="w-4 h-4 text-blue-500" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">DB Healing</h3>
                {data!.dbHealing.lastError && (
                  <span className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                    <XCircle className="w-3 h-3" />
                    {data!.dbHealing.lastError}
                  </span>
                )}
              </div>
              <DbHealingCard healing={data!.dbHealing} />
            </div>
          )}

          <div className="text-right">
            <span className="text-xs text-gray-400 dark:text-gray-500">
              Updated {data!.lastUpdated ? formatTimestamp(data!.lastUpdated) : '—'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
