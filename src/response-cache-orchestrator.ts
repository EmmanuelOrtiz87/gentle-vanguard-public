#!/usr/bin/env tsx
/**
 * Response Cache Orchestrator Integration
 *
 * Este script integra el Response Cache en el flujo del orchestrator.
 * Debe ser llamado antes de cada respuesta y después de cada respuesta.
 *
 * Uso:
 *   npx tsx src/response-cache-orchestrator.ts --before "input" --context "ctx"
 *   npx tsx src/response-cache-orchestrator.ts --after "input" "response" --tokens-saved 100
 *
 * NOTA: Este es un script auxiliar. La integración real debe hacerse en:
 *   - src/session-autostart.ts (para activar el cache)
 *   - Cada respuesta del orchestrator debe usar ResponseCache class
 */

import { ResponseCache } from './response-cache.js';
import { pathToFileURL } from 'url';

interface CacheHit {
  hit: true;
  response: string;
  tokensSaved: number;
}

interface CacheMiss {
  hit: false;
  key: string;
}

/**
 * Intenta obtener una respuesta del cache antes de enviar al LLM.
 * Esta función debe llamarse ANTES de any tool call que genere respuesta.
 */
export function tryCacheBeforeResponse(input: string, context: string = ''): CacheHit | CacheMiss {
  const cache = new ResponseCache({ enabled: true, defaultTtlMinutes: 60 });

  const cached = cache.get(input, context);
  if (cached) {
    console.log(`[CACHE HIT] Tokens saved: ${cached.tokensSaved}`);
    return {
      hit: true,
      response: cached.response,
      tokensSaved: cached.tokensSaved,
    };
  }

  return {
    hit: false,
    key: '', // El cache key se genera internamente
  };
}

/**
 * Guarda una respuesta en el cache después de recibirla del LLM.
 * Esta función debe llamarse DESPUÉS de recibir la respuesta.
 */
export function cacheAfterResponse(
  input: string,
  response: string,
  tokensUsed: number,
  context: string = '',
): void {
  const cache = new ResponseCache({ enabled: true, defaultTtlMinutes: 60 });

  // Estimamos que cachear ahorra ~30% de los tokens (prompt + response)
  const estimatedTokensSaved = Math.floor(tokensUsed * 0.3);

  cache.set(input, response, estimatedTokensSaved, context);
  console.log(`[CACHE SET] Response cached, estimated tokens saved: ${estimatedTokensSaved}`);
}

/**
 * Wrapper para ejecutar una funcion con cache automatico.
 * Si hay cache hit, retorna el cache. Si no, ejecuta la funcion y cachea el resultado.
 */
export async function withCache<T>(
  input: string,
  fn: () => Promise<T>,
  serializer: (result: T) => string,
  tokensUsed: number,
  context: string = '',
): Promise<T> {
  // Intentar cache primero
  const cached = tryCacheBeforeResponse(input, context);
  if (cached.hit) {
    // Parsear la respuesta cacheada de vuelta al tipo original
    return JSON.parse(cached.response) as T;
  }

  // Ejecutar la funcion real
  const result = await fn();

  // Cachear el resultado
  const serialized = serializer(result);
  cacheAfterResponse(input, serialized, tokensUsed, context);

  return result;
}

// CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);

  if (args.includes('--before')) {
    const idx = args.indexOf('--before');
    const input = args[idx + 1] || '';
    const contextIdx = args.indexOf('--context');
    const context = contextIdx > -1 ? args[contextIdx + 1] : '';

    const result = tryCacheBeforeResponse(input, context);
    console.log(JSON.stringify(result, null, 2));
  }

  if (args.includes('--after')) {
    const idx = args.indexOf('--after');
    const input = args[idx + 1] || '';
    const response = args[idx + 2] || '';
    const tokensIdx = args.indexOf('--tokens-saved');
    const tokens = tokensIdx > -1 ? parseInt(args[tokensIdx + 1]) : 100;
    const contextIdx = args.indexOf('--context');
    const context = contextIdx > -1 ? args[contextIdx + 1] : '';

    cacheAfterResponse(input, response, tokens, context);
    console.log('[OK] Response cached');
  }

  console.log('\nUso:');
  console.log('  npx tsx src/response-cache-orchestrator.ts --before "input" --context "ctx"');
  console.log(
    '  npx tsx src/response-cache-orchestrator.ts --after "input" "response" --tokens-saved 100',
  );
}
