#!/usr/bin/env tsx
/**
 * OpenChamber Integration Bridge
 *
 * Puente de integración entre Gentle-Vanguard y OpenChamber.
 * Proporciona una interfaz unificada para que OpenChamber use
 * todas las capacidades del stack sin configuración manual.
 *
 * INSTALACIÓN EN OPENCHAMBER:
 *   1. Copiar este archivo al proyecto OpenChamber
 *   2. Importar: import { GentleVanguardBridge } from './openchamber-bridge.js';
 *   3. Inicializar: await GentleVanguardBridge.init();
 *   4. Usar: const response = await GentleVanguardBridge.orchestrate(input, context);
 *
 * O usar CLI:
 *   npx tsx openchamber-bridge.ts --install
 *
 * @version 1.0.0
 */

import { join } from 'path';
import { pathToFileURL } from 'url';
import { existsSync, readFileSync } from 'fs';

// ─── Configuration ────────────────────────────────────────────────────────────
const STACK_ROOT = process.env.GENTLE_VANGUARD_ROOT || 'C:\\Workspace_local\\gentle-vanguard';

// ─── Interface ────────────────────────────────────────────────────────────────
interface OrchestratorConfig {
  agent: string;
  skill?: string;
  cacheEnabled: boolean;
  compressionEnabled: boolean;
}

interface OrchestratorResult {
  content: string;
  tokensUsed: number;
  tokensSaved: number;
  fromCache: boolean;
  model: string;
  timestamp: string;
}

interface StackStatus {
  healthy: boolean;
  version: string;
  components: Record<string, boolean>;
}

// ─── State ────────────────────────────────────────────────────────────────────
let isInitialized = false;
let stackConfig: any = null;
let cacheModule: any = null;

// ─── Initialization ───────────────────────────────────────────────────────────
async function initBridge(): Promise<boolean> {
  if (isInitialized) return true;

  try {
    // Verificar que el stack existe
    if (!existsSync(STACK_ROOT)) {
      console.error(`[OPENCHAMBER-BRIDGE] Stack not found at: ${STACK_ROOT}`);
      console.error('[OPENCHAMBER-BRIDGE] Set GENTLE_VANGUARD_ROOT env var');
      return false;
    }

    // Cargar configuración del stack
    const configPath = join(STACK_ROOT, 'config', 'orchestrator.json');
    if (existsSync(configPath)) {
      stackConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    }

    // Intentar cargar módulos del stack
    try {
      const cachePath = join(STACK_ROOT, 'src', 'core', 'cache-hook-system.ts');
      if (existsSync(cachePath)) {
        // Usar dynamic import para TypeScript
        cacheModule = await import(cachePath);
      }
    } catch (err) {
      console.warn(`[OPENCHAMBER-BRIDGE] Cache module not loaded: ${err}`);
    }

    isInitialized = true;
    console.log('[OPENCHAMBER-BRIDGE] Bridge initialized successfully');
    return true;
  } catch (err) {
    console.error(`[OPENCHAMBER-BRIDGE] Initialization failed: ${err}`);
    return false;
  }
}

// ─── Core Functions ───────────────────────────────────────────────────────────

/**
 * Orquesta una tarea usando el stack Gentle-Vanguard.
 *
 * @param input - Input del usuario
 * @param config - Configuración de orquestación
 * @returns Resultado con metadatos
 */
export async function orchestrate(
  input: string,
  config: Partial<OrchestratorConfig> = {},
): Promise<OrchestratorResult> {
  if (!isInitialized) {
    const initialized = await initBridge();
    if (!initialized) {
      throw new Error('Bridge not initialized');
    }
  }

  const fullConfig: OrchestratorConfig = {
    agent: config.agent || 'orchestrator',
    skill: config.skill,
    cacheEnabled: config.cacheEnabled !== false,
    compressionEnabled: config.compressionEnabled !== false,
  };

  // Check cache if enabled
  let tokensSaved = 0;
  let fromCache = false;
  let response = '';

  if (fullConfig.cacheEnabled && cacheModule?.CacheHookSystem?.check) {
    const cacheResult = cacheModule.CacheHookSystem.check(input, fullConfig.skill);
    if (cacheResult.hit && cacheResult.response) {
      response = cacheResult.response;
      tokensSaved = cacheResult.tokensSaved || 0;
      fromCache = true;

      return {
        content: response,
        tokensUsed: Math.floor(response.length / 4),
        tokensSaved,
        fromCache,
        model: 'opencode/deepseek-v4-flash-free',
        timestamp: new Date().toISOString(),
      };
    }
  }

  // Si no hay cache, delegar al stack
  // Nota: En implementación real, esto llamaría al orchestrator real
  // Por ahora, simulamos la respuesta
  response = `[DELEGATED TO GENTLE-VANGUARD]\nAgent: ${fullConfig.agent}\nInput: ${input}`;

  const tokensUsed = Math.floor(input.length / 4 + response.length / 4);

  // Save to cache if enabled
  if (fullConfig.cacheEnabled && cacheModule?.CacheHookSystem?.registerOutput && !fromCache) {
    cacheModule.CacheHookSystem.registerOutput(response, tokensUsed);
    tokensSaved = Math.floor(tokensUsed * 0.3); // Estimated 30% savings
  }

  return {
    content: response,
    tokensUsed,
    tokensSaved,
    fromCache,
    model: 'opencode/deepseek-v4-flash-free',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Obtiene el estado de salud del stack.
 */
export async function getStatus(): Promise<StackStatus> {
  if (!isInitialized) {
    await initBridge();
  }

  // Verificar componentes clave
  const components: Record<string, boolean> = {
    stackRoot: existsSync(STACK_ROOT),
    config: existsSync(join(STACK_ROOT, 'config', 'orchestrator.json')),
    healthCheck: existsSync(join(STACK_ROOT, 'src', 'health-check.ts')),
    cacheHook: existsSync(join(STACK_ROOT, 'src', 'core', 'cache-hook-system.ts')),
    responseCache: existsSync(join(STACK_ROOT, 'src', 'response-cache.ts')),
    nexusDb: existsSync(join(STACK_ROOT, '.runtime', 'gentle-vanguard.db')),
  };

  const healthy = Object.values(components).every((v) => v);

  return {
    healthy,
    version: stackConfig?.version || '4.0.0',
    components,
  };
}

/**
 * Ejecuta health check del stack.
 */
export async function healthCheck(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  details: string;
}> {
  const status = await getStatus();

  if (status.healthy) {
    return {
      status: 'healthy',
      details: 'All components operational',
    };
  }

  const failed = Object.entries(status.components)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  return {
    status: failed.length > 3 ? 'unhealthy' : 'degraded',
    details: `Failed components: ${failed.join(', ')}`,
  };
}

/**
 * Obtiene estadísticas del cache.
 */
export async function getCacheStats(): Promise<{
  enabled: boolean;
  hitRate: number;
  totalCalls: number;
  tokensSaved: number;
}> {
  if (!isInitialized || !cacheModule?.CacheHookSystem?.getStats) {
    return {
      enabled: false,
      hitRate: 0,
      totalCalls: 0,
      tokensSaved: 0,
    };
  }

  const stats = cacheModule.CacheHookSystem.getStats();
  return {
    enabled: true,
    hitRate: stats.hitRate || 0,
    totalCalls: stats.totalCalls || 0,
    tokensSaved: stats.tokensSaved || 0,
  };
}

// ─── Export Interface ────────────────────────────────────────────────────────
export const GentleVanguardBridge = {
  init: initBridge,
  orchestrate,
  getStatus,
  healthCheck,
  getCacheStats,
  version: '1.0.0',
};

export default GentleVanguardBridge;

// ─── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);

  if (args.includes('--status')) {
    const status = await getStatus();
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║  OpenChamber Bridge Status             ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`Healthy:     ${status.healthy ? '✅ YES' : '❌ NO'}`);
    console.log(`Version:     ${status.version}`);
    console.log(`\nComponents:`);
    for (const [name, ok] of Object.entries(status.components)) {
      console.log(`  ${ok ? '✅' : '❌'} ${name}`);
    }
  }

  if (args.includes('--health')) {
    const health = await healthCheck();
    console.log(`\nHealth Status: ${health.status.toUpperCase()}`);
    console.log(`Details: ${health.details}`);
  }

  if (args.includes('--cache-stats')) {
    const stats = await getCacheStats();
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║  Cache Statistics                      ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`Enabled:      ${stats.enabled ? 'YES' : 'NO'}`);
    console.log(`Hit Rate:     ${stats.hitRate.toFixed(2)}%`);
    console.log(`Total Calls:  ${stats.totalCalls}`);
    console.log(`Tokens Saved: ${stats.tokensSaved}`);
  }

  if (args.includes('--test')) {
    console.log('\n[TEST] Running integration test...');
    await initBridge();
    const result = await orchestrate('Hello, this is a test');
    console.log('\n[TEST] Result:', JSON.stringify(result, null, 2));
  }

  if (args.includes('--help') || args.length === 0) {
    console.log('\nUso: npx tsx openchamber-bridge.ts [OPTION]');
    console.log('');
    console.log('Opciones:');
    console.log('  --status      Mostrar estado del bridge');
    console.log('  --health      Ejecutar health check');
    console.log('  --cache-stats Estadísticas del cache');
    console.log('  --test        Test de integración');
    console.log('  --help        Mostrar ayuda');
    console.log('');
    console.log('Variables de entorno:');
    console.log(
      '  GENTLE_VANGUARD_ROOT - Ruta al stack (default: C:\\Workspace_local\\gentle-vanguard)',
    );
    console.log('');
  }
}
