#!/usr/bin/env node
/**
 * Session Validator - Validaciones inteligentes de sesión
 *
 * Proporciona validaciones para el ciclo de vida de sesión:
 * - Verificar si existe sesión activa (archivo + Nexus)
 * - Detectar inicio dentro de sesión existente
 * - Registrar recursos iniciados para cierre selectivo
 * - Validar consistencia entre archivo y Nexus
 *
 * Uso:
 *   npx tsx src/session/session-validator.ts check
 *   npx tsx src/session/session-validator.ts register-resource --type daemon --name "codegraph-mcp"
 *   npx tsx src/session/session-validator.ts get-inventory
 *   npx tsx src/session/session-validator.ts validate-close
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

const ROOT = resolve(process.cwd());
const SESSION_DIR = join(ROOT, '.session');
const SESSION_FILE = join(SESSION_DIR, 'session-current.json');

export interface SessionResources {
  daemonsStarted: string[];
  skillsActivated: string[];
  lazyStepsLaunched: string[];
  cachesInitialized: string[];
  checkpointsCreated: string[];
}

export interface SessionValidation {
  hasActiveSession: boolean;
  sessionFileExists: boolean;
  nexusHasActive: boolean;
  isSameAgent: boolean;
  isNestedSession: boolean;
  sessionAge: number; // minutes
  sessionId: string | null;
  status: string | null;
}

export interface ValidationResult {
  valid: boolean;
  validation: SessionValidation;
  recommendation: 'proceed' | 'reuse' | 'skip' | 'cleanup-first';
  message: string;
}

/**
 * Lee el archivo de sesión actual
 */
function readSessionFile(): Record<string, unknown> | null {
  if (!existsSync(SESSION_FILE)) return null;
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Verifica si hay sesión activa en Nexus (archivo simple)
 * Returns false if cannot verify (non-blocking)
 */
function checkNexusActiveSession(): boolean {
  // Simplified: check if there's a recent lock file from another session
  const lockFile = join(ROOT, '.runtime', 'session-autostart.lock');
  if (existsSync(lockFile)) {
    try {
      const content = readFileSync(lockFile, 'utf-8');
      const lock = JSON.parse(content);
      const lockAge = Date.now() - (lock.timestamp || 0);
      // If lock is less than 30 min old and not from current process
      if (lockAge < 30 * 60 * 1000 && lock.pid !== process.pid) {
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

/**
 * Valida el estado actual de la sesión
 */
export async function validateSession(): Promise<ValidationResult> {
  const sessionData = readSessionFile();

  const validation: SessionValidation = {
    hasActiveSession: false,
    sessionFileExists: false,
    nexusHasActive: false,
    isSameAgent: false,
    isNestedSession: false,
    sessionAge: 0,
    sessionId: null,
    status: null,
  };

  // 1. Check session file
  if (sessionData) {
    validation.sessionFileExists = true;
    validation.sessionId = (sessionData.sessionId as string) || (sessionData.id as string);
    validation.status = sessionData.status as string;

    const startTime = sessionData.startTime
      ? new Date(sessionData.startTime as string).getTime()
      : Date.now();
    validation.sessionAge = Math.floor((Date.now() - startTime) / 60000);

    // Check if active
    if (validation.status === 'active' && validation.sessionAge < 120) {
      // < 2 hours
      validation.hasActiveSession = true;
    }

    // Check if same agent (check environment or tool)
    const currentAgent = process.env.GENTLE_VANGUARD_SESSION_ID;
    if (currentAgent && currentAgent === validation.sessionId) {
      validation.isSameAgent = true;
    }

    // Check if nested (started within existing session)
    const parentSession = sessionData.parentSessionId;
    if (parentSession) {
      validation.isNestedSession = true;
    }
  }

  // 2. Check Nexus (via lock file - non-blocking)
  validation.nexusHasActive = checkNexusActiveSession();

  // 3. Determine recommendation
  let recommendation: ValidationResult['recommendation'] = 'proceed';
  let message = '';

  if (validation.hasActiveSession && validation.isSameAgent) {
    recommendation = 'reuse';
    message = `Active session exists (${validation.sessionId}), same agent detected - reusing`;
  } else if (validation.hasActiveSession && !validation.isSameAgent) {
    recommendation = 'cleanup-first';
    message = `Active session exists from different agent - cleanup required first`;
  } else if (validation.isNestedSession) {
    recommendation = 'reuse';
    message = 'Nested session detected - using parent session';
  } else if (validation.sessionFileExists && !validation.hasActiveSession) {
    recommendation = 'cleanup-first';
    message = 'Stale session file exists - cleanup required';
  } else {
    message = 'No active session - proceeding with new session';
  }

  return {
    valid: recommendation !== 'cleanup-first',
    validation,
    recommendation,
    message,
  };
}

/**
 * Registra un recurso iniciado en la sesión
 */
export function registerResource(
  type: 'daemon' | 'skill' | 'lazyStep' | 'cache' | 'checkpoint',
  name: string,
): boolean {
  try {
    const sessionData = readSessionFile();
    if (!sessionData) {
      console.warn('[SESSION-VALIDATOR] No session file to register resource');
      return false;
    }

    // Initialize resources object
    if (!sessionData.sessionResources) {
      sessionData.sessionResources = {
        daemonsStarted: [],
        skillsActivated: [],
        lazyStepsLaunched: [],
        cachesInitialized: [],
        checkpointsCreated: [],
      };
    }

    const resources = sessionData.sessionResources as SessionResources;

    switch (type) {
      case 'daemon':
        if (!resources.daemonsStarted.includes(name)) {
          resources.daemonsStarted.push(name);
        }
        break;
      case 'skill':
        if (!resources.skillsActivated.includes(name)) {
          resources.skillsActivated.push(name);
        }
        break;
      case 'lazyStep':
        if (!resources.lazyStepsLaunched.includes(name)) {
          resources.lazyStepsLaunched.push(name);
        }
        break;
      case 'cache':
        if (!resources.cachesInitialized.includes(name)) {
          resources.cachesInitialized.push(name);
        }
        break;
      case 'checkpoint':
        if (!resources.checkpointsCreated.includes(name)) {
          resources.checkpointsCreated.push(name);
        }
        break;
    }

    // Save updated session
    writeFileSync(SESSION_FILE, JSON.stringify(sessionData, null, 2));
    console.log(`[SESSION-VALIDATOR] Registered ${type}: ${name}`);
    return true;
  } catch (e) {
    console.warn('[SESSION-VALIDATOR] Failed to register resource:', e);
    return false;
  }
}

/**
 * Obtiene el inventario de recursos de la sesión
 */
export function getInventory(): SessionResources | null {
  const sessionData = readSessionFile();
  if (!sessionData?.sessionResources) return null;
  return sessionData.sessionResources as SessionResources;
}

/**
 * Genera lo que debe cerrarse basado en el inventario
 */
export function getResourcesToClose(): string[] {
  const inventory = getInventory();
  if (!inventory) return [];

  const toClose: string[] = [];

  // Add all registered resources
  toClose.push(...inventory.daemonsStarted);
  toClose.push(...inventory.skillsActivated);
  toClose.push(...inventory.lazyStepsLaunched);
  toClose.push(...inventory.cachesInitialized);
  // Note: checkpoints should NOT be closed

  return [...new Set(toClose)]; // Deduplicate
}

/**
 * Valida que el cierre sea seguro
 */
export async function validateClose(): Promise<{
  safe: boolean;
  resourcesToClose: string[];
  resourcesToKeep: string[];
  message: string;
}> {
  const inventory = getInventory();
  const validation = await validateSession();

  if (!validation.valid) {
    return {
      safe: false,
      resourcesToClose: [],
      resourcesToKeep: [],
      message: `Cannot close: ${validation.message}`,
    };
  }

  const resourcesToClose = getResourcesToClose();
  const resourcesToKeep = inventory?.checkpointsCreated || [];

  return {
    safe: true,
    resourcesToClose,
    resourcesToKeep,
    message: `Close validated. Will close: ${resourcesToClose.join(', ') || 'none'}`,
  };
}

// CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'check') {
    void validateSession().then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.valid ? 0 : 1);
    });
  } else if (command === 'register-resource') {
    const typeIndex = args.indexOf('--type');
    const nameIndex = args.indexOf('--name');

    if (typeIndex === -1 || nameIndex === -1) {
      console.error(
        'Usage: register-resource --type <daemon|skill|lazyStep|cache|checkpoint> --name <name>',
      );
      process.exit(1);
    }

    const type = args[typeIndex + 1] as 'daemon' | 'skill' | 'lazyStep' | 'cache' | 'checkpoint';
    const name = args[nameIndex + 1];

    const success = registerResource(type, name);
    process.exit(success ? 0 : 1);
  } else if (command === 'get-inventory') {
    const inventory = getInventory();
    console.log(JSON.stringify(inventory, null, 2));
    process.exit(0);
  } else if (command === 'validate-close') {
    void validateClose().then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.safe ? 0 : 1);
    });
  } else {
    console.log('Session Validator');
    console.log('');
    console.log('Commands:');
    console.log('  check                    - Validate current session state');
    console.log('  register-resource        - Register a resource started in session');
    console.log('  get-inventory            - Show resources registered in session');
    console.log('  validate-close           - Validate that close is safe');
    console.log('');
    console.log('Examples:');
    console.log('  npx tsx src/session/session-validator.ts check');
    console.log(
      '  npx tsx src/session/session-validator.ts register-resource --type daemon --name "codegraph-mcp"',
    );
    console.log('  npx tsx src/session/session-validator.ts get-inventory');
    process.exit(1);
  }
}
