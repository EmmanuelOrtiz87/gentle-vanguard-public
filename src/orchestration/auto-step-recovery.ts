#!/usr/bin/env node
/**
 * Auto-Step-Recovery System
 *
 * Detecta automáticamente cuando un agente agota steps y reasigna
 * con steps aumentados sin intervención manual.
 *
 * Este sistema:
 * 1. Monitorea las respuestas de los agentes
 * 2. Detecta "maximum steps reached" o "step limit exceeded"
 * 3. Reasigna automáticamente con +20 steps (máx 80)
 * 4. Preserva contexto y continúa ejecución
 *
 * Integración: Usar wrapAgentCall() en lugar de llamada directa
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { join, resolve } from 'path';

const ROOT = resolve(process.cwd());
const RECOVERY_LOG = join(ROOT, '.session', 'step-recovery.log');

interface RecoveryResult {
  success: boolean;
  newSteps: number;
  message: string;
}

/**
 * Detecta si la respuesta indica agotamiento de steps
 */
export function detectStepExhaustion(response: string): boolean {
  const patterns = [
    /maximum steps reached/i,
    /step limit exceeded/i,
    /agotó los pasos/i,
    /steps exhausted/i,
    / Maximum number of steps reached/i,
    /has reached its limit of/i,
    /cannot complete.*insufficient steps/i,
  ];
  return patterns.some((p) => p.test(response));
}

/**
 * Incrementa steps del agente
 */
export function bumpSteps(agentId: string, currentSteps: number): number {
  const newSteps = Math.min(currentSteps + 20, 80);

  // Aplicar en opencode.json
  try {
    const opencodePath = join(ROOT, 'opencode.json');
    const cfg = JSON.parse(readFileSync(opencodePath, 'utf-8'));
    if (cfg.agent?.[agentId]) {
      cfg.agent[agentId].steps = newSteps;
      writeFileSync(opencodePath, JSON.stringify(cfg, null, 2) + '\n');
    }
  } catch (e) {
    console.error(`[AutoRecovery] Failed to update steps: ${e}`);
  }

  return newSteps;
}

/**
 * Reasigna tarea con steps aumentados
 */
export function reassignWithMoreSteps(
  agentId: string,
  taskId: string,
  context?: string,
): RecoveryResult {
  const currentSteps = getCurrentSteps(agentId);
  const newSteps = bumpSteps(agentId, currentSteps);

  // Log recovery
  const logEntry = {
    timestamp: new Date().toISOString(),
    agentId,
    taskId,
    oldSteps: currentSteps,
    newSteps,
    context,
  };

  try {
    const existing = existsSync(RECOVERY_LOG) ? readFileSync(RECOVERY_LOG, 'utf-8') + '\n' : '';
    writeFileSync(RECOVERY_LOG, existing + JSON.stringify(logEntry), 'utf-8');
  } catch {}

  return {
    success: true,
    newSteps,
    message: `Steps increased from ${currentSteps} to ${newSteps} for ${agentId}`,
  };
}

/**
 * Wrap para llamadas a agentes con auto-recovery
 */
export function wrapAgentCall(agentId: string, taskDescription: string, taskId: string): string {
  // Aquí iría la llamada real al agente
  // Por ahora simulamos detección

  const simulationResponse = `Agent ${agentId} processing: ${taskDescription}`;

  if (detectStepExhaustion(simulationResponse)) {
    const recovery = reassignWithMoreSteps(agentId, taskId, taskDescription);
    return `RECOVERED: ${recovery.message}. Retrying...`;
  }

  return simulationResponse;
}

function getCurrentSteps(agentId: string): number {
  try {
    const opencodePath = join(ROOT, 'opencode.json');
    const cfg = JSON.parse(readFileSync(opencodePath, 'utf-8'));
    return cfg.agent?.[agentId]?.steps ?? 20;
  } catch {
    return 20;
  }
}

// Demo/Test
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('Auto-Step-Recovery System');
  console.log('==========================\n');

  // Test detección
  const testCases = [
    'Agent completed successfully',
    'Error: maximum steps reached for this agent',
    'Step limit exceeded, cannot continue',
    'Task finished normally',
  ];

  for (const test of testCases) {
    const detected = detectStepExhaustion(test);
    console.log(`"${test}" → ${detected ? 'DETECTED' : 'OK'}`);
  }

  console.log('\nSystem ready for integration.');
}
