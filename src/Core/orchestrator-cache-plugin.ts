#!/usr/bin/env tsx
/**
 * Orchestrator Cache Plugin
 *
 * Plugin para integrar Response Cache en el orchestrador existente
 * sin modificar el código fuente original.
 *
 * Se registra como:
 * - MCP Server (en opencode.json)
 * - Skill (en el skill registry)
 * - Hook (en config/session-autostart.config.json)
 *
 * Instalación:
 *   1. Agregar a opencode.json mcpServers
 *   2. Agregar a config/session-autostart.config.json como step
 *   3. Importar en src/session/session-autostart.ts (opcional pero recomendado)
 */

import { ResponseCache } from '../resilience/response-cache.js';
import { pathToFileURL } from 'url';
import { mkdirSync, appendFileSync } from 'fs';
import { join, resolve } from 'path';

// ─── Configuration ──────────────────────────────────────────────────────────
const CACHE_CONFIG = {
  enabled: true,
  logHits: true,
  logMisses: true,
  autoCleanup: true,
  cleanupInterval: 3600, // Segundos
  hitRateTarget: 25, // %
};

// ─── State ──────────────────────────────────────────────────────────────────
let cache: ResponseCache | null = null;
let stats = {
  totalCalls: 0,
  cacheHits: 0,
  cacheMisses: 0,
  tokensGenerated: 0,
  tokensSaved: 0,
  hitRate: 0,
};

const LOG_FILE = join(resolve(process.cwd()), '.logs', 'orchestrator-cache-plugin.log');

function log(message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;

  console.log(line.trim());

  try {
    mkdirSync(join(resolve(process.cwd()), '.logs'), { recursive: true });
    appendFileSync(LOG_FILE, line, 'utf-8');
  } catch {
    // Non-fatal
  }
}

// ─── Plugin API ─────────────────────────────────────────────────────────────

/**
 * Inicializa el plugin de cache.
 * Debe llamarse al inicio de cada sesión.
 */
export function initOrchestratorCachePlugin(): boolean {
  if (cache) {
    log('[PLUGIN] Cache already initialized');
    return true;
  }

  try {
    cache = new ResponseCache({ enabled: true, defaultTtlMinutes: 60 });

    // Setup auto-cleanup
    if (CACHE_CONFIG.autoCleanup) {
      setInterval(() => {
        if (cache) {
          const cleaned = cache.cleanup();
          if (cleaned > 0) {
            log(`[PLUGIN] Auto-cleanup: ${cleaned} expired entries removed`);
          }
        }
      }, CACHE_CONFIG.cleanupInterval * 1000);
    }

    log('[PLUGIN] Orchestrator cache plugin initialized successfully');
    return true;
  } catch (err) {
    log(`[PLUGIN] Failed to initialize: ${err}`);
    return false;
  }
}

/**
 * Genera key de cache normalizada.
 */
function generateKey(input: string, context: string = ''): string {
  // Normalizar input (remover espacios extras, lowercase)
  const normalized = input.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 300); // Limitar a 300 chars

  return context ? `${context}:${normalized}` : normalized;
}

/**
 * Intercepta una llamada al orchestrator.
 * Esta función debe ser llamada ANTES de cualquier procesamiento.
 *
 * @returns { cached: boolean, response?: string, tokensSaved?: number }
 */
export function interceptBeforeOrchestrator(
  input: string,
  context: string = '',
): { cached: boolean; response?: string; tokensSaved?: number } {
  if (!CACHE_CONFIG.enabled) {
    return { cached: false };
  }

  if (!cache) {
    const initialized = initOrchestratorCachePlugin();
    if (!initialized) {
      return { cached: false };
    }
  }

  const key = generateKey(input, context);
  const cached = cache!.get(key, context);

  stats.totalCalls++;

  if (cached) {
    stats.cacheHits++;
    stats.tokensSaved += cached.tokensSaved;

    if (CACHE_CONFIG.logHits) {
      log(`[HIT] Cache hit! Saved ${cached.tokensSaved} tokens`);
    }

    return {
      cached: true,
      response: cached.response,
      tokensSaved: cached.tokensSaved,
    };
  }

  stats.cacheMisses++;

  if (CACHE_CONFIG.logMisses) {
    log('[MISS] Cache miss - will generate new response');
  }

  return { cached: false };
}

/**
 * Guarda una respuesta en el cache.
 * Esta función debe ser llamada DESPUÉS de recibir la respuesta.
 */
export function interceptAfterOrchestrator(
  input: string,
  response: string,
  tokensUsed: number,
  context: string = '',
): void {
  if (!CACHE_CONFIG.enabled || !cache) {
    return;
  }

  const key = generateKey(input, context);

  // Calcular tokens ahorrados (estimación: 30% del costo total)
  const tokensSaved = Math.floor(tokensUsed * 0.3);

  cache.set(key, response, tokensSaved, context);

  stats.tokensGenerated += tokensUsed;
  stats.tokensSaved += tokensSaved;

  // Update hit rate
  if (stats.totalCalls > 0) {
    stats.hitRate = (stats.cacheHits / stats.totalCalls) * 100;
  }

  log(`[SET] Response cached (key: ${key.slice(0, 50)}...)`);

  // Check if target hit rate achieved
  if (stats.hitRate >= CACHE_CONFIG.hitRateTarget && stats.totalCalls > 10) {
    log(`[TARGET] Hit rate target achieved: ${stats.hitRate.toFixed(1)}%`);
  }
}

/**
 * Obtiene estadísticas del plugin.
 */
export function getPluginStats(): typeof stats {
  return { ...stats };
}

/**
 * Limpia el cache.
 */
export function clearPluginCache(): void {
  if (cache) {
    cache.clear();
    stats = {
      totalCalls: 0,
      cacheHits: 0,
      cacheMisses: 0,
      tokensGenerated: 0,
      tokensSaved: 0,
      hitRate: 0,
    };
    log('[PLUGIN] Cache cleared');
  }
}

/**
 * Habilita/deshabilita el plugin.
 */
export function setPluginEnabled(enabled: boolean): void {
  CACHE_CONFIG.enabled = enabled;
  log(`[PLUGIN] Cache ${enabled ? 'enabled' : 'disabled'}`);
}

// ─── Auto-initialization ────────────────────────────────────────────────────
// Se ejecuta al importar el módulo
if (typeof process !== 'undefined') {
  initOrchestratorCachePlugin();
}

// ─── CLI ────────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);

  if (args.includes('--stats')) {
    const s = getPluginStats();
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║  Orchestrator Cache Plugin Statistics  ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`Total Calls:      ${s.totalCalls}`);
    console.log(`Cache Hits:       ${s.cacheHits}`);
    console.log(`Cache Misses:     ${s.cacheMisses}`);
    console.log(`Hit Rate:         ${s.hitRate.toFixed(2)}%`);
    console.log(`Tokens Generated: ${s.tokensGenerated}`);
    console.log(`Tokens Saved:     ${s.tokensSaved}`);
    console.log(
      `Net Savings:      ${((s.tokensSaved / (s.tokensGenerated || 1)) * 100).toFixed(1)}%`,
    );
    console.log('');
  }

  if (args.includes('--clear')) {
    clearPluginCache();
    console.log('[OK] Cache cleared');
  }

  if (args.includes('--disable')) {
    setPluginEnabled(false);
    console.log('[OK] Plugin disabled');
  }

  if (args.includes('--enable')) {
    setPluginEnabled(true);
    console.log('[OK] Plugin enabled');
  }

  if (args.length === 0) {
    console.log('\nUso: npx tsx src/core/orchestrator-cache-plugin.ts [OPTIONS]');
    console.log('');
    console.log('Opciones:');
    console.log('  --stats     Mostrar estadísticas');
    console.log('  --clear     Limpiar cache');
    console.log('  --enable    Habilitar plugin');
    console.log('  --disable   Deshabilitar plugin');
    console.log('');
  }
}
