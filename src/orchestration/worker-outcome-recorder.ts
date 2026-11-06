/**
 * Worker Outcome Recorder — aprendizaje y observabilidad por worker del swarm.
 *
 * GAP cerrado: los workers del team-orchestrator terminaban sin dejar rastro
 * en Nexus ni en el message bus — el routing adaptativo se alimentaba de
 * skill_execution_outcomes escasamente poblado, no había correlación
 * trace↔worker y el bus de agentes no recibía nada del swarm.
 *
 * Por cada worker que termina registra (todo best-effort, NUNCA rompe el swarm):
 *  1. skill_execution_outcomes — alimenta el adaptive router (collect.ts).
 *  2. error_memory — en fallos, para reuso por archivo/patrón.
 *  3. traces — span por worker correlacionado por session_id = run id
 *     (visible en el dashboard Tracing con estado y duración reales).
 *  4. agent-message-bus — broadcast del ciclo de vida al log del bus
 *     (.event-bus/agent-messages.jsonl, mismo formato que el CLI).
 */

import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DatabaseManager } from '../database/nexus/manager.js';
import { busSend } from './agent-message-bus.js';

export interface WorkerOutcome {
  workerId: string;
  skill: string;
  status: 'completed' | 'failed' | 'timeout' | 'running';
  durationMs?: number;
  error?: string | null;
  outputChars?: number;
  runId?: string;
}

const ROOT = process.cwd();
const BUS_LOG = join(ROOT, '.event-bus', 'agent-messages.jsonl');

/** Append de un broadcast al log del message bus (formato compatible con el CLI). */
export function broadcastWorkerEvent(outcome: WorkerOutcome, event: string): void {
  try {
    const logDir = join(ROOT, '.event-bus');
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      message_id: `msg-${randomUUID().slice(0, 8)}`,
      sender: 'team-orchestrator',
      recipient: '*',
      subject: `worker_${event}`,
      type: 'broadcast',
      payload: {
        workerId: outcome.workerId,
        skill: outcome.skill,
        status: outcome.status,
        runId: outcome.runId ?? null,
      },
    });
    appendFileSync(BUS_LOG, entry + '\n', 'utf-8');
  } catch {
    /* best-effort */
  }
}

/** Registra el outcome completo de un worker (Nexus + bus). Fire-and-forget. */
export function recordWorkerOutcome(outcome: WorkerOutcome): void {
  const success = outcome.status === 'completed';
  try {
    const db = DatabaseManager.getInstance();
    const tenantId = 'gentle-vanguard';
    // 1) Outcome para el routing adaptativo (collect.ts lee success rate).
    db.skills.recordSkillOutcome(tenantId, outcome.skill, success, {
      sessionId: outcome.runId,
      durationMs: outcome.durationMs,
      tool: 'swarm-worker',
      detail:
        outcome.status === 'failed' || outcome.status === 'timeout'
          ? (outcome.error ?? outcome.status).slice(0, 500)
          : undefined,
      evidenceKind: 'production',
    });
    // 2) Error memory en fallos — reuso por patrón en delegaciones futuras.
    if (!success && (outcome.error || outcome.status === 'timeout')) {
      db.errors.saveErrorMemory({
        bug: `[swarm:${outcome.skill}] ${outcome.status}: ${(outcome.error ?? 'sin detalle').slice(0, 300)}`,
        rootCause: 'Fallo de worker del team-orchestrator (skill-router subprocess).',
        fix: 'pendiente — registrar el fix al resolver',
        pattern: outcome.skill,
        severity: outcome.status === 'timeout' ? 'high' : 'medium',
        sessionId: outcome.runId,
      });
    }
    // 3) Trace por worker — correlación trace↔worker visible en el dashboard.
    const now = Date.now();
    db.traces.insertTrace(tenantId, {
      span_id: outcome.workerId,
      trace_id: outcome.runId ?? outcome.workerId,
      name: `swarm:${outcome.skill}`,
      start_time: now - (outcome.durationMs ?? 0),
      end_time: now,
      duration: outcome.durationMs ?? 0,
      status: success ? 'completed' : 'error',
      session_id: outcome.runId,
      attributes: JSON.stringify({ kind: 'swarm-worker', skill: outcome.skill }),
    });
  } catch {
    /* Nexus no disponible: el bus igual registra */
  }
  // 4) Broadcast del ciclo de vida al bus + entrega al mailbox del leader
  // (peer-to-peer: los resultados del swarm quedan consultables vía
  // busPoll('swarm-leader') o el CLI list-mailbox).
  broadcastWorkerEvent(outcome, success ? 'completed' : 'failed');
  try {
    busSend({
      from: 'team-orchestrator',
      to: 'swarm-leader',
      subject: success ? 'worker_completed' : 'worker_failed',
      payload: outcome,
      type: 'event',
      priority: success ? 'low' : 'normal',
      ttlSeconds: 86_400,
    });
  } catch {
    /* best-effort */
  }
}
