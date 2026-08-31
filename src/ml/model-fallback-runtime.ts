#!/usr/bin/env npx tsx
/**
 * Model Fallback Runtime - Sistema de fallback automático en tiempo real
 *
 * Monitorea errores y automaticamente cambia modelos cuando:
 * 1. "Free usage exceeded, subscribe to Go" aparece
 * 2. Cualquier modelo configurado no está disponible
 * 3. Cuota agotada en cualquier proveedor
 *
 * Uso con agentes:
 *   npx tsx src/ml/model-fallback-runtime.ts --watch-agent sdd-apply
 *   npm run model:fallback -- --action watch --agent sdd-apply
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const ROOT = process.cwd();
const HEALTH_REGISTRY_PATH = join(ROOT, 'config', 'model-health-registry.json');
const ACTIVE_MODEL_PATH = join(ROOT, '.runtime', 'model-active.json');
const SESSION_STATE_PATH = join(ROOT, '.session', 'session-current.json');
const AGENT_STATE_DIR = join(ROOT, '.session', 'agent-states');

interface ModelHealthRegistry {
  models: Record<
    string,
    {
      provider: string;
      health: { status: string };
      fallbackChain: string[];
    }
  >;
  routingRules: {
    orchestrator: { primary: string };
    subagents: { default: string; inheritFromOrchestrator: boolean };
  };
  errorPatterns: {
    quotaExceeded: string[];
    modelNotFound: string[];
    timeout: string[];
    authError: string[];
  };
}

interface ActiveModel {
  model: string;
  provider: string;
  enforcedAt: string;
  reason: string;
  previousModel?: string;
}

/**
 * Detecta si el mensaje de error indica cuota agotada
 */
function isQuotaExceeded(error: string): boolean {
  if (!existsSync(HEALTH_REGISTRY_PATH)) return false;

  const registry: ModelHealthRegistry = JSON.parse(readFileSync(HEALTH_REGISTRY_PATH, 'utf-8'));

  const patterns = registry.errorPatterns.quotaExceeded;
  const errorLower = error.toLowerCase();

  return patterns.some((pattern) => errorLower.includes(pattern.toLowerCase()));
}

/**
 * Obtiene el siguiente modelo disponible en la cadena de fallback
 */
function getNextAvailableModel(currentModel: string): string | null {
  if (!existsSync(HEALTH_REGISTRY_PATH)) return null;

  const registry: ModelHealthRegistry = JSON.parse(readFileSync(HEALTH_REGISTRY_PATH, 'utf-8'));

  if (!registry.models[currentModel]) return null;

  const fallbackChain = registry.models[currentModel].fallbackChain || [];

  // Buscar el primer modelo disponible en la cadena
  for (const model of fallbackChain) {
    if (registry.models[model] && registry.models[model].health.status === 'available') {
      return model;
    }
  }

  // Si no hay en la cadena específica, usar fallback universal
  return registry.routingRules.subagents.default || null;
}

/**
 * Cambia el modelo activo para todos los agentes
 */
function switchActiveModel(newModel: string, reason: string): boolean {
  console.log(`[MODEL-FALLBACK] Cambiando modelo: "${newModel}" (${reason})`);

  // 1. Actualizar registry
  if (!existsSync(HEALTH_REGISTRY_PATH)) return false;

  const registry: ModelHealthRegistry = JSON.parse(readFileSync(HEALTH_REGISTRY_PATH, 'utf-8'));

  // Guardar modelo anterior
  const currentPrimary = registry.routingRules.orchestrator.primary;

  // Actualizar primary
  registry.routingRules.orchestrator.primary = newModel;

  // Sincronizar con subagents si heredan
  if (registry.routingRules.subagents.inheritFromOrchestrator) {
    registry.routingRules.subagents.default = newModel;
  }

  // Guardar cambios
  writeFileSync(HEALTH_REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf-8');

  // 2. Guardar modelo activo
  const activeModel: ActiveModel = {
    model: newModel,
    provider: registry.models[newModel]?.provider || 'unknown',
    enforcedAt: new Date().toISOString(),
    reason: reason,
    previousModel: currentPrimary,
  };

  writeFileSync(ACTIVE_MODEL_PATH, JSON.stringify(activeModel, null, 2), 'utf-8');

  // 3. Actualizar opencode.json dinámicamente (opcional)
  updateOpenCodeConfig(newModel);

  console.log(`✅ Modelo cambiado exitosamente a: ${newModel}`);
  return true;
}

/**
 * Actualiza opencode.json para usar modelo dinámico heredado
 */
function updateOpenCodeConfig(newModel: string): void {
  const opencodePath = join(ROOT, 'opencode.json');
  if (!existsSync(opencodePath)) return;

  try {
    const opencode = JSON.parse(readFileSync(opencodePath, 'utf-8'));

    // Actualizar orquestador
    if (opencode.agent?.orchestrator) {
      opencode.agent.orchestrator.model = newModel;
      opencode.agent.orchestrator.provider = 'dynamic';
    }

    // Actualizar agentes para heredar del orquestador
    const agentKeys = Object.keys(opencode.agent || {});
    const agentsToUpdate = agentKeys.filter(
      (key) => key !== 'orchestrator' && opencode.agent[key]?.model !== 'inherit',
    );

    for (const agentKey of agentsToUpdate) {
      if (opencode.agent[agentKey]) {
        opencode.agent[agentKey].model = 'inherit';
        opencode.agent[agentKey].provider = 'dynamic';
      }
    }

    writeFileSync(opencodePath, JSON.stringify(opencode, null, 2), 'utf-8');

    console.log('✅ opencode.json actualizado con modelo dinámico');
  } catch (error) {
    console.error('❌ Error actualizando opencode.json:', error);
  }
}

/**
 * Sistema de watch para errores de agente
 */
function watchAgentErrors(agentName: string): void {
  console.log(`[WATCH] Monitoreando errores para agente: ${agentName}`);

  // Crear directorio si no existe
  if (!existsSync(AGENT_STATE_DIR)) {
    require('fs').mkdirSync(AGENT_STATE_DIR, { recursive: true });
  }

  const agentStatePath = join(AGENT_STATE_DIR, `${agentName}-state.json`);

  // Crear estado inicial si no existe
  if (!existsSync(agentStatePath)) {
    writeFileSync(
      agentStatePath,
      JSON.stringify(
        {
          agent: agentName,
          model: 'inherited',
          lastError: null,
          errorCount: 0,
          fallbackAttempts: 0,
          lastUpdated: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf-8',
    );
  }

  // Monitorear archivo de sesión para errores
  const sessionWatchPath = SESSION_STATE_PATH;

  if (!existsSync(sessionWatchPath)) {
    console.log(`❌ No se puede encontrar: ${sessionWatchPath}`);
    return;
  }

  console.log(`👁️  Monitoreando: ${sessionWatchPath}`);

  // Monitoreo simple con polling cada 5 segundos
  setInterval(() => {
    try {
      const currentState = readFileSync(sessionWatchPath, 'utf-8');
      const data = JSON.parse(currentState);

      // Verificar errores recientes en la sesión
      interface SessionError {
        timestamp?: string;
        message?: string;
        text?: string;
      }
      const errors: SessionError[] = data.recentErrors || [];
      const recentErrors = errors.filter(
        (error) => error.timestamp && Date.now() - new Date(error.timestamp).getTime() < 30000, // Últimos 30 segundos
      );

      if (recentErrors.length > 0) {
        recentErrors.forEach((error) => {
          const errorMessage = error.message || error.text || '';
          console.log(`[AGENT-ERROR] ${agentName}: ${errorMessage.substring(0, 100)}...`);

          if (isQuotaExceeded(errorMessage)) {
            console.log(`⚠️  Cuota agotada detectada para ${agentName}`);

            // Obtener modelo actual
            const currentModel = getCurrentModel();
            const nextModel = getNextAvailableModel(currentModel);

            if (nextModel) {
              console.log(`🔄 Cambiando a modelo: ${nextModel}`);
              switchActiveModel(
                nextModel,
                `Cuota agotada en ${currentModel} para agente ${agentName}`,
              );
            } else {
              console.log(`❌ No hay modelo disponible para fallback`);
            }
          }
        });
      }
    } catch {
      // Ignorar errores temporales
    }
  }, 5000); // Check cada 5 segundos
}

/**
 * Obtiene el modelo actual activo
 */
function getCurrentModel(): string {
  if (existsSync(ACTIVE_MODEL_PATH)) {
    const active: ActiveModel = JSON.parse(readFileSync(ACTIVE_MODEL_PATH, 'utf-8'));
    return active.model;
  }

  // Fallback al registro de salud
  if (existsSync(HEALTH_REGISTRY_PATH)) {
    const registry: ModelHealthRegistry = JSON.parse(readFileSync(HEALTH_REGISTRY_PATH, 'utf-8'));
    return registry.routingRules.orchestrator.primary;
  }

  return 'opencode/deepseek-v4-flash-free'; // Default
}

/**
 * Programa principal
 */
function main() {
  const args = process.argv.slice(2);

  if (args.includes('--watch-agent')) {
    const agentIndex = args.indexOf('--watch-agent');
    const agentName = args[agentIndex + 1];

    if (!agentName) {
      console.log('❌ Especifica nombre de agente: --watch-agent <nombre>');
      return;
    }

    watchAgentErrors(agentName);

    // Mantener proceso vivo
    setInterval(() => {
      // Heartbeat
    }, 60000);
  } else if (args.includes('--switch-model')) {
    const modelIndex = args.indexOf('--switch-model');
    const modelName = args[modelIndex + 1];
    const reason = args.slice(modelIndex + 2).join(' ') || 'Manual switch';

    if (!modelName) {
      console.log('❌ Especifica modelo: --switch-model <modelo> [razón]');
      return;
    }

    switchActiveModel(modelName, reason);
  } else if (args.includes('--get-current')) {
    console.log(`Modelo actual: ${getCurrentModel()}`);
  } else if (args.includes('--test-error')) {
    testErrorHandling();
  } else {
    console.log(`
Model Fallback Runtime v1.0

Uso:
  npx tsx src/ml/model-fallback-runtime.ts --watch-agent <agent>   // Monitorear agente específico
  npx tsx src/ml/model-fallback-runtime.ts --switch-model <modelo> [razón] // Cambiar modelo
  npx tsx src/ml/model-fallback-runtime.ts --get-current            // Ver modelo actual
  npx tsx src/ml/model-fallback-runtime.ts --test-error            // Probar detección de error

Comando npm:
  npm run model:fallback -- --action watch --agent sdd-apply
  npm run model:fallback -- --action switch --model ollama/qwen2.5-coder:14b
  npm run model:fallback -- --action check

Descripción:
  Sistema de fallback automático que detecta errores de "Free usage exceeded"
  y cambia automáticamente a un modelo disponible.
    `);
  }
}

/**
 * Función de prueba
 */
function testErrorHandling(): void {
  console.log('🧪 Probando detección de errores...\n');

  const testErrors = [
    'Free usage exceeded, subscribe to Go',
    'API rate limit exceeded',
    'quota exceeded for model opencode/deepseek-v4-flash-free',
    'Credits exhausted',
    'Too many requests',
    'Model opencode/deepseek-v4-flash-free not found',
    'Unknown error occurred',
  ];

  testErrors.forEach((error) => {
    const isQuota = isQuotaExceeded(error);
    console.log(`${isQuota ? '✅' : '❌'} "${error.substring(0, 40)}..." -> Quota: ${isQuota}`);
  });

  console.log('\n🔍 Probando fallback chain...');
  const currentModel = getCurrentModel();
  console.log(`Modelo actual: ${currentModel}`);

  const nextModel = getNextAvailableModel(currentModel);
  console.log(`Próximo modelo disponible: ${nextModel || 'Ninguno'}`);

  if (nextModel) {
    console.log(
      `\n📋 To switch: npx tsx src/ml/model-fallback-runtime.ts --switch-model "${nextModel}" "Test switch"`,
    );
  }
}

// Ejecutar (ESM main-module check — require.main is unavailable in ESM)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { isQuotaExceeded, getNextAvailableModel, switchActiveModel, getCurrentModel };
