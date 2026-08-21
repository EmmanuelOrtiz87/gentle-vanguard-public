/**
 * operational-metrics-tracker.ts — Métricas operacionales reales del stack
 *
 * MÉTRICAS TRACKEADAS:
 * - Velocidad: commits/hora, archivos/modificados, líneas de código
 * - Eficiencia: latencia de tools, tasa de éxito, tiempo de respuesta
 * - Productividad: skills usados, tareas completadas, agentes activos
 * - Calidad: builds exitosos, tests pasados, errores detectados
 *
 * NOTA: No trackeamos tokens/costos porque OpenCode no expone esa API.
 * En su lugar, medimos PRODUCTIVIDAD REAL del desarrollo.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ROOT } from './repo-root';

// ─── Configuration ───────────────────────────────────────────────────────

const METRICS_DIR = path.join(ROOT, '.runtime', 'operational-metrics');
const OPERATIONS_LOG = path.join(METRICS_DIR, 'operations.jsonl');
const CORRECTIONS_LOG = path.join(ROOT, '.session', 'correction-engine.log');

// ─── Types ─────────────────────────────────────────────────────────────────

export interface OperationEvent {
  timestamp: string;
  sessionId: string;
  type: 'tool' | 'skill' | 'agent' | 'build' | 'test' | 'git';
  name: string;
  durationMs: number;
  success: boolean;
  metadata?: Record<string, unknown>;
}

export interface VelocityMetrics {
  commitsPerHour: number;
  filesModifiedPerSession: number;
  linesAdded: number;
  linesDeleted: number;
  avgTimeBetweenCommits: number;
}

export interface EfficiencyMetrics {
  avgToolLatency: number;
  successRate: number;
  fastestTool: string;
  slowestTool: string;
  responseTimeP95: number;
}

export interface ProductivityMetrics {
  skillsUsed: number;
  uniqueSkills: string[];
  agentsActive: number;
  tasksCompleted: number;
  sessionsCompleted: number;
}

export interface QualityMetrics {
  buildSuccessRate: number;
  testPassRate: number;
  errorsDetected: number;
  autoCorrections: number;
  typeCheckFailures: number;
}

export interface DailyMetrics {
  date: string;
  velocity: VelocityMetrics;
  efficiency: EfficiencyMetrics;
  productivity: ProductivityMetrics;
  quality: QualityMetrics;
  totalOperations: number;
  lastUpdated: string;
}

// ─── Core Tracker ──────────────────────────────────────────────────────────

export class OperationalMetricsTracker {
  private sessionId: string;
  private operationStartTime: Map<string, number> = new Map();

  constructor(sessionId?: string) {
    this.sessionId = sessionId || `ops-${Date.now()}`;
    this.ensureMetricsDir();
  }

  private ensureMetricsDir(): void {
    if (!fs.existsSync(METRICS_DIR)) {
      fs.mkdirSync(METRICS_DIR, { recursive: true });
    }
  }

  /**
   * Iniciar tracking de una operación
   */
  startOperation(name: string): void {
    this.operationStartTime.set(name, Date.now());
  }

  /**
   * Finalizar tracking de una operación
   */
  endOperation(
    name: string,
    type: OperationEvent['type'],
    success: boolean,
    metadata?: Record<string, unknown>,
  ): void {
    const startTime = this.operationStartTime.get(name);
    const durationMs = startTime ? Date.now() - startTime : 0;

    const event: OperationEvent = {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      type,
      name,
      durationMs,
      success,
      metadata,
    };

    this.logEvent(event);
    this.operationStartTime.delete(name);
  }

  /**
   * Loguear evento a archivo
   */
  private logEvent(event: OperationEvent): void {
    const line = JSON.stringify(event) + '\n';
    fs.appendFileSync(OPERATIONS_LOG, line, 'utf-8');
  }

  /**
   * Trackear uso de tool con tiempo automático
   */
  trackTool(toolName: string): (success?: boolean, metadata?: Record<string, unknown>) => void {
    this.startOperation(`tool:${toolName}`);

    return (success = true, metadata?: Record<string, unknown>) => {
      this.endOperation(`tool:${toolName}`, 'tool', success, metadata);
    };
  }

  /**
   * Trackear uso de skill
   */
  trackSkill(skillName: string): void {
    this.endOperation(`skill:${skillName}`, 'skill', true, { skill: skillName });
  }

  /**
   * Trackear agent execution
   */
  trackAgent(agentName: string, durationMs: number, success: boolean): void {
    this.endOperation(`agent:${agentName}`, 'agent', success, { durationMs });
  }

  /**
   * Trackear build (checkType opcional: 'typecheck' | 'lint' | 'build')
   */
  trackBuild(
    success: boolean,
    durationMs: number,
    checkType: 'typecheck' | 'lint' | 'build' = 'build',
  ): void {
    this.endOperation('build', 'build', success, { durationMs, checkType });
  }

  /**
   * Trackear test run
   */
  trackTest(success: boolean, testCount: number, failedCount: number): void {
    this.endOperation('test', 'test', success, { testCount, failedCount });
  }

  /**
   * Trackear git commit
   */
  trackCommit(filesChanged: number, linesAdded: number, linesDeleted: number): void {
    this.endOperation('commit', 'git', true, {
      filesChanged,
      linesAdded,
      linesDeleted,
    });
  }

  // ─── Analytics ────────────────────────────────────────────────────────────

  /**
   * Obtener métricas del día actual
   */
  static getTodayMetrics(): DailyMetrics | null {
    const today = new Date().toISOString().slice(0, 10);
    const summaryPath = path.join(METRICS_DIR, `metrics-${today}.json`);

    if (fs.existsSync(summaryPath)) {
      return JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    }
    return null;
  }

  /**
   * Calcular métricas desde operaciones logueadas
   */
  static calculateMetrics(fromDate?: string, toDate?: string): DailyMetrics {
    const events = this.loadEvents(fromDate, toDate);

    // Velocity
    const gitEvents = events.filter((e) => e.type === 'git');
    const commits = gitEvents.length;
    const linesAdded = gitEvents.reduce(
      (sum, e) => sum + ((e.metadata?.linesAdded as number) || 0),
      0,
    );
    const linesDeleted = gitEvents.reduce(
      (sum, e) => sum + ((e.metadata?.linesDeleted as number) || 0),
      0,
    );
    const avgTimeBetweenCommits = calculateAvgTimeBetween(gitEvents);

    // Efficiency
    const toolEvents = events.filter((e) => e.type === 'tool');
    const avgToolLatency =
      toolEvents.reduce((sum, e) => sum + e.durationMs, 0) / toolEvents.length || 0;
    const successRate = (events.filter((e) => e.success).length / events.length) * 100 || 100;
    const responseTimeP95 = calculateP95(toolEvents.map((e) => e.durationMs));

    // Productivity
    const skillEvents = events.filter((e) => e.type === 'skill');
    const uniqueSkills = Array.from(new Set(skillEvents.map((e) => e.name)));
    const agentEvents = events.filter((e) => e.type === 'agent');

    // Quality
    const buildEvents = events.filter((e) => e.type === 'build');
    const buildSuccessRate =
      (buildEvents.filter((e) => e.success).length / buildEvents.length) * 100 || 100;
    const testEvents = events.filter((e) => e.type === 'test');
    const testPassRate =
      (testEvents.filter((e) => e.success).length / testEvents.length) * 100 || 100;

    return {
      date: fromDate || new Date().toISOString().slice(0, 10),
      velocity: {
        commitsPerHour: commits / 24,
        filesModifiedPerSession: linesAdded > 0 ? linesAdded / 50 : 0, // Aprox
        linesAdded,
        linesDeleted,
        avgTimeBetweenCommits,
      },
      efficiency: {
        avgToolLatency,
        successRate,
        fastestTool: getFastestTool(toolEvents),
        slowestTool: getSlowestTool(toolEvents),
        responseTimeP95,
      },
      productivity: {
        skillsUsed: skillEvents.length,
        uniqueSkills,
        agentsActive: agentEvents.length,
        tasksCompleted: events.filter((e) => e.type === 'skill' && e.success).length,
        sessionsCompleted: Array.from(new Set(events.map((e) => e.sessionId))).length,
      },
      quality: {
        buildSuccessRate,
        testPassRate,
        errorsDetected: events.filter((e) => !e.success).length,
        autoCorrections: countAutoCorrections(fromDate, toDate),
        typeCheckFailures: events.filter(
          (e) => e.type === 'build' && !e.success && e.metadata?.checkType === 'typecheck',
        ).length,
      },
      totalOperations: events.length,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Cargar eventos desde archivo
   */
  private static loadEvents(fromDate?: string, toDate?: string): OperationEvent[] {
    if (!fs.existsSync(OPERATIONS_LOG)) {
      return [];
    }

    const content = fs.readFileSync(OPERATIONS_LOG, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim());

    return lines
      .map((line) => {
        try {
          return JSON.parse(line) as OperationEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is OperationEvent => e !== null)
      .filter((e) => {
        if (fromDate && e.timestamp < fromDate) return false;
        if (toDate && e.timestamp > toDate) return false;
        return true;
      });
  }
}

// ─── Helper Functions ────────────────────────────────────────────────────

/**
 * Cuenta correcciones realmente ejecutadas desde el log del correction-rules-engine.
 * Excluye líneas de evaluación (checking/loaded/no rules triggered) — solo cuenta
 * correcciones aplicadas (Executing/Completed/applied/triggered with action).
 */
function countAutoCorrections(fromDate?: string, toDate?: string): number {
  if (!fs.existsSync(CORRECTIONS_LOG)) return 0;
  try {
    const content = fs.readFileSync(CORRECTIONS_LOG, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim());
    let count = 0;

    for (const line of lines) {
      // Normalizar timestamp: [YYYY-MM-DD HH:MM:SS] ...
      const tsMatch = line.match(/\[(\d{4}-\d{2}-\d{2})/);
      if (tsMatch) {
        const date = tsMatch[1];
        if (fromDate && date < fromDate) continue;
        if (toDate && date > toDate) continue;
      }

      // Líneas de evaluación NO cuentan como correcciones
      if (
        /Checking which rules|Loaded \d+ correction rules|No rules triggered|Sweep already escalated/.test(
          line,
        )
      ) {
        continue;
      }

      // Líneas que indican corrección ejecutada/aplicada
      if (
        /Executing auto-corrections|Completed \d+ corrections|Rule .* triggered|CORRECTED|Applied correction/.test(
          line,
        )
      ) {
        count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

function calculateAvgTimeBetween(events: OperationEvent[]): number {
  if (events.length < 2) return 0;
  const timestamps = events.map((e) => new Date(e.timestamp).getTime()).sort((a, b) => a - b);
  let totalDiff = 0;
  for (let i = 1; i < timestamps.length; i++) {
    totalDiff += timestamps[i] - timestamps[i - 1];
  }
  return totalDiff / (timestamps.length - 1);
}

function calculateP95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor(sorted.length * 0.95);
  return sorted[index];
}

function getFastestTool(events: OperationEvent[]): string {
  if (events.length === 0) return 'N/A';
  const validEvents = events.filter((e) => e.durationMs && e.durationMs > 0);
  if (validEvents.length === 0) return 'N/A';
  const fastest = validEvents.reduce(
    (min, e) => (e.durationMs < min.durationMs ? e : min),
    validEvents[0],
  );
  return fastest ? fastest.name.replace('tool:', '') : 'N/A';
}

function getSlowestTool(events: OperationEvent[]): string {
  if (events.length === 0) return 'N/A';
  const validEvents = events.filter((e) => e.durationMs && e.durationMs > 0);
  if (validEvents.length === 0) return 'N/A';
  const slowest = validEvents.reduce(
    (max, e) => (e.durationMs > max.durationMs ? e : max),
    validEvents[0],
  );
  return slowest ? slowest.name.replace('tool:', '') : 'N/A';
}

// ─── Convenience Exports ─────────────────────────────────────────────────

export const tracker = new OperationalMetricsTracker();

/**
 * Wrapper para trackear cualquier función
 */
export function track<T>(name: string, type: OperationEvent['type'], fn: () => T): T {
  tracker.startOperation(name);
  const startTime = Date.now();
  try {
    const result = fn();
    tracker.endOperation(name, type, true, { durationMs: Date.now() - startTime });
    return result;
  } catch (error) {
    tracker.endOperation(name, type, false, { error: String(error) });
    throw error;
  }
}

/**
 * Decorator async para tracking
 */
export async function trackAsync<T>(
  name: string,
  type: OperationEvent['type'],
  fn: () => Promise<T>,
): Promise<T> {
  tracker.startOperation(name);
  const startTime = Date.now();
  try {
    const result = await fn();
    tracker.endOperation(name, type, true, { durationMs: Date.now() - startTime });
    return result;
  } catch (error) {
    tracker.endOperation(name, type, false, { error: String(error) });
    throw error;
  }
}

// ─── CLI Testing ───────────────────────────────────────────────────────────

// Testing cuando se ejecuta directamente
const isMainModule = process.argv[1] && process.argv[1].includes('operational-metrics-tracker');

if (isMainModule) {
  console.log('[OperationalMetricsTracker] Testing...');

  const testTracker = new OperationalMetricsTracker('test-session');

  const endTool1 = testTracker.trackTool('read');
  endTool1(true);

  const endTool2 = testTracker.trackTool('edit');
  endTool2(true, { linesChanged: 10 });

  testTracker.trackSkill('test-driven-development');

  console.log('Operaciones trackeadas. Ver .runtime/operational-metrics/');

  const metrics = OperationalMetricsTracker.calculateMetrics();
  console.log('Métricas calculadas:', JSON.stringify(metrics, null, 2));
}
