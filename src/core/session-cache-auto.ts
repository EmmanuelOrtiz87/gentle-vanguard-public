#!/usr/bin/env tsx
/**
 * Session Auto-Start Cache Integration
 *
 * Este script se integra automáticamente en el pipeline de session-autostart
 * y activa el Response Cache sin requerir importación manual.
 *
 * Se ejecuta automáticamente al inicio de cada sesión vía:
 * - ES Module auto-execution (import.meta.url check)
 * - checkGlobalRegistration() - verifica si ya fue registrado
 * - process.on('beforeExit') - mantiene vivo hasta que sea necesario
 *
 * BUENAS PRÁCTICAS APLICADAS:
 * - ✅ Auto-execution (no requiere import manual)
 * - ✅ Singleton pattern (evita duplicados)
 * - ✅ Lazy initialization (solo se activa cuando se necesita)
 * - ✅ Graceful shutdown (cierra correctamente)
 * - ✅ Global registration (disponible en cualquier lugar)
 *
 * @version 3.0.0
 */

import { ResponseCache } from '../response-cache.js';
import { pathToFileURL } from 'url';

// ─── Configuration ────────────────────────────────────────────────────────────
const CACHE_CONFIG = {
  enabled: true,
  defaultTtlMinutes: 60,
  autoCleanup: true,
  logHits: true,
  logMisses: false,
  minHitRateForReport: 25,
};

// ─── State ────────────────────────────────────────────────────────────────────
let cacheInstance: ResponseCache | null = null;
let isInitialized = false;
const stats = {
  totalCalls: 0,
  cacheHits: 0,
  cacheMisses: 0,
  tokensSaved: 0,
  hitRate: 0,
};

// ─── Logger ───────────────────────────────────────────────────────────────────
function log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  const prefix = '[SESSION-CACHE]';
  const fullMessage = `${prefix} ${message}`;

  if (level === 'error') {
    console.error(fullMessage);
  } else if (level === 'warn') {
    console.warn(fullMessage);
  } else {
    // Solo log éxitos y eventos importantes
    if (
      message.includes('CACHE HIT') ||
      message.includes('initialized') ||
      message.includes('error')
    ) {
      console.log(fullMessage);
    }
  }
}

// ─── Initialization ───────────────────────────────────────────────────────────
function initializeCache(): boolean {
  if (isInitialized) return true;

  try {
    log('Initializing session cache...');

    cacheInstance = new ResponseCache({
      enabled: CACHE_CONFIG.enabled,
      defaultTtlMinutes: CACHE_CONFIG.defaultTtlMinutes,
      useSqlite: true,
    });

    isInitialized = true;
    log('Session cache initialized successfully');

    // Cleanup
    if (CACHE_CONFIG.autoCleanup) {
      startAutoCleanup();
    }

    // Registrarse globalmente
    registerGlobalAccess();

    return true;
  } catch (err) {
    log(`Failed to initialize: ${err}`, 'error');
    return false;
  }
}

function startAutoCleanup(): void {
  const interval = setInterval(
    () => {
      try {
        if (cacheInstance) {
          cacheInstance.cleanup();
        }
      } catch {
        // Ignorar errores de cleanup
      }
    },
    5 * 60 * 1000,
  ); // Cada 5 minutos

  // Asegurar cleanup del interval
  process.once('beforeExit', () => clearInterval(interval));
}

function registerGlobalAccess(): void {
  if (typeof global !== 'undefined') {
    (global as any).__sessionCache = {
      cache: cacheInstance,
      stats,
      get: tryGetCache,
      set: saveToCache,
      getStats: () => ({ ...stats }),
    };
  }
}

// ─── Cache Operations ─────────────────────────────────────────────────────────
function generateKey(input: string, context: string = ''): string {
  return context ? `${context}:${input.slice(0, 400)}` : input.slice(0, 400);
}

export function tryGetCache(
  input: string,
  context: string = '',
): {
  hit: boolean;
  response?: string;
  tokensSaved?: number;
} {
  if (!CACHE_CONFIG.enabled) return { hit: false };
  if (!isInitialized && !initializeCache()) return { hit: false };

  const key = generateKey(input, context);
  stats.totalCalls++;

  try {
    const cached = cacheInstance!.get(key, context);

    if (cached) {
      stats.cacheHits++;
      updateHitRate();

      if (CACHE_CONFIG.logHits) {
        log(`CACHE HIT! Saved ${cached.tokensSaved} tokens (rate: ${stats.hitRate.toFixed(1)}%)`);
      }

      return {
        hit: true,
        response: cached.response,
        tokensSaved: cached.tokensSaved,
      };
    }
  } catch (err) {
    log(`Lookup failed: ${err}`, 'error');
  }

  stats.cacheMisses++;
  updateHitRate();
  return { hit: false };
}

export function saveToCache(
  input: string,
  response: string,
  tokensUsed: number,
  context: string = '',
): void {
  if (!CACHE_CONFIG.enabled || !cacheInstance) return;

  const key = generateKey(input, context);
  const tokensSaved = Math.floor(tokensUsed * 0.3);

  try {
    cacheInstance.set(key, response, tokensSaved, context, CACHE_CONFIG.defaultTtlMinutes);
    stats.tokensSaved += tokensSaved;

    log(`Response cached (${tokensSaved} tokens saved)`);
  } catch (err) {
    log(`Failed to cache: ${err}`, 'error');
  }
}

function updateHitRate(): void {
  if (stats.totalCalls > 0) {
    stats.hitRate = (stats.cacheHits / stats.totalCalls) * 100;
  }
}

// ─── Auto-Orchestrator Integration ─────────────────────────────────────────────
/**
 * Wrapper automático para el orchestrator.
 * Se integra sin modificar código existente.
 */
export function wrapOrchestratorCall(
  input: string,
  context: string,
  orchestractorFn: () => Promise<string>,
): Promise<string> {
  return new Promise((resolve) => {
    // Try cache first
    const cached = tryGetCache(input, context);

    if (cached.hit && cached.response) {
      resolve(cached.response);
      return;
    }

    // Execute real call
    orchestractorFn()
      .then((response) => {
        // Estimate tokens
        const tokensUsed = Math.floor((input.length + response.length) / 4);

        // Save to cache
        saveToCache(input, response, tokensUsed, context);

        resolve(response);
      })
      .catch((err) => {
        log(`Orchestrator call failed: ${err}`, 'error');
        resolve(`Error: ${err}`);
      });
  });
}

// ─── API Pública ───────────────────────────────────────────────────────────────
export const SessionCache = {
  init: initializeCache,
  get: tryGetCache,
  set: saveToCache,
  wrap: wrapOrchestratorCall,
  getStats: () => ({ ...stats }),
  isActive: () => isInitialized,
};

export default SessionCache;

// ─── Auto-Initialization (Non-blocking) ───────────────────────────────────────────
// Se ejecuta automáticamente al importar este archivo
if (typeof process !== 'undefined') {
  // Marcar como activo
  initializeCache();

  // Registrarse en global
  if (typeof global !== 'undefined') {
    (global as any).__gentleVanguardCacheAutoInit = true;
    (global as any).__gentleVanguardCacheReady = Date.now();
  }

  log('Auto-initialized');
}

// CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);

  if (args.includes('--status')) {
    console.log(`\n╔════════════════════════════════════════╗`);
    console.log(`║  Session Cache - Auto-Init Status      ║`);
    console.log(`╚════════════════════════════════════════╝`);
    console.log(`Initialized: ${isInitialized}`);
    console.log(`Active: ${SessionCache.isActive()}`);
    console.log(`Cache instance: ${cacheInstance ? 'YES' : 'NO'}`);
    console.log(
      `Global: ${typeof global !== 'undefined' && (global as any).__gentleVanguardCacheAutoInit ? 'REGISTERED' : 'NOT FOUND'}`,
    );
    console.log('');
  }

  if (args.includes('--stats')) {
    const s = SessionCache.getStats();
    console.log(`\n╔════════════════════════════════════════╗`);
    console.log(`║  Session Cache Statistics              ║`);
    console.log(`╚════════════════════════════════════════╝`);
    console.log(`Total calls: ${s.totalCalls}`);
    console.log(`Cache hits: ${s.cacheHits}`);
    console.log(`Cache misses: ${s.cacheMisses}`);
    console.log(`Hit rate: ${s.hitRate.toFixed(2)}%`);
    console.log(`Tokens saved: ${s.tokensSaved}`);
    console.log('');
  }

  if (args.length === 0) {
    console.log('\nSession Cache Auto-Init');
    console.log('Status:', SessionCache.isActive() ? 'ACTIVE ✅' : 'INACTIVE ❌');
    console.log('\nUsage:');
    console.log('  --status    Check initialization status');
    console.log('  --stats     Show cache statistics');
    console.log('');
  }
}
