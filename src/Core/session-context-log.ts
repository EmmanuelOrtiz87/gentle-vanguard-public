/**
 * session-context-log.ts — Módulo compartido para persistencia de datos de sesión
 *
 * PROPÓSITO: Unificar el sistema de almacenamiento de datos de sesión entre
 * el pipeline de ejecución y el dashboard de observabilidad.
 *
 * ARQUITECTURA:
 *   - El pipeline guarda datos aquí (session-cleanup-start, etc.)
 *   - El dashboard lee datos de aquí (MetricsWriter, real-data.ts)
 *   - Formato estandarizado: .session/context-log/<session-id>/.state.json
 *
 * ESTRUCTURA DE DATOS (.state.json):
 *   {
 *     sessionId: string,
 *     agent: string,
 *     status: 'active' | 'completed' | 'idle',
 *     createdAt: string (ISO),
 *     updatedAt: string (ISO),
 *     totalTokens: number,
 *     totalCost: number,
 *     messageCount: number,
 *     turns: Array<{ inputTokens: number, outputTokens: number }>
 *   }
 *
 * USO en pipeline:
 *   import { SessionContextLog } from './session-context-log';
 *   const log = new SessionContextLog(sessionData);
 *   log.save();
 *
 * USO en dashboard:
 *   import { listSessions, readSession } from './session-context-log';
 *   const sessions = listSessions();
 *   const data = readSession('session-id');
 */

import * as fs from 'fs';
import { pathToFileURL } from 'url';
import * as path from 'path';
import { ROOT } from './repo-root';

// ─── Paths ───────────────────────────────────────────────────────────────

const CONTEXT_LOG_DIR = path.join(ROOT, '.session', 'context-log');

// ─── Types ───────────────────────────────────────────────────────────────

export interface SessionTurn {
  inputTokens?: number;
  outputTokens?: number;
  timestamp?: string;
  message?: string;
  inputSummary?: string;
  outputSummary?: string;
  toolCalls?: string;
}

export interface SessionState {
  sessionId: string;
  agent: string;
  status: 'active' | 'completed' | 'idle' | 'error';
  createdAt: string;
  updatedAt: string;
  totalTokens: number;
  totalCost: number;
  messageCount: number;
  turns: SessionTurn[];
  metadata?: Record<string, unknown>;
}

// ─── Core Functions ───────────────────────────────────────────────────────

/**
 * Asegura que exista el directorio context-log
 */
function ensureContextLogDir(): void {
  if (!fs.existsSync(CONTEXT_LOG_DIR)) {
    fs.mkdirSync(CONTEXT_LOG_DIR, { recursive: true });
  }
}

/**
 * Obtiene el path al .state.json de una sesión
 */
function getStatePath(sessionId: string): string {
  const sessionDir = path.join(CONTEXT_LOG_DIR, sessionId);
  return path.join(sessionDir, '.state.json');
}

/**
 * Guarda el estado de una sesión en context-log
 */
export function saveSessionState(state: SessionState): void {
  ensureContextLogDir();

  const statePath = getStatePath(state.sessionId);
  const sessionDir = path.dirname(statePath);

  // Crear directorio de sesión si no existe
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  // Guardar estado
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');

  console.log(`[SessionContextLog] Saved: ${state.sessionId}`);
}

/**
 * Lee el estado de una sesión desde context-log
 */
export function readSessionState(sessionId: string): SessionState | null {
  const statePath = getStatePath(sessionId);

  if (!fs.existsSync(statePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(statePath, 'utf-8');
    return JSON.parse(content) as SessionState;
  } catch (err) {
    console.error(`[SessionContextLog] Error reading ${sessionId}:`, err);
    return null;
  }
}

/**
 * Lista todas las sesiones disponibles en context-log
 */
export function listSessions(): string[] {
  if (!fs.existsSync(CONTEXT_LOG_DIR)) {
    return [];
  }

  try {
    const entries = fs.readdirSync(CONTEXT_LOG_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => {
        // Verificar que tenga un .state.json válido
        const statePath = path.join(CONTEXT_LOG_DIR, name, '.state.json');
        return fs.existsSync(statePath);
      });
  } catch (err) {
    console.error('[SessionContextLog] Error listing sessions:', err);
    return [];
  }
}

/**
 * Obtiene todos los estados de sesión (para MetricsWriter)
 */
export function getAllSessionStates(): SessionState[] {
  const sessionIds = listSessions();
  return sessionIds.map((id) => readSessionState(id)).filter((s): s is SessionState => s !== null);
}

/**
 * Obtiene métricas agregadas de todas las sesiones
 */
export function getAggregatedMetrics(): {
  totalSessions: number;
  activeSessions: number;
  totalTokens: number;
  totalCost: number;
  totalMessages: number;
} {
  const sessions = getAllSessionStates();

  return {
    totalSessions: sessions.length,
    activeSessions: sessions.filter((s) => s.status === 'active').length,
    totalTokens: sessions.reduce((sum, s) => sum + (s.totalTokens || 0), 0),
    totalCost: sessions.reduce((sum, s) => sum + (s.totalCost || 0), 0),
    totalMessages: sessions.reduce((sum, s) => sum + (s.messageCount || 0), 0),
  };
}

// ─── Class Wrapper (para uso orientado a objetos) ─────────────────────────

export class SessionContextLog {
  private state: SessionState;

  constructor(initialState: Partial<SessionState> = {}) {
    const now = new Date().toISOString();
    this.state = {
      sessionId: initialState.sessionId || `sess-${Date.now()}`,
      agent: initialState.agent || 'unknown',
      status: initialState.status || 'active',
      createdAt: initialState.createdAt || now,
      updatedAt: now,
      totalTokens: initialState.totalTokens || 0,
      totalCost: initialState.totalCost || 0,
      messageCount: initialState.messageCount || 0,
      turns: initialState.turns || [],
      metadata: initialState.metadata || {},
    };
  }

  update(updates: Partial<SessionState>): void {
    this.state = {
      ...this.state,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
  }

  addTurn(turn: SessionTurn): void {
    this.state.turns.push(turn);
    this.state.messageCount++;
    this.state.totalTokens += (turn.inputTokens || 0) + (turn.outputTokens || 0);
    this.state.updatedAt = new Date().toISOString();
  }

  save(): void {
    saveSessionState(this.state);
  }

  getState(): SessionState {
    return { ...this.state };
  }
}

// ─── CLI para testing ────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('[SessionContextLog] Testing...');

  // Test write
  const log = new SessionContextLog({
    sessionId: 'test-session',
    agent: 'TEST',
    status: 'active',
  });
  log.save();
  console.log('[SessionContextLog] Test session saved');

  // Test read
  const sessions = listSessions();
  console.log('[SessionContextLog] Sessions:', sessions);

  // Test aggregated
  const metrics = getAggregatedMetrics();
  console.log('[SessionContextLog] Metrics:', metrics);
}
