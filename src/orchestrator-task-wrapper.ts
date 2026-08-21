#!/usr/bin/env node
/**
 * Orchestrator Task Wrapper - Drop-in replacement for task()
 *
 * Este módulo proporciona una función `task` compatible con OpenCode
 * pero con GGA (Guardian Angel) para switching automático de proveedores.
 *
 * Uso:
 *   // Cambiar de:
 *   import { task } from 'opencode';
 *
 *   // A:
 *   import { task } from '../orchestrator-task-wrapper.js';
 *
 *   // Luego usar normalmente:
 *   const result = await task({
 *     subagent_type: 'sdd-apply',
 *     prompt: 'implement feature',
 *     description: 'optional'
 *   });
 */

import { GuardianAngel } from './gga.js';
import type { GGADelegationOptions, GGADelegationResult } from './gga.js';

// =============================================================================
// TYPES - Compatibilidad con OpenCode task()
// =============================================================================

interface OpenCodeTaskOptions {
  subagent_type: string;
  prompt: string;
  description?: string;
}

interface OpenCodeTaskResult {
  success: boolean;
  output?: string;
  error?: string;
  model: string;
  fallbackUsed: boolean;
  attempts: number;
}

// =============================================================================
// WRAPPER PRINCIPAL
// =============================================================================

/**
 * Task wrapper con GGA fallback
 *
 * Compatible con la interfaz de OpenCode's task() pero con:
 * - Auto-detección de errores de cuota
 * - Fallback automático a proveedores alternativos
 * - Persistencia de estado
 * - Tracking de switches
 *
 * @param options - Opciones de delegación (compatibles con task())
 * @returns Promise<string> - Resultado de la delegación (o lanza error si falla)
 */
export async function task(options: OpenCodeTaskOptions): Promise<string> {
  // Convertir opciones de OpenCode a opciones de GGA
  const ggaOptions: GGADelegationOptions = {
    agent: options.subagent_type,
    task: options.prompt,
    // No especificamos preferredModel para que auto-detecte del orquestador
  };

  // Ejecutar con GGA
  const result: GGADelegationResult = await GuardianAngel(ggaOptions);

  if (result.success) {
    // Si usó fallback, loggear para debugging
    if (result.switchOccurred) {
      console.log(`[GGA] Task completed with fallback: ${result.originalModel} → ${result.model}`);
    }

    return result.output;
  }

  // Falló - lanzar error
  const errorMsg = result.error || 'Task failed without error message';
  const extraInfo = result.switchOccurred
    ? ` (tried ${result.attempts} providers, exhausted: ${result.exhaustedProviders.join(', ')})`
    : '';

  throw new Error(`${errorMsg}${extraInfo}`);
}

/**
 * Versión enhanced que retorna metadata completa
 *
 * Útil para debugging y monitoreo del sistema de fallback.
 */
export async function taskWithMetadata(options: OpenCodeTaskOptions): Promise<OpenCodeTaskResult> {
  const ggaOptions: GGADelegationOptions = {
    agent: options.subagent_type,
    task: options.prompt,
  };

  const result = await GuardianAngel(ggaOptions);

  return {
    success: result.success,
    output: result.output,
    error: result.error,
    model: result.model,
    fallbackUsed: result.switchOccurred,
    attempts: result.attempts,
  };
}

// =============================================================================
// COMPATIBILIDAD CON task() ORIGINAL
// =============================================================================

/**
 * Versión síncrona (stub - OpenCode task() es async)
 * Solo para compatibilidad, lanza error informativo
 */
export function taskSync(_options: OpenCodeTaskOptions): never {
  throw new Error('taskSync is not supported. Use task() (async) or taskWithMetadata() instead.');
}

// =============================================================================
// EXPORTS
// =============================================================================

export { GuardianAngel as gga };
export type { GGADelegationOptions, GGADelegationResult };
export default task;

// Re-exportar funciones útiles de GGA
export {
  checkProviderHealth,
  getCurrentProvider,
  getSwitchHistory,
  resetProviders,
} from './gga.js';
