/**
 * metrics-aggregator.ts — Agrega métricas de todas las fuentes para el Dashboard
 *
 * Centraliza la recolección de métricas desde:
 * - SessionContextLog (sesiones activas)
 * - session-metrics-tracker.ts (métricas en tiempo real)
 * - monitor/cost-tracker.ts (tracking de costos)
 * - token-tracker.ts (tracking de tokens)
 * - Database (métricas históricas)
 *
 * USO: Dashboard importa esto para obtener métricas unificadas
 */

import * as fs from 'fs';
import { pathToFileURL } from 'url';
import * as path from 'path';
import { ROOT } from './repo-root';
import { getAllSessionStates, SessionState } from './session-context-log';
import { getAllLiveMetrics } from './session-metrics-tracker';
import { log } from '../utils/logger.js';

const logger = log('METRICS-AGGREGATOR');

// ─── Fuentes de datos ─────────────────────────────────────────────────────────

const COST_TRACKING_PATH = path.join(ROOT, '.session', 'cost-tracking.json');
const TOKEN_USAGE_PATH = path.join(ROOT, '.session', 'token-usage.json');
// LIVE_METRICS_DIR se maneja internamente por session-metrics-tracker

interface CostTrackingData {
  date: string;
  totalTokens: number;
  totalCostUsd: number;
  byAgent: Record<string, { tokens: number; cost: number }>;
  byModel: Record<string, { tokens: number; cost: number }>;
  entries: Array<{
    timestamp: string;
    agent: string;
    taskType: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
}

interface TokenUsageData {
  totalTokens?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCost?: number;
  cost_usd?: number;
  sessions?: string[];
}

// ─── Funciones de lectura ──────────────────────────────────────────────────

function readJson<T>(path: string): T | null {
  try {
    if (!fs.existsSync(path)) return null;
    const content = fs.readFileSync(path, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

// ─── Agregador Principal ─────────────────────────────────────────────────────

export interface AggregatedMetrics {
  // Sessions
  sessionsTotal: number;
  sessionsActive: number;
  sessionsToday: number;

  // Tokens
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;

  // Costos
  totalCost: number;
  costByModel: Record<string, number>;
  costByAgent: Record<string, number>;

  // Feedback
  feedbackUp: number;
  feedbackDown: number;
  feedbackTotal: number;

  // Latency
  avgLatency: number;
  p50Latency: number;
  p95Latency: number;

  // SLO
  sloCompliance: number;
  sloViolations: number;
  sloTotal: number;

  // Datos crudos para gráficas
  sessions: SessionState[];
  history: Array<{
    timestamp: string;
    tokens: number;
    cost: number;
    latency: number;
    sessions: number;
  }>;
}

/**
 * Obtiene todas las métricas agregadas para el Dashboard
 */
export function getAggregatedDashboardMetrics(): AggregatedMetrics {
  // 1. Leer SessionContextLog (sesiones actuales)
  const sessions = getAllSessionStates();
  const today = new Date().toISOString().slice(0, 10);
  const sessionsToday = sessions.filter((s) => s.createdAt?.startsWith(today)).length;

  // 2. Leer métricas en tiempo real
  const liveMetrics = getAllLiveMetrics();

  // 3. Leer cost tracking
  const costData = readJson<CostTrackingData>(COST_TRACKING_PATH);

  // 4. Leer token usage
  const tokenData = readJson<TokenUsageData>(TOKEN_USAGE_PATH);
  const tokenFileTotal = tokenData
    ? (tokenData.totalTokens ??
      (tokenData.totalInputTokens || 0) + (tokenData.totalOutputTokens || 0))
    : 0;

  // Calcular tokens totales (priorizar datos más recientes)
  const totalTokens = Math.max(
    liveMetrics.totalTokens,
    costData?.totalTokens || 0,
    tokenFileTotal,
    sessions.reduce((sum, s) => sum + (s.totalTokens || 0), 0),
  );

  // Calcular costos (priorizar cost-tracking que es más preciso)
  const totalCost = Math.max(
    liveMetrics.totalCost,
    costData?.totalCostUsd || 0,
    tokenData?.totalCost ?? tokenData?.cost_usd ?? 0,
  );

  // Calcular input/output tokens desde entries de cost tracking (fuente canónica);
  // fallback proporcional 80/20 si no hay desglose registrado.
  const costEntries = costData?.entries || [];
  const entriesInput = costEntries.reduce((sum, e) => sum + (e.inputTokens || 0), 0);
  const entriesOutput = costEntries.reduce((sum, e) => sum + (e.outputTokens || 0), 0);
  const totalInputTokens =
    entriesInput > 0 || entriesOutput > 0 ? entriesInput : Math.round(totalTokens * 0.8);
  const totalOutputTokens =
    entriesInput > 0 || entriesOutput > 0 ? entriesOutput : Math.round(totalTokens * 0.2);

  // Calcular feedback
  const feedbackUp = liveMetrics.totalFeedbackUp;
  const feedbackDown = liveMetrics.totalFeedbackDown;

  // Calcular latencia
  const avgLatency = liveMetrics.avgLatency;

  // SLO compliance real: violaciones de latencia (>5s) desde los turnos del tracker
  const sloCompliance = liveMetrics.sloTotal > 0 ? liveMetrics.sloCompliance : 0;
  const sloViolations = liveMetrics.sloViolations ?? 0;
  const sloTotal = liveMetrics.sloTotal ?? 0;

  // Construir historial para gráficas
  const history = buildHistory(sessions, costData);

  return {
    sessionsTotal: sessions.length,
    sessionsActive: sessions.filter((s) => s.status === 'active').length,
    sessionsToday,

    totalTokens,
    totalInputTokens,
    totalOutputTokens,

    totalCost,
    costByModel: costData?.byModel
      ? Object.fromEntries(Object.entries(costData.byModel).map(([k, v]) => [k, v.cost]))
      : {},
    costByAgent: costData?.byAgent
      ? Object.fromEntries(Object.entries(costData.byAgent).map(([k, v]) => [k, v.cost]))
      : {},

    feedbackUp,
    feedbackDown,
    feedbackTotal: feedbackUp + feedbackDown,

    avgLatency,
    p50Latency: liveMetrics.p50Latency ?? avgLatency * 0.9, // percentil real si está disponible
    p95Latency: liveMetrics.p95Latency ?? avgLatency * 1.5,

    sloCompliance,
    sloViolations,
    sloTotal,

    sessions,
    history,
  };
}

/**
 * Construye historial de métricas para gráficas
 */
function buildHistory(
  _sessions: SessionState[],
  costData: CostTrackingData | null,
): AggregatedMetrics['history'] {
  const history: AggregatedMetrics['history'] = [];

  // Agregar entradas de cost tracking
  if (costData?.entries) {
    for (const entry of costData.entries.slice(-20)) {
      history.push({
        timestamp: entry.timestamp,
        tokens: entry.inputTokens + entry.outputTokens,
        cost: entry.costUsd,
        latency: 0, // No tenemos dato
        sessions: 1,
      });
    }
  }

  return history;
}

/**
 * Actualiza métricas de la sesión actual durante ejecución
 * USO: Llama esto cada vez que se usa un tool o se recibe una respuesta
 */
export function recordMetricEvent(event: {
  sessionId: string;
  type: 'tool_use' | 'llm_response' | 'feedback';
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  costUsd?: number;
  toolName?: string;
  feedback?: 'up' | 'down';
}): void {
  // Importación dinámica para evitar circular dependency
  const { trackTokenUsage, trackFeedback } = require('./session-metrics-tracker');
  const { SessionContextLog } = require('./session-context-log');

  // Actualizar session-metrics-tracker
  if (event.type === 'tool_use' || event.type === 'llm_response') {
    trackTokenUsage(
      event.sessionId,
      event.inputTokens || 0,
      event.outputTokens || 0,
      event.latencyMs || 0,
      event.costUsd || 0,
    );
  }

  // Registrar feedback
  if (event.type === 'feedback' && event.feedback) {
    trackFeedback(event.sessionId, event.feedback === 'up' ? 'thumbs_up' : 'thumbs_down');
  }

  // También actualizar SessionContextLog
  try {
    const state = require('./session-context-log').readSessionState(event.sessionId);
    if (state) {
      const ctxLog = new SessionContextLog(state);
      ctxLog.update({
        totalTokens: state.totalTokens + ((event.inputTokens || 0) + (event.outputTokens || 0)),
        totalCost: state.totalCost + (event.costUsd || 0),
      });
      if (event.inputTokens || event.outputTokens) {
        ctxLog.addTurn({
          timestamp: new Date().toISOString(),
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
        });
      }
      ctxLog.save();
    }
  } catch (err) {
    // Log silencioso
    logger.error('[MetricsAggregator] Error updating context log:', err);
  }
}

// ─── CLI para testing ───────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('[MetricsAggregator] Testing...');
  const metrics = getAggregatedDashboardMetrics();
  console.log(JSON.stringify(metrics, null, 2));
}
