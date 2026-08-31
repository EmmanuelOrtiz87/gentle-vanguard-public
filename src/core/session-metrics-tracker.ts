/**
 * session-metrics-tracker.ts — Actualización de métricas en tiempo real para sesiones activas
 *
 * USO: Importar y usar DURANTE la ejecución de la sesión para actualizar tokens, costos, etc.
 * No guarda en disco constantemente, solo acumula en memoria y sincroniza periódicamente.
 *
 * Ejemplo de uso en el pipeline:
 *   import { SessionMetricsTracker } from './session-metrics-tracker';
 *   const tracker = SessionMetricsTracker.getInstance(sessionId);
 *   tracker.addTokenUsage(150, 75); // input, output
 *   tracker.addFeedback('thumbs_up');
 */

import * as fs from 'fs';
import * as path from 'path';
import { ROOT } from './repo-root';
import { SessionContextLog } from './session-context-log';
const logger = log('CORE-SESSION-METRICS-TRACKER');
import { log } from '../utils/logger.js';

interface TurnData {
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  toolCalls: number;
  cost: number;
  feedback?: 'thumbs_up' | 'thumbs_down' | null;
}

interface SessionMetrics {
  sessionId: string;
  startTime: string;
  totalTokens: number;
  totalCost: number;
  turnCount: number;
  turns: TurnData[];
  feedbackUp: number;
  feedbackDown: number;
  avgLatency: number;
  lastUpdate: string;
}

const METRICS_DIR = path.join(ROOT, '.session', 'live-metrics');

export class SessionMetricsTracker {
  private static instances: Map<string, SessionMetricsTracker> = new Map();
  private sessionId: string;
  private metrics: SessionMetrics;
  private flushInterval: ReturnType<typeof setInterval> | null = null;

  private constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.metrics = this.loadOrCreate();

    // Guardar en disco cada 5 segundos
    this.flushInterval = setInterval(() => this.flush(), 5000);
  }

  static getInstance(sessionId: string): SessionMetricsTracker {
    if (!SessionMetricsTracker.instances.has(sessionId)) {
      SessionMetricsTracker.instances.set(sessionId, new SessionMetricsTracker(sessionId));
    }
    return SessionMetricsTracker.instances.get(sessionId)!;
  }

  static destroy(sessionId: string): void {
    const tracker = SessionMetricsTracker.instances.get(sessionId);
    if (tracker) {
      tracker.cleanup();
      SessionMetricsTracker.instances.delete(sessionId);
    }
  }

  private ensureMetricsDir(): void {
    if (!fs.existsSync(METRICS_DIR)) {
      fs.mkdirSync(METRICS_DIR, { recursive: true });
    }
  }

  private getMetricsPath(): string {
    return path.join(METRICS_DIR, `${this.sessionId}.json`);
  }

  private loadOrCreate(): SessionMetrics {
    this.ensureMetricsDir();
    const metricsPath = this.getMetricsPath();

    if (fs.existsSync(metricsPath)) {
      try {
        const content = fs.readFileSync(metricsPath, 'utf-8');
        return JSON.parse(content);
      } catch {
        // Corrupt file, create new
      }
    }

    return {
      sessionId: this.sessionId,
      startTime: new Date().toISOString(),
      totalTokens: 0,
      totalCost: 0,
      turnCount: 0,
      turns: [],
      feedbackUp: 0,
      feedbackDown: 0,
      avgLatency: 0,
      lastUpdate: new Date().toISOString(),
    };
  }

  /**
   * Agregar uso de tokens de un turno
   */
  addTokenUsage(
    inputTokens: number,
    outputTokens: number,
    latencyMs: number = 0,
    cost: number = 0,
  ): void {
    const turn: TurnData = {
      timestamp: new Date().toISOString(),
      inputTokens,
      outputTokens,
      latencyMs,
      toolCalls: 0,
      cost,
    };

    this.metrics.turns.push(turn);
    this.metrics.totalTokens += inputTokens + outputTokens;
    this.metrics.totalCost += cost;
    this.metrics.turnCount++;

    // Recalcular latencia promedio
    const totalLatency = this.metrics.turns.reduce((sum, t) => sum + t.latencyMs, 0);
    this.metrics.avgLatency = totalLatency / this.metrics.turns.length;

    this.metrics.lastUpdate = new Date().toISOString();

    // Log puntual
    logger.info(
      `[MetricsTracker] ${this.sessionId}: +${inputTokens + outputTokens} tokens, cost $${cost.toFixed(4)}`,
    );
  }

  /**
   * Agregar feedback del usuario
   */
  addFeedback(type: 'thumbs_up' | 'thumbs_down'): void {
    if (type === 'thumbs_up') {
      this.metrics.feedbackUp++;
    } else {
      this.metrics.feedbackDown++;
    }
    this.metrics.lastUpdate = new Date().toISOString();
    logger.info(`[MetricsTracker] ${this.sessionId}: ${type} received`);
  }

  /**
   * Agregar llamada a herramienta (tool)
   */
  addToolCall(_toolName: string, latencyMs: number = 0): void {
    const lastTurn = this.metrics.turns[this.metrics.turns.length - 1];
    if (lastTurn) {
      lastTurn.toolCalls++;
      lastTurn.latencyMs += latencyMs;
    }
    this.metrics.lastUpdate = new Date().toISOString();
  }

  /**
   * Obtener métricas actuales
   */
  getMetrics(): SessionMetrics {
    return { ...this.metrics };
  }

  /**
   * Calcular SLO compliance basado en latencia
   */
  getSLOCompliance(): { compliance: number; violations: number; total: number } {
    const SLO_THRESHOLD_MS = 5000; // 5 segundos de SLO
    const violations = this.metrics.turns.filter((t) => t.latencyMs > SLO_THRESHOLD_MS).length;
    const total = this.metrics.turns.length;
    const compliance = total > 0 ? ((total - violations) / total) * 100 : 100;

    return {
      compliance: Math.round(compliance),
      violations,
      total,
    };
  }

  /**
   * Sincronizar con SessionContextLog (para persistencia final)
   */
  syncToContextLog(): void {
    const ctxLog = new SessionContextLog({
      sessionId: this.sessionId,
      agent: 'unknown',
      status: 'active',
      totalTokens: this.metrics.totalTokens,
      totalCost: this.metrics.totalCost,
      messageCount: this.metrics.turnCount,
    });

    // Agregar todos los turns
    for (const turn of this.metrics.turns) {
      ctxLog.addTurn({
        inputTokens: turn.inputTokens,
        outputTokens: turn.outputTokens,
        timestamp: turn.timestamp,
      });
    }

    ctxLog.save();
    logger.info(`[MetricsTracker] ${this.sessionId}: Synced to ContextLog`);
  }

  /**
   * Guardar en disco (llamado automáticamente cada 5s)
   */
  flush(): void {
    try {
      this.ensureMetricsDir();
      fs.writeFileSync(this.getMetricsPath(), JSON.stringify(this.metrics, null, 2), 'utf-8');
    } catch (err) {
      logger.error(`[MetricsTracker] Error flushing: ${err}`);
    }
  }

  /**
   * Limpiar recursos
   */
  cleanup(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush(); // Guardar final
    this.syncToContextLog(); // Sincronizar con ContextLog
  }
}

// ─── Funciones de conveniencia para el pipeline ─────────────────────

/**
 * Registrar uso de tokens desde cualquier parte del pipeline
 */
export function trackTokenUsage(
  sessionId: string,
  inputTokens: number,
  outputTokens: number,
  latencyMs?: number,
  cost?: number,
): void {
  const tracker = SessionMetricsTracker.getInstance(sessionId);
  tracker.addTokenUsage(inputTokens, outputTokens, latencyMs, cost);
}

/**
 * Registrar feedback del usuario
 */
export function trackFeedback(sessionId: string, type: 'thumbs_up' | 'thumbs_down'): void {
  const tracker = SessionMetricsTracker.getInstance(sessionId);
  tracker.addFeedback(type);
}

/**
 * Registrar uso de tokens externo (ej. daemon token-ingest) directamente en disco.
 * A diferencia de getInstance()/addTokenUsage(), no crea singletons ni intervalos:
 * carga el JSON del session, acumula el delta y reescribe el archivo. Seguro para daemons.
 */
export function recordExternalUsage(
  sessionId: string,
  inputTokens: number,
  outputTokens: number,
  cost = 0,
  latencyMs = 0,
): void {
  try {
    const dir = path.join(ROOT, '.session', 'live-metrics');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const metricsPath = path.join(dir, `${sessionId}.json`);
    let m: SessionMetrics;
    if (fs.existsSync(metricsPath)) {
      try {
        m = JSON.parse(fs.readFileSync(metricsPath, 'utf-8')) as SessionMetrics;
      } catch {
        m = {
          sessionId,
          startTime: new Date().toISOString(),
          totalTokens: 0,
          totalCost: 0,
          turnCount: 0,
          turns: [],
          feedbackUp: 0,
          feedbackDown: 0,
          avgLatency: 0,
          lastUpdate: new Date().toISOString(),
        };
      }
    } else {
      m = {
        sessionId,
        startTime: new Date().toISOString(),
        totalTokens: 0,
        totalCost: 0,
        turnCount: 0,
        turns: [],
        feedbackUp: 0,
        feedbackDown: 0,
        avgLatency: 0,
        lastUpdate: new Date().toISOString(),
      };
    }
    // Limitar historial de turns para que el archivo no crezca indefinidamente.
    m.turns.push({
      timestamp: new Date().toISOString(),
      inputTokens,
      outputTokens,
      latencyMs,
      toolCalls: 0,
      cost,
    });
    if (m.turns.length > 500) m.turns = m.turns.slice(-500);
    m.totalTokens += inputTokens + outputTokens;
    m.totalCost += cost;
    m.turnCount++;
    const totalLatency = m.turns.reduce((sum, t) => sum + t.latencyMs, 0);
    m.avgLatency = totalLatency / m.turns.length;
    m.lastUpdate = new Date().toISOString();
    fs.writeFileSync(metricsPath, JSON.stringify(m, null, 2), 'utf-8');
  } catch (err) {
    logger.error(`[MetricsTracker] recordExternalUsage(${sessionId}): ${err}`);
  }
}

/**
 * Obtener métricas agregadas de todas las sesiones activas
 */
export function getAllLiveMetrics(): {
  totalTokens: number;
  totalCost: number;
  totalTurns: number;
  totalFeedbackUp: number;
  totalFeedbackDown: number;
  avgLatency: number;
  p50Latency: number;
  p95Latency: number;
  sloCompliance: number;
  sloViolations: number;
  sloTotal: number;
  sessions: string[];
} {
  const metrics: SessionMetrics[] = [];

  // Leer todos los archivos de métricas
  if (fs.existsSync(METRICS_DIR)) {
    const files = fs.readdirSync(METRICS_DIR).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(METRICS_DIR, file), 'utf-8');
        metrics.push(JSON.parse(content));
      } catch {
        // Skip corrupt files
      }
    }
  }

  // Recolectar todas las latencias de turnos para percentiles reales y SLO
  const allLatencies: number[] = [];
  for (const m of metrics) {
    for (const t of m.turns ?? []) {
      if (typeof t.latencyMs === 'number' && t.latencyMs >= 0) allLatencies.push(t.latencyMs);
    }
  }
  const sorted = [...allLatencies].sort((a, b) => a - b);
  const pct = (p: number): number => {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[Math.max(0, idx)];
  };

  const SLO_THRESHOLD_MS = 5000; // mismo umbral que getSLOCompliance()
  const sloViolations = allLatencies.filter((l) => l > SLO_THRESHOLD_MS).length;
  const sloTotal = allLatencies.length;

  return {
    totalTokens: metrics.reduce((sum, m) => sum + m.totalTokens, 0),
    totalCost: metrics.reduce((sum, m) => sum + m.totalCost, 0),
    totalTurns: metrics.reduce((sum, m) => sum + m.turnCount, 0),
    totalFeedbackUp: metrics.reduce((sum, m) => sum + m.feedbackUp, 0),
    totalFeedbackDown: metrics.reduce((sum, m) => sum + m.feedbackDown, 0),
    avgLatency:
      metrics.length > 0 ? metrics.reduce((sum, m) => sum + m.avgLatency, 0) / metrics.length : 0,
    p50Latency: pct(50),
    p95Latency: pct(95),
    // No samples means no measured SLO, not 100% compliance.
    sloCompliance: sloTotal > 0 ? Math.round(((sloTotal - sloViolations) / sloTotal) * 100) : 0,
    sloViolations,
    sloTotal,
    sessions: metrics.map((m) => m.sessionId),
  };
}
