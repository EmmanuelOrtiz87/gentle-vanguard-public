#!/usr/bin/env node
/**
 * task-wrapper.ts - Wrapper inteligente para delegación con auto-fallback
 *
 * REEMPLAZA el uso de la herramienta `task` de opencode.
 * En lugar de:
 *   task({ agent: 'sdd-explore', prompt: '...' })
 *
 * Usar:
 *   await smartTask({ agent: 'sdd-explore', prompt: '...' })
 *
 * Este wrapper:
 * 1._detecta automáticamente el modelo disponible
 * 2. Intenta fallback si falla
 * 3. NO modifica archivos de configuración estáticos
 * 4. Persiste el modelo funcional en runtime
 *
 * USO DIRECTO (desde orquestador):
 *   import { smartTask } from './task-wrapper.js';
 *
 *   const result = await smartTask({
 *     agent: 'sdd-explore',
 *     prompt: 'Analyze requirements...',
 *   });
 *
 * El resultado incluye toda la metadata de ejecución.
 */

import { intelligentDelegate, getDelegatorStatus } from './intelligent-delegator.js';

// Re-exportar para compatibilidad (solo getDelegatorStatus; smartTask se define abajo)
export { getDelegatorStatus };

// Alias para compatibilidad con código existente
export const smartDelegate = intelligentDelegate;

/**
 * Versión simplificada que emula la interfaz de `task` de opencode
 * pero con fallback automático
 */
export interface SmartTaskRequest {
  /** Tipo de agente/subagente */
  agent?: string;
  subagent_type?: string;
  /** Descripción de la tarea */
  prompt?: string;
  task?: string;
  /** Contexto adicional */
  context?: string;
  /** Número de steps máximo */
  max_steps?: number;
  /** Continuar sesión previa */
  task_id?: string;
}

export interface SmartTaskResult {
  success: boolean;
  output?: string;
  error?: string;
  model: string;
  provider: string;
  attempts: number;
  fallbackUsed: boolean;
  duration: number;
  modelsTried: string[];
  executionLog: string[];
}

/**
 * Función principal que REEMPLAZA la herramienta `task` de opencode
 *
 * Detecta automáticamente qué modelo usar basándose en:
 * - Disponibilidad actual
 * - Historial de éxitos
 * - Tipo de agente
 * - Fallback chain configurada
 */
export async function smartTask(request: SmartTaskRequest): Promise<SmartTaskResult> {
  // Normalizar el agente (puede venir como agent o subagent_type)
  const agentName = request.agent ||
    (request.subagent_type === 'explore' ? 'sdd-explore' :
      request.subagent_type === 'design' ? 'sdd-design' :
        request.subagent_type === 'apply' ? 'sdd-apply' :
          request.subagent_type === 'verify' ? 'sdd-verify' :
            request.subagent_type) ||
    'general';

  // Normalizar el prompt/task
  const task = request.prompt || request.task || '';

  // Usar el intelligent delegator
  const result = await intelligentDelegate({
    agent: agentName,
    task: task,
    context: request.context,
  });

  return {
    success: result.success,
    output: result.output,
    error: result.error,
    model: result.model,
    provider: result.provider,
    attempts: result.attempts,
    fallbackUsed: result.fallbackUsed,
    duration: result.duration,
    modelsTried: result.modelsTried,
    executionLog: result.executionLog,
  };
}

/**
 * CLI para testing
 */
function cli(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'test': {
      const agent = args[args.indexOf('--agent') + 1] || 'sdd-explore';
      const task = args[args.indexOf('--task') + 1] || 'Test delegation';

      console.log(`Testing smart delegation with agent: ${agent}`);
      console.log(`Task: ${task}`);
      console.log('');

      void (async () => {
        const result = await smartTask({ agent, task });
        console.log('Result:', JSON.stringify(result, null, 2));
      })();
      break;
    }

    case 'status': {
      const status = getDelegatorStatus();
      console.log('Smart Task Wrapper Status:');
      console.log(JSON.stringify(status, null, 2));
      break;
    }

    default:
      console.log(`
smart-task-wrapper v1.0

Usage:
  test --agent <name> --task "<desc>"
    Test smart delegation

  status
    Show delegator status

This wrapper replaces the opencode 'task' tool with automatic model fallback.
`);
  }
}

// Run CLI if executed directly
import { pathToFileURL } from 'url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli();
}
