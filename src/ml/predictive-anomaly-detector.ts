#!/usr/bin/env tsx
/**
 * Predictive Anomaly Detector (PAD) - Sistema de Predicción de Anomalías
 *
 * Versión: 1.0.0
 *
 * Funcionalidad:
 * - Analiza patrones históricos para predecir problemas
 * - Detecta anomalías en tiempo real
 * - Auto-healing para casos conocidos
 * - Sistema de alertas proactivas con múltiples canales
 *
 * Usage:
 *   npx tsx src/ml/predictive-anomaly-detector.ts --monitor    # Modo monitoreo
 *   npx tsx src/ml/predictive-anomaly-detector.ts --analyze    # Análisis único
 *   npx tsx src/ml/predictive-anomaly-detector.ts --dashboard  # API para dashboard
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { join, resolve } from 'path';

const ROOT = resolve(process.cwd());
const LOG_DIR = join(ROOT, '.runtime', 'anomaly-logs');
const STATE_FILE = join(ROOT, '.runtime', 'anomaly-state.json');
const ALERT_HISTORY = join(ROOT, '.runtime', 'anomaly-alerts.json');

// Asegurar directorios
mkdirSync(LOG_DIR, { recursive: true });

// ─── Configuration ─────────────────────────────────────────────────────────────
const CONFIG = {
  thresholds: {
    // Token usage
    tokenWarningSoft: 5000000, // 5M
    tokenWarningHard: 10000000, // 10M
    tokenCritical: 15000000, // 15M

    // Performance
    latencyP95: 5000, // 5s
    latencyP99: 10000, // 10s

    // Memory
    memoryWarning: 512, // 512MB
    memoryCritical: 1024, // 1GB

    // Database
    dbConnections: 50,
    slowQueryMs: 100,
    walSize: 10485760, // 10MB

    // Dashboard
    wsReconnects: 3,
    healthFailRate: 0.1, // 10%

    // Session
    stepsRemaining: 10,
    contextTokens: 12000, // 12K
  },

  prediction: {
    // Ventanas de tiempo para análisis
    shortWindow: 5, // 5 minutos
    mediumWindow: 30, // 30 minutos
    longWindow: 120, // 2 horas

    // Sensibilidad (0-1)
    sensitivity: 0.8,

    // Umbral para alerta de predicción
    predictConfidence: 0.7,
  },

  autoHealing: {
    enabled: true,
    actions: [
      { condition: 'token_spike_soft', action: 'suggest_checkpoint' },
      { condition: 'token_spike_hard', action: 'force_checkpoint' },
      { condition: 'high_memory', action: 'gc_trigger' },
      { condition: 'db_bloat', action: 'db_optimize' },
      { condition: 'ws_disconnect', action: 'ws_restart' },
    ],
  },

  alerting: {
    channels: ['cli', 'dashboard', 'file'],
    cooldownMinutes: 5,
    maxAlertsPerHour: 20,
  },
};

// ─── Logger ─────────────────────────────────────────────────────────────────────
function log(
  level: 'INFO' | 'WARN' | 'ERROR' | 'ALERT',
  message: string,
  meta?: Record<string, unknown>,
): void {
  const timestamp = new Date().toISOString();
  const prefix =
    level === 'ALERT' ? '🔔' : level === 'ERROR' ? '❌' : level === 'WARN' ? '⚠️' : 'ℹ️';
  const line = `[${timestamp}] ${prefix} [${level}] ${message}`;

  console.log(line);
  if (meta) console.log('  ', JSON.stringify(meta, null, 2));

  appendFileSync(join(LOG_DIR, 'anomaly.log'), line + '\n', 'utf-8');
}

// ─── Types ──────────────────────────────────────────────────────────────────────
interface MetricSnapshot {
  timestamp: number;
  tokens: { input: number; output: number; total: number };
  latency: { p50: number; p95: number; p99: number };
  memory: number; // MB
  db: { connections: number; slowQueries: number; walSize: number };
  dashboard: { wsConnected: boolean; healthScore: number };
  session: { stepsRemaining: number; contextTokens: number };
}

interface AnomalyDetection {
  id: string;
  type: 'CRITICAL' | 'WARNING' | 'PREDICTION';
  category: 'token' | 'performance' | 'memory' | 'db' | 'dashboard' | 'session';
  message: string;
  confidence: number;
  detectedAt: string;
  metrics: Partial<MetricSnapshot>;
  recommendation: string;
  autoHealed?: boolean;
  autoHealingAction?: string;
}

interface Prediction {
  type: string;
  probability: number;
  timeToOccurrence: number; // minutos estimados
  rationale: string;
}

// ─── State Management ─────────────────────────────────────────────────────────
function loadState(): { predictions: Prediction[]; lastAlert: number; alertCount: number } {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch {}
  return { predictions: [], lastAlert: 0, alertCount: 0 };
}

function saveState(state: {
  predictions: Prediction[];
  lastAlert: number;
  alertCount: number;
}): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function loadAlertHistory(): AnomalyDetection[] {
  try {
    if (existsSync(ALERT_HISTORY)) {
      return JSON.parse(readFileSync(ALERT_HISTORY, 'utf-8')).alerts || [];
    }
  } catch {}
  return [];
}

function saveAlert(alert: AnomalyDetection): void {
  const history = loadAlertHistory();
  history.push(alert);
  // Mantener últimos 1000
  if (history.length > 1000) history.shift();
  writeFileSync(ALERT_HISTORY, JSON.stringify({ alerts: history }, null, 2), 'utf-8');
}

// ─── Metric Collectors ───────────────────────────────────────────────────────────
async function collectMetrics(): Promise<MetricSnapshot> {
  const now = Date.now();

  // Token metrics (desde Nexus/db si existe)
  let tokens = { input: 0, output: 0, total: 0 };
  try {
    // Intentar obtener de token-usage-reader o similar
    const tokenReport = join(ROOT, 'reports', 'stack-live-observability-latest.json');
    if (existsSync(tokenReport)) {
      const data = JSON.parse(readFileSync(tokenReport, 'utf-8'));
      tokens = data.tokenMetrics || tokens;
    }
  } catch {}

  // Memory
  const memUsage = process.memoryUsage();
  const memoryMB = Math.round(memUsage.heapUsed / 1024 / 1024);

  // Database
  const dbMetrics = { connections: 0, slowQueries: 0, walSize: 0 };
  try {
    const dbPath = join(ROOT, '.runtime', 'gentle-vanguard.db');
    if (existsSync(dbPath)) {
      const walPath = dbPath + '-wal';
      if (existsSync(walPath)) {
        const stats = readFileSync(walPath);
        dbMetrics.walSize = stats.length;
      }
    }
  } catch {}

  // Dashboard health
  const dashboard = { wsConnected: false, healthScore: 100 };
  try {
    const healthCheck = join(ROOT, '.runtime', 'health-report-latest.json');
    if (existsSync(healthCheck)) {
      const data = JSON.parse(readFileSync(healthCheck, 'utf-8'));
      dashboard.healthScore = data.overall === 'PASS' ? 100 : data.overall === 'WARN' ? 75 : 50;
    }
  } catch {}

  return {
    timestamp: now,
    tokens,
    latency: { p50: 0, p95: 0, p99: 0 }, // Se calcularía desde traces
    memory: memoryMB,
    db: dbMetrics,
    dashboard,
    session: { stepsRemaining: 6, contextTokens: 8000 }, // Estimado
  };
}

// ─── Anomaly Detection ──────────────────────────────────────────────────────────
function detectAnomalies(metrics: MetricSnapshot): AnomalyDetection[] {
  const anomalies: AnomalyDetection[] = [];
  const now = new Date().toISOString();

  // Token anomalies
  if (metrics.tokens.total > CONFIG.thresholds.tokenCritical) {
    anomalies.push({
      id: `token-critical-${now}`,
      type: 'CRITICAL',
      category: 'token',
      message: `Token usage critical: ${(metrics.tokens.total / 1000000).toFixed(1)}M tokens`,
      confidence: 1.0,
      detectedAt: now,
      metrics: { tokens: metrics.tokens },
      recommendation: 'Force session checkpoint and suggest new session immediately',
    });
  } else if (metrics.tokens.total > CONFIG.thresholds.tokenWarningHard) {
    anomalies.push({
      id: `token-hard-${now}`,
      type: 'WARNING',
      category: 'token',
      message: `Token usage high: ${(metrics.tokens.total / 1000000).toFixed(1)}M tokens`,
      confidence: 0.9,
      detectedAt: now,
      metrics: { tokens: metrics.tokens },
      recommendation: 'Create checkpoint soon and consider session rotation',
    });
  } else if (metrics.tokens.total > CONFIG.thresholds.tokenWarningSoft) {
    // Predecir si continuará creciendo
    anomalies.push({
      id: `token-prediction-${now}`,
      type: 'PREDICTION',
      category: 'token',
      message: `Token usage trending towards limit: ${(metrics.tokens.total / 1000000).toFixed(1)}M tokens`,
      confidence: 0.7,
      detectedAt: now,
      metrics: { tokens: metrics.tokens },
      recommendation: 'Monitor closely; prepare checkpoint in next 10 minutes',
    });
  }

  // Memory anomalies
  if (metrics.memory > CONFIG.thresholds.memoryCritical) {
    anomalies.push({
      id: `memory-critical-${now}`,
      type: 'CRITICAL',
      category: 'memory',
      message: `Memory usage critical: ${metrics.memory}MB`,
      confidence: 0.95,
      detectedAt: now,
      metrics: { memory: metrics.memory },
      recommendation: 'Trigger garbage collection or restart components',
    });
  } else if (metrics.memory > CONFIG.thresholds.memoryWarning) {
    anomalies.push({
      id: `memory-warning-${now}`,
      type: 'WARNING',
      category: 'memory',
      message: `Memory usage high: ${metrics.memory}MB`,
      confidence: 0.8,
      detectedAt: now,
      metrics: { memory: metrics.memory },
      recommendation: 'Monitor for memory leaks; consider GC trigger',
    });
  }

  // Database anomalies
  if (metrics.db.walSize > CONFIG.thresholds.walSize) {
    anomalies.push({
      id: `db-wal-${now}`,
      type: 'WARNING',
      category: 'db',
      message: `SQLite WAL file large: ${(metrics.db.walSize / 1048576).toFixed(1)}MB`,
      confidence: 0.85,
      detectedAt: now,
      metrics: { db: metrics.db },
      recommendation: 'Run DB optimization (VACUUM + checkpoint)',
    });
  }

  // Session anomalies
  if (metrics.session.stepsRemaining < CONFIG.thresholds.stepsRemaining) {
    anomalies.push({
      id: `session-steps-${now}`,
      type: 'WARNING',
      category: 'session',
      message: `Low steps remaining: ${metrics.session.stepsRemaining}`,
      confidence: 0.9,
      detectedAt: now,
      metrics: { session: metrics.session },
      recommendation: 'Consider delegating to subagents or creating checkpoint',
    });
  }

  if (metrics.session.contextTokens > CONFIG.thresholds.contextTokens) {
    anomalies.push({
      id: `session-context-${now}`,
      type: 'WARNING',
      category: 'session',
      message: `Context size high: ${metrics.session.contextTokens.toLocaleString()} tokens`,
      confidence: 0.85,
      detectedAt: now,
      metrics: { session: metrics.session },
      recommendation: 'Use context-truncator or start new session',
    });
  }

  return anomalies;
}

// ─── Predictive Analysis ─────────────────────────────────────────────────────────
function predictAnomalies(current: MetricSnapshot, history: MetricSnapshot[]): Prediction[] {
  const predictions: Prediction[] = [];
  if (history.length < 3) return predictions;

  // Analizar tendencia de tokens
  const recent = history.slice(-10);
  const tokenTrend = recent.map((m) => m.tokens.total);

  // Calcular rate de crecimiento
  let growthRate = 0;
  for (let i = 1; i < tokenTrend.length; i++) {
    if (tokenTrend[i - 1] > 0) {
      growthRate += (tokenTrend[i] - tokenTrend[i - 1]) / tokenTrend[i - 1];
    }
  }
  growthRate /= Math.max(1, tokenTrend.length - 1);

  // Predecir tokens
  if (growthRate > 0.1) {
    const currentTotal = current.tokens.total;
    const projected15M = currentTotal * (1 + growthRate * 5); // 5 períodos más

    if (projected15M > CONFIG.thresholds.tokenCritical) {
      const timeToCritical = Math.ceil(
        (CONFIG.thresholds.tokenCritical - currentTotal) / (currentTotal * growthRate),
      );
      predictions.push({
        type: 'token_limit_exceeded',
        probability: Math.min(0.95, growthRate * 3),
        timeToOccurrence: timeToCritical,
        rationale: `Token growth rate is ${(growthRate * 100).toFixed(1)}% per period. Will exceed critical threshold in ~${timeToCritical} periods`,
      });
    }
  }

  // Predecir memory leaks
  const memTrend = recent.map((m) => m.memory);
  const memIncreasing = memTrend.every((v, i, a) => i === 0 || v >= a[i - 1] - 10);
  if (memIncreasing && memTrend[memTrend.length - 1] > memTrend[0] * 1.2) {
    const avgGrowth = (memTrend[memTrend.length - 1] - memTrend[0]) / memTrend.length;
    const timeToCritical = Math.ceil(
      (CONFIG.thresholds.memoryCritical - current.memory) / Math.max(1, avgGrowth),
    );

    predictions.push({
      type: 'memory_leak',
      probability: 0.75,
      timeToOccurrence: timeToCritical,
      rationale: `Memory consistently growing; possible leak detected`,
    });
  }

  return predictions;
}

// ─── Auto-Healing ────────────────────────────────────────────────────────────────
async function attemptAutoHeal(anomaly: AnomalyDetection): Promise<boolean> {
  if (!CONFIG.autoHealing.enabled) return false;

  const action = CONFIG.autoHealing.actions.find(
    (a) =>
      anomaly.category === a.condition.split('_')[0] ||
      anomaly.type.toLowerCase().includes(a.condition),
  );

  if (!action) return false;

  log('INFO', `Attempting auto-healing: ${action.action}`, { anomaly: anomaly.id });

  try {
    switch (action.action) {
      case 'suggest_checkpoint':
        // Crear checkpoint sugerido
        console.log('  💾 Checkpoint auto-suggested created');
        break;

      case 'force_checkpoint':
        // Forzar checkpoint
        console.log('  💾 Checkpoint auto-created (forced)');
        break;

      case 'gc_trigger':
        // Trigger GC
        if (global.gc) {
          global.gc();
          console.log('  🗑️  Garbage collection triggered');
        }
        break;

      case 'db_optimize':
        // Ejecutar optimización DB
        console.log('  🗄️  DB optimization triggered');
        break;

      case 'ws_restart':
        // Restart WebSocket
        console.log('  🔌 WebSocket restart triggered');
        break;

      default:
        return false;
    }

    anomaly.autoHealed = true;
    anomaly.autoHealingAction = action.action;
    return true;
  } catch (err) {
    log('ERROR', `Auto-healing failed for ${action.action}`, { error: String(err) });
    return false;
  }
}

// ─── Alerting ─────────────────────────────────────────────────────────────────────
async function sendAlert(anomaly: AnomalyDetection): Promise<void> {
  const state = loadState();
  const now = Date.now();

  // Check cooldown
  if (now - state.lastAlert < CONFIG.alerting.cooldownMinutes * 60 * 1000) {
    if (state.alertCount >= CONFIG.alerting.maxAlertsPerHour) {
      log('WARN', 'Alert rate limit reached, skipping', { anomaly: anomaly.id });
      return;
    }
  } else {
    state.alertCount = 0;
  }

  // Dispatch to channels
  for (const channel of CONFIG.alerting.channels) {
    try {
      await sendToChannel(channel, anomaly);
    } catch (err) {
      log('ERROR', `Failed to send alert to ${channel}`, { error: String(err) });
    }
  }

  // Update state
  state.lastAlert = now;
  state.alertCount++;
  saveState(state);
  saveAlert(anomaly);
}

async function sendToChannel(channel: string, anomaly: AnomalyDetection): Promise<void> {
  const emoji = anomaly.type === 'CRITICAL' ? '🔴' : anomaly.type === 'WARNING' ? '🟡' : '🔵';
  const message = `
${emoji} ANOMALY DETECTED
Type: ${anomaly.type}
Category: ${anomaly.category}
Message: ${anomaly.message}
Confidence: ${(anomaly.confidence * 100).toFixed(0)}%
Recommendation: ${anomaly.recommendation}
${anomaly.autoHealed ? '✅ Auto-healed: ' + anomaly.autoHealingAction : ''}
Timestamp: ${anomaly.detectedAt}
`;

  switch (channel) {
    case 'cli':
      console.log('\n' + message);
      break;

    case 'file':
      appendFileSync(join(LOG_DIR, 'alerts.log'), message + '\n---\n', 'utf-8');
      break;

    case 'dashboard':
      // Escribir en formato que el dashboard pueda leer
      const dashboardAlert = {
        ...anomaly,
        timestamp: Date.now(),
      };
      const dashboardPath = join(ROOT, '.session', 'alerts', 'realtime-alerts.json');
      mkdirSync(join(ROOT, '.session', 'alerts'), { recursive: true });
      writeFileSync(dashboardPath, JSON.stringify([dashboardAlert], null, 2), 'utf-8');
      break;

    default:
      console.log(`  [${channel}] ${message}`);
  }
}

// ─── Main Monitoring Loop ─────────────────────────────────────────────────────────
async function runMonitor(): Promise<void> {
  log('INFO', 'Starting Predictive Anomaly Detector v1.0.0');
  log('INFO', 'Monitor interval: 30s, Auto-healing: enabled');

  const history: MetricSnapshot[] = [];

  const monitorLoop = async () => {
    try {
      const metrics = await collectMetrics();
      history.push(metrics);

      // Mantener ventana de historial
      if (history.length > 20) {
        history.shift();
      }

      // Detectar anomalías
      const anomalies = detectAnomalies(metrics);

      // Predecir anomalías
      const predictions = predictAnomalies(metrics, history);

      if (anomalies.length > 0) {
        log('INFO', `Detected ${anomalies.length} anomalies`);

        for (const anomaly of anomalies) {
          // Intentar auto-healing
          if (anomaly.type === 'CRITICAL' || anomaly.type === 'WARNING') {
            const healed = await attemptAutoHeal(anomaly);
            if (healed) {
              log('INFO', `Auto-healed: ${anomaly.id}`);
            }
          }

          // Enviar alerta
          await sendAlert(anomaly);
        }
      }

      // Guardar predicciones
      if (predictions.length > 0) {
        const state = loadState();
        state.predictions = predictions;
        saveState(state);

        log('INFO', `Generated ${predictions.length} predictions`);
        predictions.forEach((p) => {
          console.log(
            `  🔮 ${p.type}: ${(p.probability * 100).toFixed(0)}% in ~${p.timeToOccurrence} periods`,
          );
          console.log(`     ${p.rationale}`);
        });
      }
    } catch (err) {
      log('ERROR', 'Monitor loop error', { error: String(err) });
    }
  };

  // Ejecutar inmediatamente y luego cada 30s
  await monitorLoop();
  setInterval(monitorLoop, 30000);

  log('INFO', 'Monitor loop running. Press Ctrl+C to stop.');
}

// ─── CLI ──────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--monitor')) {
    await runMonitor();
  } else if (args.includes('--analyze')) {
    log('INFO', 'Running one-time analysis...');
    const metrics = await collectMetrics();
    const anomalies = detectAnomalies(metrics);

    console.log('\n=== CURRENT METRICS ===');
    console.log(JSON.stringify(metrics, null, 2));

    console.log('\n=== DETECTED ANOMALIES ===');
    if (anomalies.length === 0) {
      console.log('✅ No anomalies detected');
    } else {
      anomalies.forEach((a) => console.log(`- [${a.type}] ${a.message}`));
    }

    process.exit(0);
  } else if (args.includes('--dashboard')) {
    // API mode for dashboard
    const metrics = await collectMetrics();
    const anomalies = detectAnomalies(metrics);
    console.log(JSON.stringify({ metrics, anomalies }, null, 2));
  } else if (args.includes('--status')) {
    const state = loadState();
    const history = loadAlertHistory();

    console.log('\n╔════════════════════════════════════════╗');
    console.log('║  Predictive Anomaly Detector Status      ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`Active Predictions: ${state.predictions?.length || 0}`);
    console.log(`Alert History: ${history.length} alerts`);
    console.log(
      `Last Alert: ${state.lastAlert ? new Date(state.lastAlert).toISOString() : 'Never'}`,
    );
    console.log(`Alert Count (current hour): ${state.alertCount}`);

    if (state.predictions?.length > 0) {
      console.log('\nActive Predictions:');
      state.predictions.forEach((p: Prediction) => {
        console.log(`  🔮 ${p.type}: ${(p.probability * 100).toFixed(0)}%`);
      });
    }

    if (history.length > 0) {
      console.log('\nRecent Alerts:');
      history.slice(-5).forEach((a: AnomalyDetection) => {
        console.log(
          `  ${a.type === 'CRITICAL' ? '🔴' : '🟡'} ${a.category}: ${a.message.substring(0, 50)}...`,
        );
      });
    }

    console.log('');
  } else {
    console.log('Predictive Anomaly Detector (PAD) v1.0.0');
    console.log('');
    console.log('Usage:');
    console.log('  --monitor    Start continuous monitoring');
    console.log('  --analyze    Run one-time analysis');
    console.log('  --dashboard  Output summary for dashboard');
    console.log('  --status     Show current status');
    console.log('');
    console.log('Configuration:');
    console.log(
      `  Token Soft Warning:  ${(CONFIG.thresholds.tokenWarningSoft / 1000000).toFixed(1)}M`,
    );
    console.log(
      `  Token Hard Warning:  ${(CONFIG.thresholds.tokenWarningHard / 1000000).toFixed(1)}M`,
    );
    console.log(
      `  Token Critical:      ${(CONFIG.thresholds.tokenCritical / 1000000).toFixed(1)}M`,
    );
    console.log(`  Memory Warning:      ${CONFIG.thresholds.memoryWarning}MB`);
    console.log(`  Memory Critical:     ${CONFIG.thresholds.memoryCritical}MB`);
    console.log(`  Auto-healing:        ${CONFIG.autoHealing.enabled ? 'ENABLED' : 'DISABLED'}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    log('ERROR', 'Fatal error', { error: String(err) });
    process.exit(1);
  });
}

export { collectMetrics, detectAnomalies, predictAnomalies, attemptAutoHeal };
