#!/usr/bin/env tsx
/**
 * Orchestrator Cache Wrapper
 *
 * Este módulo envuelve el orchestrador para agregar Response Cache
 * sin modificar session-autostart.ts directamente.
 *
 * Se integra vía:
 * 1. Configuración en opencode.json (como plugin/middleware)
 * 2. Import en archivos que llaman al orchestrator
 * 3. Reemplazo del entry point del orquestador
 *
 * Uso:
 *   import { orchestratorWithCache } from './orchestrator-cache-wrapper.js';
 *   const response = await orchestratorWithCache.handle(input, context);
 */

import { ResponseCache } from '../resilience/response-cache.js';
import { pathToFileURL } from 'url';
import { compressStructural } from '../compression/structural-compression.js';

// Instancia singleton del cache
let cacheInstance: ResponseCache | null = null;

interface OrchestratorResponse {
  content: string;
  tokensUsed: number;
  model: string;
  timestamp: string;
}

interface CachedOrchestratorResponse extends OrchestratorResponse {
  fromCache: boolean;
  tokensSaved: number;
}

/**
 * Inicializa el cache wrapper. Debe llamarse al inicio de la sesión.
 */
export function initOrchestratorCache(): void {
  if (!cacheInstance) {
    cacheInstance = new ResponseCache({ enabled: true, defaultTtlMinutes: 60 });
    console.log('[ORCH-CACHE] Orchestrator cache initialized');
  }
}

/**
 * Genera una clave de cache basada en el input y contexto.
 * Incluye compresión estructural para mejorar matches.
 */
function generateCacheKey(input: string, context: string = ''): string {
  // Comprimir el input estructuralmente para normalizar
  // Esto permite hits de cache incluso con variaciones menores
  try {
    const compressed = compressStructural(input, { mode: 'input' });
    input = compressed.compressed || input;
  } catch {
    // Si falla compresión, usar input original
  }

  // Combinar input + context (si existe)
  const key = context ? `${input}:${context}` : input;
  return key.slice(0, 500); // Limitar a 500 chars para la clave
}

/**
 * Intenta obtener una respuesta del cache.
 * Retorna null si no hay cache hit.
 */
function tryGetCachedResponse(
  input: string,
  context: string = '',
): CachedOrchestratorResponse | null {
  if (!cacheInstance) {
    initOrchestratorCache();
  }

  const cacheKey = generateCacheKey(input, context);
  const cached = cacheInstance!.get(cacheKey, context);

  if (cached) {
    try {
      const parsed: OrchestratorResponse = JSON.parse(cached.response);
      return {
        ...parsed,
        fromCache: true,
        tokensSaved: cached.tokensSaved,
      };
    } catch {
      // Si falla el parse, retornar null
      return null;
    }
  }

  return null;
}

/**
 * Guarda una respuesta en el cache.
 */
function saveResponseToCache(
  input: string,
  response: OrchestratorResponse,
  context: string = '',
): void {
  if (!cacheInstance) {
    initOrchestratorCache();
  }

  const cacheKey = generateCacheKey(input, context);
  const serialized = JSON.stringify(response);

  // Estimar tokens ahorrados: input (aprox 30%) + response (50% de repetición)
  const estimatedTokens = Math.floor(
    (input.length / 4) * 0.3 + (response.content.length / 4) * 0.5,
  );
  const tokensSaved = Math.max(10, estimatedTokens);

  cacheInstance!.set(cacheKey, serialized, tokensSaved, context);
}

/**
 * Wrapper principal del orchestrator con cache integrado.
 *
 * @param input - Input del usuario
 * @param context - Contexto adicional (skill, agent, etc)
 * @param originalFn - Función original del orchestrator que genera respuesta
 * @returns Respuesta del cache o del LLM
 */
export async function orchestratorWithCache(
  input: string,
  context: string,
  originalFn: () => Promise<OrchestratorResponse>,
): Promise<CachedOrchestratorResponse> {
  // Intentar cache primero
  const cached = tryGetCachedResponse(input, context);

  if (cached) {
    console.log(`[CACHE HIT] Tokens saved: ${cached.tokensSaved}`);
    return cached;
  }

  // Si no hay cache, ejecutar función original
  console.log('[CACHE MISS] Generating new response...');
  const response = await originalFn();

  // Guardar en cache
  saveResponseToCache(input, response, context);
  console.log('[CACHE SET] Response cached for future use');

  return {
    ...response,
    fromCache: false,
    tokensSaved: 0,
  };
}

/**
 * Helper para wrappear una función existente del orchestrator.
 * Uso: const wrappedFn = wrapWithCache(originalFn, context);
 */
export function wrapWithCache<T extends (...args: unknown[]) => Promise<OrchestratorResponse>>(
  fn: T,
  getInput: (...args: Parameters<T>) => string,
  getContext: (...args: Parameters<T>) => string,
): (...args: Parameters<T>) => Promise<CachedOrchestratorResponse> {
  return async (...args: Parameters<T>) => {
    const input = getInput(...args);
    const context = getContext(...args);

    return orchestratorWithCache(input, context, () => fn(...args));
  };
}

/**
 * Obtiene estadísticas del cache del orchestrator.
 */
export function getOrchestratorCacheStats(): {
  entries: number;
  hitRate: number;
  totalSavings: number;
} {
  if (!cacheInstance) {
    initOrchestratorCache();
  }

  const stats = cacheInstance!.getStats();
  return {
    entries: stats.entries,
    hitRate: stats.hitRate,
    totalSavings: stats.totalSavings,
  };
}

/**
 * Limpia el cache del orchestrator.
 */
export function clearOrchestratorCache(): void {
  if (cacheInstance) {
    cacheInstance.clear();
    console.log('[ORCH-CACHE] Orchestrator cache cleared');
  }
}

// Auto-inicialización si se importa directamente
initOrchestratorCache();

// CLI para debugging
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);

  if (args.includes('--stats')) {
    const stats = getOrchestratorCacheStats();
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║  Orchestrator Cache Statistics       ║');
    console.log('╚══════════════════════════════════════╝');
    console.log(`Entries:        ${stats.entries}`);
    console.log(`Hit Rate:       ${stats.hitRate.toFixed(2)}%`);
    console.log(`Total Savings:  ${stats.totalSavings} tokens`);
    console.log('');
  }

  if (args.includes('--clear')) {
    clearOrchestratorCache();
    console.log('[OK] Cache cleared');
  }

  console.log('\nUso: npx tsx src/core/orchestrator-cache-wrapper.ts [--stats|--clear]');
}
