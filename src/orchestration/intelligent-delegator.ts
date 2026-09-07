#!/usr/bin/env node
/**
 * Intelligent Delegator - Auto-Model-Fallback System
 *
 * Sistema de delegación inteligente que:
 * 1. Verifica disponibilidad del modelo antes de delegar
 * 2. Automáticamente switchea a modelos disponibles si falla
 * 3. Persiste el modelo funcional en runtime (NO modifica configs estáticos)
 * 4. Reutiliza el modelo funcional para futuras delegaciones
 * 5. Funciona con ANY AI tool (Claude, Cursor, OpenCode, etc.)
 *
 * USO (desde el orquestador):
 *   import { intelligentDelegate } from './intelligent-delegator.js';
 *
 *   const result = await intelligentDelegate({
 *     agent: 'sdd-explore',
 *     task: 'analyze requirements',
 *     // NO especificar model - se detecta automáticamente
 *   });
 *
 * El sistema PRIMERO intenta el model del orquestador actual (heredado),
 * luego usa la cadena de fallback si hay error.
 */

import { runNpxTsx } from '../core/run-command.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { log } from '../utils/logger.js';
import { compressStructural } from '../compression/structural-compression.js';

const logger = log('INTELLIGENT-DELEGATOR');

// =============================================================================
// CONFIGURACIÓN
// =============================================================================

const ROOT = process.cwd();
const RUNTIME_STATE_FILE = join(ROOT, '.runtime', 'intelligent-delegator-state.json');

// Modelos disponibles en orden de preferencia (ordenados por capacidad/costo)
const DEFAULT_MODEL_CHAIN: ModelInfo[] = [
  { id: 'opencode/big-pickle', provider: 'opencode', tier: 'premium', cost: 'free' },
  { id: 'opencode/mimo-v2.5-free', provider: 'opencode', tier: 'standard', cost: 'free' },
  { id: 'opencode/deepseek-v4-flash-free', provider: 'opencode', tier: 'fast', cost: 'free' },
  { id: 'claude-haiku-4-5', provider: 'littellmott', tier: 'standard', cost: 'free' },
  { id: 'ollama/qwen2.5', provider: 'ollama', tier: 'local', cost: 'local' },
  { id: 'ollama/llama3', provider: 'ollama', tier: 'local', cost: 'local' },
];

// Modelos por tipo de agente (especialización)
const AGENT_MODEL_PREFERENCES: Record<string, string[]> = {
  BA: ['opencode/big-pickle', 'opencode/mimo-v2.5-free'],
  SAD: ['opencode/big-pickle', 'claude-haiku-4-5'],
  DEV: ['opencode/big-pickle', 'opencode/deepseek-v4-flash-free'],
  QA: ['opencode/big-pickle', 'opencode/mimo-v2.5-free'],
  OPS: ['opencode/big-pickle', 'opencode/deepseek-v4-flash-free', 'ollama/qwen2.5'],
  GOV: ['opencode/big-pickle', 'claude-haiku-4-5'],
  DOC: ['opencode/big-pickle', 'claude-haiku-4-5'],
};

// =============================================================================
// TIPOS
// =============================================================================

interface ModelInfo {
  id: string;
  provider: string;
  tier: 'premium' | 'standard' | 'fast' | 'local';
  cost: 'free' | 'local' | 'paid';
  lastChecked?: string;
  status?: 'available' | 'unavailable' | 'degraded' | 'unknown';
  consecutiveErrors?: number;
}

interface DelegationRequest {
  agent: string;
  task: string;
  context?: string;
  /** Opcional: si NO se especifica, se detecta automáticamente */
  preferredModel?: string;
  temperature?: number;
  maxRetries?: number;
  compression?: boolean;
}

interface DelegationResult {
  success: boolean;
  output?: string;
  error?: string;
  duration: number;
  model: string;
  provider: string;
  attempts: number;
  fallbackUsed: boolean;
  modelsTried: string[];
  modelsFailed: { model: string; error: string }[];
  /** Para depuración y aprendizaje */
  executionLog: string[];
}

interface RuntimeState {
  version: string;
  lastUpdated: string;
  /** Modelo que funcionó exitosamente la última vez */
  lastWorkingModel: string | null;
  /** Cache de disponibilidad por modelo */
  modelAvailability: Record<string, ModelAvailability>;
  /** Preferencias aprendidas por agente */
  agentModelPreferences: Record<string, string>;
  /** Métricas de uso */
  metrics: {
    totalDelegations: number;
    successfulDelegations: number;
    fallbackCount: number;
    averageAttempts: number;
  };
}

interface ModelAvailability {
  status: 'available' | 'unavailable' | 'degraded' | 'unknown';
  lastChecked: string;
  consecutiveErrors: number;
  lastError?: string;
  lastSuccess?: string;
}

// =============================================================================
// PERSISTENCIA DE ESTADO (RUNTIME - NO CONFIG)
// =============================================================================

function loadRuntimeState(): RuntimeState {
  try {
    if (existsSync(RUNTIME_STATE_FILE)) {
      return JSON.parse(readFileSync(RUNTIME_STATE_FILE, 'utf-8'));
    }
  } catch {
    logger.warn('Could not load runtime state, initializing fresh');
  }

  return createFreshState();
}

function createFreshState(): RuntimeState {
  // Inicializar con todos los modelos como "desconocidos"
  const modelAvailability: Record<string, ModelAvailability> = {};
  for (const model of DEFAULT_MODEL_CHAIN) {
    modelAvailability[model.id] = {
      status: 'unknown',
      lastChecked: new Date().toISOString(),
      consecutiveErrors: 0,
    };
  }

  return {
    version: '2.0.0',
    lastUpdated: new Date().toISOString(),
    lastWorkingModel: null,
    modelAvailability,
    agentModelPreferences: {},
    metrics: {
      totalDelegations: 0,
      successfulDelegations: 0,
      fallbackCount: 0,
      averageAttempts: 0,
    },
  };
}

function saveRuntimeState(state: RuntimeState): void {
  try {
    const runtimeDir = join(ROOT, '.runtime');
    if (!existsSync(runtimeDir)) mkdirSync(runtimeDir, { recursive: true });

    state.lastUpdated = new Date().toISOString();
    writeFileSync(RUNTIME_STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
    logger.warn('Could not save runtime state (non-critical)');
  }
}

// =============================================================================
// DETECCIÓN DE MODELO DEL ORQUESTADOR
// =============================================================================

/**
 * Detecta el modelo actual del orquestador de múltiples fuentes
 * (en orden de prioridad)
 */
function detectOrchestratorModel(): string {
  // 1. Variables de entorno del orquestador
  const envModel = process.env.ORCHESTRATOR_MODEL || process.env.AGENT_MODEL || process.env.SESSION_MODEL;
  if (envModel) {
    logger.info(`Using orchestrator model from env: ${envModel}`);
    return envModel;
  }

  // 2. Archivo de estado activo
  const activeModelFile = join(ROOT, '.runtime', 'model-active.json');
  try {
    if (existsSync(activeModelFile)) {
      const content = JSON.parse(readFileSync(activeModelFile, 'utf-8'));
      if (content.model) {
        logger.info(`Using orchestrator model from active file: ${content.model}`);
        return content.model;
      }
    }
  } catch {
    // Fall through
  }

  // 3. Leer de opencode.json (current config)
  try {
    const opencodeConfig = JSON.parse(readFileSync(join(ROOT, 'opencode.json'), 'utf-8'));
    if (opencodeConfig.agent?.orchestrator?.model) {
      logger.info(`Using orchestrator model from opencode.json: ${opencodeConfig.agent.orchestrator.model}`);
      return opencodeConfig.agent.orchestrator.model;
    }
  } catch {
    // Fall through
  }

  // 4. Default fallback
  logger.info('Using default model: opencode/big-pickle');
  return 'opencode/big-pickle';
}

// =============================================================================
// CONSTRUCCIÓN DE CADENA DE FALLBACK
// =============================================================================

/**
 * Construye la cadena de modelos a probar según el agente y preferencias
 */
function buildModelChain(
  request: DelegationRequest,
  state: RuntimeState,
  orchestratorModel: string,
): string[] {
  const chain: string[] = [];
  const tried = new Set<string>();

  // 1. Modelo preferido especificado por el request (si existe y no está marcado como unavailable)
  if (request.preferredModel &&
      state.modelAvailability[request.preferredModel]?.status !== 'unavailable') {
    chain.push(request.preferredModel);
    tried.add(request.preferredModel);
  }

  // 2. Modelo del orquestador (herencia)
  if (!tried.has(orchestratorModel) &&
      state.modelAvailability[orchestratorModel]?.status !== 'unavailable') {
    chain.push(orchestratorModel);
    tried.add(orchestratorModel);
  }

  // 3. Modelo que funcionó la última vez
  if (state.lastWorkingModel &&
      !tried.has(state.lastWorkingModel) &&
      state.modelAvailability[state.lastWorkingModel]?.status !== 'unavailable') {
    chain.push(state.lastWorkingModel);
    tried.add(state.lastWorkingModel);
  }

  // 4. Preferencias por tipo de agente
  const agentType = request.agent.split('-')[0].toUpperCase();
  const agentPreferences = AGENT_MODEL_PREFERENCES[agentType] || [];
  for (const modelId of agentPreferences) {
    if (!tried.has(modelId) && state.modelAvailability[modelId]?.status !== 'unavailable') {
      chain.push(modelId);
      tried.add(modelId);
    }
  }

  // 5. Modelos preferidos para este agente específico (aprendido)
  if (state.agentModelPreferences[request.agent] &&
      !tried.has(state.agentModelPreferences[request.agent]) &&
      state.modelAvailability[state.agentModelPreferences[request.agent]]?.status !== 'unavailable') {
    chain.push(state.agentModelPreferences[request.agent]);
    tried.add(state.agentModelPreferences[request.agent]);
  }

  // 6. Modelos disponibles ordenados por prioridad
  for (const model of DEFAULT_MODEL_CHAIN) {
    if (!tried.has(model.id)) {
      // Si está marcado como unavailable pero hace mucho tiempo, intentarlo de nuevo
      const availability = state.modelAvailability[model.id];
      if (availability?.status === 'unavailable') {
        const lastChecked = new Date(availability.lastChecked);
        const now = new Date();
        const minutesSinceFailure = (now.getTime() - lastChecked.getTime()) / (1000 * 60);

        // Reintentar después de 10 minutos
        if (minutesSinceFailure > 10) {
          chain.push(model.id);
          tried.add(model.id);
        }
      } else {
        chain.push(model.id);
        tried.add(model.id);
      }
    }
  }

  return chain;
}

// =============================================================================
// EJECUCIÓN CON MODELO ESPECÍFICO
// =============================================================================

/**
 * Ejecuta la delegación usando el model-fallback-orchestrator existente
 */
async function executeWithModel(
  request: DelegationRequest,
  model: string,
): Promise<{ success: boolean; output?: string; error?: string; model: string }> {
  // Comprimir task si es muy largo
  let task = request.task;
  if (request.compression !== false && task.length > 1000) {
    try {
      const compressed = compressStructural(task, { mode: 'input' });
      if (compressed.compressed.length < task.length * 0.8) {
        task = compressed.compressed;
        logger.info(`Compressed task from ${compressed.originalChars} to ${compressed.compressedChars} chars`);
      }
    } catch {
      // Usar original si falla compresión
    }
  }

  try {
    // Usar el model-fallback-orchestrator existente
    const delegatorPath = join(ROOT, 'src', 'orchestration', 'agent-delegator.ts');

    const args = [
      '--agent', request.agent,
      '--task', task,
      '--model', model,
    ];

    if (request.context) {
      args.push('--context', request.context);
    }

    if (request.temperature !== undefined) {
      args.push('--temperature', String(request.temperature));
    }

    const child = runNpxTsx(delegatorPath, args, {
      cwd: ROOT,
      env: {
        AGENT_MODEL: model,
        FORCE_MODEL: model,
        ORCHESTRATOR_MODEL: model,
        INTELLIGENT_DELEGATION: 'true',
      },
      timeout: 300000, // 5 minutos
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on('close', (code) => resolve(code));
      child.on('error', () => resolve(-1));
    });

    if (exitCode === 0) {
      return {
        success: true,
        output: stdout.trim(),
        model,
      };
    } else {
      return {
        success: false,
        error: stderr.trim() || stdout.trim() || `Exit code: ${exitCode}`,
        model,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: String(error),
      model,
    };
  }
}

// =============================================================================
// PATRONES DE ERROR QUE DISPARAN FALLBACK
// =============================================================================

const FALLBACK_ERROR_PATTERNS = [
  // Errores de cuota/crédito
  'Free usage exceeded',
  'subscribe to Go',
  'quota exceeded',
  'credits exhausted',
  'rate limit exceeded',
  'insufficient_quota',
  '429 Too Many Requests',
  'payment required',

  // Errores de modelo no disponible
  'Model not found',
  'ProviderModelNotFoundError',
  'model_not_found',
  'model unavailable',
  'model is currently unavailable',

  // Errores de autenticación (pueden indicar problemas de suscripción)
  'AuthenticationError',
  'unauthorized',
  'invalid api key',
  'APIConnectionError',
  'connection error',

  // Errores de herencia
  'inherit-from-session',
  'INHERITED_MODEL_CONFIG',
];

function shouldTriggerFallback(error: string): boolean {
  const normalizedError = error.toLowerCase();
  return FALLBACK_ERROR_PATTERNS.some((pattern) =>
    normalizedError.includes(pattern.toLowerCase()),
  );
}

// =============================================================================
// DELEGACIÓN INTELIGENTE PRINCIPAL
// =============================================================================

/**
 * Delega a un agente con fallback automático inteligente
 *
 * ESTA es la función que debe usarse desde el orquestador.
 * NO modifica archivos de configuración estáticos.
 * Persiste el modelo funcional en runtime.
 */
export async function intelligentDelegate(
  request: DelegationRequest,
): Promise<DelegationResult> {
  const startTime = Date.now();
  const state = loadRuntimeState();
  const executionLog: string[] = [];

  // Actualizar métricas
  state.metrics.totalDelegations++;

  // Detectar modelo del orquestador
  const orchestratorModel = detectOrchestratorModel();
  executionLog.push(`Orchestrator model detected: ${orchestratorModel}`);

  // Construir cadena de fallback
  const modelChain = buildModelChain(request, state, orchestratorModel);
  executionLog.push(`Model chain (${modelChain.length} models): ${modelChain.join(' -> ')}`);

  logger.info(`Delegating ${request.agent} with ${modelChain.length} models in chain`);

  const modelsTried: string[] = [];
  const modelsFailed: { model: string; error: string }[] = [];

  // Intentar cada modelo en la cadena
  for (let attempt = 0; attempt < modelChain.length; attempt++) {
    const model = modelChain[attempt];
    const isFirstAttempt = attempt === 0;

    modelsTried.push(model);
    executionLog.push(`Attempt ${attempt + 1}: trying model ${model}`);

    if (!isFirstAttempt) {
      logger.info(`Fallback attempt ${attempt + 1}: using model ${model}`);
    }

    try {
      const result = await executeWithModel(request, model);

      if (result.success) {
        // ÉXITO - Actualizar estado
        state.lastWorkingModel = model;
        state.modelAvailability[model] = {
          status: 'available',
          lastChecked: new Date().toISOString(),
          consecutiveErrors: 0,
          lastSuccess: new Date().toISOString(),
        };

        // Si usamos fallback, incrementar contador
        if (!isFirstAttempt) {
          state.metrics.fallbackCount++;
          executionLog.push(`Success with fallback model: ${model}`);
        } else {
          executionLog.push(`Success with primary model: ${model}`);
        }

        // Guardar preferencia para este agente
        state.agentModelPreferences[request.agent] = model;

        // Actualizar métricas
        state.metrics.successfulDelegations++;
        const avgAttempts = state.metrics.totalDelegations > 0
          ? (state.metrics.averageAttempts * (state.metrics.totalDelegations - 1) + (attempt + 1)) / state.metrics.totalDelegations
          : attempt + 1;
        state.metrics.averageAttempts = avgAttempts;

        saveRuntimeState(state);

        return {
          success: true,
          output: result.output,
          duration: Date.now() - startTime,
          model,
          provider: model.split('/')[0] || 'unknown',
          attempts: attempt + 1,
          fallbackUsed: !isFirstAttempt,
          modelsTried,
          modelsFailed,
          executionLog,
        };
      }

      // Fallo - ¿Debemos hacer fallback?
      if (shouldTriggerFallback(result.error || '')) {
        executionLog.push(`Model ${model} failed with fallback-trigger error: ${result.error}`);
        logger.warn(`Model ${model} exhausted: ${result.error}`);

        // Marcar como unavailable temporalmente
        const currentAvailability = state.modelAvailability[model] || {
          status: 'unknown',
          lastChecked: new Date().toISOString(),
          consecutiveErrors: 0,
        };
        state.modelAvailability[model] = {
          status: 'unavailable',
          lastChecked: new Date().toISOString(),
          consecutiveErrors: currentAvailability.consecutiveErrors + 1,
          lastError: result.error,
        };

        modelsFailed.push({ model, error: result.error || 'Unknown error' });

        // Continuar al siguiente modelo
        continue;
      }

      // Error que NO dispara fallback - retornar inmediatamente
      executionLog.push(`Model ${model} failed with non-fallback error: ${result.error}`);
      saveRuntimeState(state);

      return {
        success: false,
        error: result.error,
        duration: Date.now() - startTime,
        model,
        provider: model.split('/')[0] || 'unknown',
        attempts: attempt + 1,
        fallbackUsed: !isFirstAttempt,
        modelsTried,
        modelsFailed: [...modelsFailed, { model, error: result.error || 'Unknown error' }],
        executionLog,
      };
    } catch (error) {
      const errorStr = String(error);

      if (shouldTriggerFallback(errorStr)) {
        executionLog.push(`Model ${model} threw fallback-trigger exception: ${errorStr}`);
        logger.warn(`Model ${model} exception: ${errorStr}`);

        const currentAvailability = state.modelAvailability[model] || {
          status: 'unknown',
          lastChecked: new Date().toISOString(),
          consecutiveErrors: 0,
        };
        state.modelAvailability[model] = {
          status: 'unavailable',
          lastChecked: new Date().toISOString(),
          consecutiveErrors: currentAvailability.consecutiveErrors + 1,
          lastError: errorStr,
        };

        modelsFailed.push({ model, error: errorStr });
        continue;
      }

      executionLog.push(`Model ${model} threw non-fallback exception: ${errorStr}`);
      saveRuntimeState(state);

      return {
        success: false,
        error: errorStr,
        duration: Date.now() - startTime,
        model,
        provider: model.split('/')[0] || 'unknown',
        attempts: attempt + 1,
        fallbackUsed: !isFirstAttempt,
        modelsTried,
        modelsFailed: [...modelsFailed, { model, error: errorStr }],
        executionLog,
      };
    }
  }

  // Agotados todos los modelos
  const finalError = `All models exhausted after ${modelChain.length} attempts. Tried: ${modelsTried.join(', ')}`;
  executionLog.push(finalError);
  logger.error(finalError);

  saveRuntimeState(state);

  return {
    success: false,
    error: finalError,
    duration: Date.now() - startTime,
    model: 'none',
    provider: 'none',
    attempts: modelChain.length,
    fallbackUsed: true,
    modelsTried,
    modelsFailed,
    executionLog,
  };
}

// =============================================================================
// API ADICIONAL
// =============================================================================

/**
 * Obtiene el estado actual del sistema de delegación
 */
export function getDelegatorStatus(): {
  lastWorkingModel: string | null;
  modelAvailability: Record<string, ModelAvailability>;
  agentPreferences: Record<string, string>;
  metrics: RuntimeState['metrics'];
} {
  const state = loadRuntimeState();
  return {
    lastWorkingModel: state.lastWorkingModel,
    modelAvailability: state.modelAvailability,
    agentPreferences: state.agentModelPreferences,
    metrics: state.metrics,
  };
}

/**
 * Resetea el estado del delegador (útil para debugging)
 */
export function resetDelegatorState(): void {
  const freshState = createFreshState();
  saveRuntimeState(freshState);
  logger.info('Delegator state reset to defaults');
}

/**
 * Fuerza un modelo específico como preferido para un agente
 */
export function setPreferredModel(agent: string, model: string): void {
  const state = loadRuntimeState();
  state.agentModelPreferences[agent] = model;
  saveRuntimeState(state);
  logger.info(`Set preferred model for ${agent}: ${model}`);
}

// =============================================================================
// CLI
// =============================================================================

function cli(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'delegate': {
      const agentIndex = args.indexOf('--agent');
      const taskIndex = args.indexOf('--task');

      if (agentIndex === -1 || taskIndex === -1) {
        console.error('Usage: delegate --agent <name> --task "<description>" [--context "..."]');
        process.exit(1);
      }

      const agent = args[agentIndex + 1];
      const task = args[taskIndex + 1];
      const contextIndex = args.indexOf('--context');
      const context = contextIndex > -1 ? args[contextIndex + 1] : undefined;
      const modelIndex = args.indexOf('--model');
      const preferredModel = modelIndex > -1 ? args[modelIndex + 1] : undefined;

      void (async () => {
        const result = await intelligentDelegate({ agent, task, context, preferredModel });
        console.log('\n=== Intelligent Delegation Result ===\n');
        console.log(JSON.stringify(result, null, 2));

        if (!result.success) {
          process.exit(1);
        }
      })();
      break;
    }

    case 'status': {
      const status = getDelegatorStatus();
      console.log('\n=== Intelligent Delegator Status ===\n');
      console.log(`Last Working Model: ${status.lastWorkingModel || 'none'}`);
      console.log(`\nModel Availability:`);
      for (const [model, availability] of Object.entries(status.modelAvailability)) {
        console.log(`  ${model}: ${availability.status} (${availability.consecutiveErrors} errors)`);
      }
      console.log(`\nAgent Preferences:`);
      for (const [agent, model] of Object.entries(status.agentPreferences)) {
        console.log(`  ${agent}: ${model}`);
      }
      console.log(`\nMetrics:`);
      console.log(`  Total: ${status.metrics.totalDelegations}`);
      console.log(`  Successful: ${status.metrics.successfulDelegations}`);
      console.log(`  Fallbacks: ${status.metrics.fallbackCount}`);
      console.log(`  Avg Attempts: ${status.metrics.averageAttempts.toFixed(2)}`);
      break;
    }

    case 'reset': {
      resetDelegatorState();
      console.log('Delegator state reset to defaults.');
      break;
    }

    case 'set-preference': {
      const agentIndex = args.indexOf('--agent');
      const modelIndex = args.indexOf('--model');

      if (agentIndex === -1 || modelIndex === -1) {
        console.error('Usage: set-preference --agent <name> --model <model-id>');
        process.exit(1);
      }

      setPreferredModel(args[agentIndex + 1], args[modelIndex + 1]);
      break;
    }

    default:
      console.log(`
Intelligent Delegator v2.0 - Auto Model Fallback System

Commands:
  delegate --agent <name> --task "<desc>" [--context "..."] [--model "..."]
    Delegate task with automatic model fallback

  status
    Show current delegator status and model availability

  reset
    Reset delegator state to defaults

  set-preference --agent <name> --model <model-id>
    Set preferred model for an agent

Features:
  - Automatic model detection and fallback
  - Runtime state persistence (no config file modification)
  - Learning from successful/failed models
  - Compression for large tasks
  - Multiple fallback chains by agent type
  - Health tracking per model
`);
  }
}

// Run CLI if executed directly
import { pathToFileURL } from 'url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli();
}

export { cli };
