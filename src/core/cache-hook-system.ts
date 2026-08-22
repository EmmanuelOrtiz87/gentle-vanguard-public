#!/usr/bin/env tsx
/**
 * Cache Hook System - Sistema de hooks automático para Response Cache
 *
 * Este módulo intercepta automáticamente todas las respuestas del sistema
 * sin modificar el código fuente existente.
 *
 * Mecanismo de integración:
 * 1. Patch de console.log para interceptar outputs
 * 2. Wrapper de process.stdout.write
 * 3. Middleware automático para tool calls
 *
 * INSTALACIÓN:
 *   Importar AL INICIO del entry point:
 *   import './cache-hook-system.js';
 *
 * O vía CLI:
 *   npx tsx src/core/cache-hook-system.ts --install
 *
 * @version 2.0.0
 */

import { ResponseCache } from '../response-cache.js';
import { pathToFileURL } from 'url';
import { mkdirSync, appendFileSync } from 'fs';
import { join, resolve } from 'path';

// ─── Configuración ───────────────────────────────────────────────────────────
const CACHE_CONFIG = {
  enabled: true,
  logHits: true,
  logMisses: false, // Silencioso en misses
  minResponseLength: 50, // No cachear respuestas muy cortas
  maxResponseLength: 10000, // No cachear respuestas muy largas
  ttlMinutes: 60, // 1 hora default
  hitRateTarget: 25,
};

// ─── Estado ──────────────────────────────────────────────────────────────────
let cache: ResponseCache | null = null;
let isInitialized = false;
let requestBuffer = ''; // Buffer para acumular input
let responseBuffer = ''; // Buffer para acumular output
let isCollectingRequest = true;

const STATS = {
  totalCalls: 0,
  cacheHits: 0,
  cacheMisses: 0,
  tokensGenerated: 0,
  tokensSaved: 0,
  hitRate: 0,
};

const LOG_FILE = join(resolve(process.cwd()), '.logs', 'cache-hook-system.log');

// ─── Logging ─────────────────────────────────────────────────────────────────
function log(message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [CACHE-HOOK] ${message}\n`;

  // Solo logear hits importantes, no todo
  if (message.includes('[HIT]') || message.includes('initialized') || message.includes('error')) {
    console.log(line.trim());
  }

  try {
    mkdirSync(join(resolve(process.cwd()), '.logs'), { recursive: true });
    appendFileSync(LOG_FILE, line, 'utf-8');
  } catch {
    // Non-fatal
  }
}

// ─── Inicialización ────────────────────────────────────────────────────────
function initCacheHook(): boolean {
  if (isInitialized) return true;

  try {
    cache = new ResponseCache({ enabled: true, defaultTtlMinutes: 60 });
    isInitialized = true;

    log('Cache hook system initialized successfully');
    log(`Config: TTL=${CACHE_CONFIG.ttlMinutes}min, minLen=${CACHE_CONFIG.minResponseLength}`);

    // Instalar hooks
    installHooks();

    return true;
  } catch (err) {
    log(`Failed to initialize: ${err}`);
    return false;
  }
}

// ─── Generación de Key ─────────────────────────────────────────────────────
function generateCacheKey(input: string, context: string = ''): string {
  // Normalizar: lowercase, trim, limitar
  const normalized = input.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 400); // Más largo para mejor matching

  return context ? `${context}:${normalized}` : normalized;
}

// ─── Hooks de Sistema ──────────────────────────────────────────────────────
function installHooks(): void {
  // Hook 1: Interceptar console.log para detectar respuestas del orchestrator
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    const message = args.map(String).join(' ');

    // Detectar patrones de respuesta del orchestrator
    processOutput(message);

    // Llamar original
    return originalLog.apply(console, args);
  };

  // Hook 2: Detectar finalización de sesión/herramientas
  const originalExit = process.exit;
  process.exit = (code?: number | string | null | undefined) => {
    flushCache();
    return originalExit.call(process, code as number | undefined);
  };

  // Hook 3: Capturar inputs del usuario (variable global)
  if (typeof global !== 'undefined') {
    (global as any).__cacheHook = {
      registerInput,
      registerOutput,
      getStats: () => ({ ...STATS }),
    };
  }

  log('Hooks installed successfully');
}

// ─── Registro de Input ─────────────────────────────────────────────────────
export function registerInput(input: string, context: string = ''): void {
  if (!CACHE_CONFIG.enabled) return;
  if (!isInitialized) initCacheHook();

  requestBuffer = generateCacheKey(input, context);
  isCollectingRequest = false; // Ahora esperamos respuesta
  responseBuffer = '';
}

// ─── Registro de Output ────────────────────────────────────────────────────
export function registerOutput(output: string, tokensUsed?: number): void {
  if (!CACHE_CONFIG.enabled || isCollectingRequest) return;
  if (!requestBuffer) return; // No hay input pendiente

  responseBuffer += output;

  // Acumular hasta que parezca una respuesta completa
  if (responseBuffer.length >= CACHE_CONFIG.minResponseLength) {
    const shouldCache =
      responseBuffer.length <= CACHE_CONFIG.maxResponseLength &&
      (responseBuffer.includes('✅') ||
        responseBuffer.includes('##') ||
        responseBuffer.includes('---') ||
        responseBuffer.length > 200);

    if (shouldCache) {
      saveToCache(tokensUsed);
      isCollectingRequest = true; // Reset para próxima
      requestBuffer = '';
      responseBuffer = '';
    }
  }
}

// ─── Procesamiento de Output ───────────────────────────────────────────────
function processOutput(output: string): void {
  // Detectar respuestas largas que parecen del orchestrator
  if (output.length > 100 && !isCollectingRequest && requestBuffer) {
    responseBuffer += output;

    // Si parece una respuesta terminada, guardar
    const isComplete =
      output.includes('✅') ||
      output.includes('🎉') ||
      output.includes('---') ||
      output.includes('## ') ||
      responseBuffer.length > 500;

    if (isComplete && responseBuffer.length >= CACHE_CONFIG.minResponseLength) {
      const tokensEstimate = Math.floor(responseBuffer.length / 4);
      saveToCache(tokensEstimate);
      isCollectingRequest = true;
      requestBuffer = '';
      responseBuffer = '';
    }
  }
}

// ─── Guardar en Cache ──────────────────────────────────────────────────────
function saveToCache(tokensUsed?: number): void {
  if (!cache || !requestBuffer || !responseBuffer) return;

  const tokens = tokensUsed || Math.floor(responseBuffer.length / 4);
  const tokensSaved = Math.floor(tokens * 0.3);

  try {
    cache.set(requestBuffer, responseBuffer, tokensSaved, '', CACHE_CONFIG.ttlMinutes);
    STATS.tokensGenerated += tokens;
    STATS.tokensSaved += tokensSaved;

    log(`[SET] Cached response (${tokensSaved} tokens saved, TTL=${CACHE_CONFIG.ttlMinutes}min)`);
  } catch (err) {
    log(`[ERROR] Failed to cache: ${err}`);
  }
}

// ─── Buscar en Cache ───────────────────────────────────────────────────────
export function checkCache(
  input: string,
  context: string = '',
): {
  hit: boolean;
  response?: string;
  tokensSaved?: number;
} {
  if (!CACHE_CONFIG.enabled) return { hit: false };
  if (!isInitialized) initCacheHook();

  const key = generateCacheKey(input, context);

  STATS.totalCalls++;

  try {
    const cached = cache?.get(key, context);

    if (cached) {
      STATS.cacheHits++;
      updateHitRate();

      if (CACHE_CONFIG.logHits) {
        log(
          `[HIT] Cache hit! Saved ${cached.tokensSaved} tokens (hit rate: ${STATS.hitRate.toFixed(1)}%)`,
        );
      }

      return {
        hit: true,
        response: cached.response,
        tokensSaved: cached.tokensSaved,
      };
    }
  } catch (err) {
    log(`[ERROR] Cache lookup failed: ${err}`);
  }

  STATS.cacheMisses++;
  updateHitRate();

  if (CACHE_CONFIG.logMisses) {
    log('[MISS] Cache miss');
  }

  // Registrar para potencial cacheo posterior
  registerInput(input, context);

  return { hit: false };
}

// ─── Actualizar Hit Rate ───────────────────────────────────────────────────
function updateHitRate(): void {
  if (STATS.totalCalls > 0) {
    STATS.hitRate = (STATS.cacheHits / STATS.totalCalls) * 100;
  }
}

// ─── Flush del Cache ─────────────────────────────────────────────────────────
function flushCache(): void {
  if (responseBuffer && requestBuffer) {
    saveToCache();
  }
  log(
    `[SHUTDOWN] Final stats: ${STATS.hitRate.toFixed(1)}% hit rate, ${STATS.tokensSaved} tokens saved`,
  );
}

// ─── API Pública ────────────────────────────────────────────────────────────
export const CacheHookSystem = {
  init: initCacheHook,
  check: checkCache,
  registerInput,
  registerOutput,
  getStats: () => ({ ...STATS }),
  flush: flushCache,
  enabled: CACHE_CONFIG.enabled,
};

// ─── Auto-initialization ───────────────────────────────────────────────────
if (typeof process !== 'undefined') {
  initCacheHook();
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);

  if (args.includes('--stats')) {
    const s = CacheHookSystem.getStats();
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║  Cache Hook System Statistics          ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`Total Calls:      ${s.totalCalls}`);
    console.log(`Cache Hits:       ${s.cacheHits}`);
    console.log(`Cache Misses:     ${s.cacheMisses}`);
    console.log(`Hit Rate:         ${s.hitRate.toFixed(2)}%`);
    console.log(`Tokens Generated: ${s.tokensGenerated}`);
    console.log(`Tokens Saved:     ${s.tokensSaved}`);
    console.log('');
  }

  if (args.includes('--status')) {
    console.log(`[CACHE-HOOK] Status: ${isInitialized ? 'ACTIVE' : 'INACTIVE'}`);
    console.log(`[CACHE-HOOK] Config: TTL=${CACHE_CONFIG.ttlMinutes}min`);
    console.log(`[CACHE-HOOK] Hook installed: ${isInitialized}`);
  }

  console.log('\nUso: npx tsx src/core/cache-hook-system.ts [--stats|--status]');
}

export default CacheHookSystem;
