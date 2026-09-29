#!/usr/bin/env node
/**
 * Session Close Guardian
 *
 * Sistema de protección integrado que:
 * 1. Detecta intentos de cierre manual/informal
 * 2. Bloquea y redirige al orquestador oficial
 * 3. Marca advertencias en el reporte
 * 4. Aprende y registra patrones incorrectos
 *
 * Este módulo se integra en session-close-orchestrator.ts
 * y también protege contra cierres manuales desde Engram u otros sistemas.
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { join, resolve } from 'path';
import { runNpxTsxSync } from '../core/run-command.js';

const ROOT = resolve(process.cwd());
const GUARDIAN_LOG = join(ROOT, '.session', 'guardian-warnings.log');
const INFORMAL_MARKER = join(ROOT, '.session', '.informal-close-attempt');

interface GuardianCheck {
  passed: boolean;
  warning?: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  action: 'ALLOW' | 'BLOCK' | 'REDIRECT';
}

/**
 * Verifica si el cierre está siendo hecho por el orquestador oficial
 */
export function isOrchestratorCall(): boolean {
  // Verificar si el stack trace incluye session-close-orchestrator
  const stack = new Error().stack || '';
  return stack.includes('session-close-orchestrator');
}

/**
 * Detecta intentos de cierre manual/informal
 */
export function detectInformalClosure(): GuardianCheck {
  const checks: GuardianCheck[] = [];

  // Check 1: ¿Se llamó directamente a Engram sin pasar por el orquestador?
  const stack = new Error().stack || '';
  const hasEngramDirect =
    stack.includes('mem_session_end') && !stack.includes('session-close-orchestrator');
  const hasManualSave =
    stack.includes('mem_save') &&
    stack.includes('session') &&
    !stack.includes('session-close-orchestrator');

  if (hasEngramDirect || hasManualSave) {
    checks.push({
      passed: false,
      warning:
        'Intento de cierre manual detectado: llamada directa a Engram sin orquestador oficial',
      severity: 'HIGH',
      action: 'BLOCK',
    });
  }

  // Check 2: ¿Existen markers de cierre informal previo?
  if (existsSync(INFORMAL_MARKER)) {
    checks.push({
      passed: false,
      warning: 'Marker de cierre informal encontrado: sesión previa cerrada incorrectamente',
      severity: 'MEDIUM',
      action: 'REDIRECT',
    });
  }

  // Check 3: ¿Faltan fases del protocolo de cierre?
  const sessionDir = join(ROOT, '.session');
  const hasCloseReport =
    existsSync(join(sessionDir, 'close-report')) ||
    existsSync(join(sessionDir, 'close-report-latest.json'));
  const hasSessionCurrent = existsSync(join(sessionDir, 'session-current.json'));

  if (hasSessionCurrent && !hasCloseReport) {
    // Sesión existe pero no tiene reporte de cierre
    const sessionData = JSON.parse(readFileSync(join(sessionDir, 'session-current.json'), 'utf-8'));
    if (sessionData.status === 'active') {
      checks.push({
        passed: true, // No es un error, pero es inusual
        warning: 'Sesión activa sin reporte de cierre previo',
        severity: 'LOW',
        action: 'ALLOW',
      });
    }
  }

  // Return most severe check
  return (
    checks.sort((a, b) => {
      const severityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    })[0] || {
      passed: true,
      severity: 'LOW',
      action: 'ALLOW',
      warning: undefined,
    }
  );
}

/**
 * Bloquea cierre informal y redirige al orquestador
 */
export function blockAndRedirect(reason: string): never {
  // Marcar intento informal
  writeFileSync(
    INFORMAL_MARKER,
    JSON.stringify({
      timestamp: new Date().toISOString(),
      reason,
      redirecting: true,
    }),
  );

  // Log the attempt
  const logEntry = `[${new Date().toISOString()}] BLOCKED: ${reason}\n`;
  appendFileSync(GUARDIAN_LOG, logEntry);

  // Mostrar mensaje claro
  console.error('\n╔════════════════════════════════════════════════════════╗');
  console.error('║  ⚠️  CIERRE MANUAL DETECTADO - REDIRIGIENDO             ║');
  console.error('╠════════════════════════════════════════════════════════╣');
  console.error(`║  Razón: ${reason.slice(0, 50).padEnd(50)} ║`);
  console.error('║                                                        ║');
  console.error('║  Use el orquestador oficial:                           ║');
  console.error('║    npx tsx src/session/session-close-orchestrator.ts           ║');
  console.error('╚════════════════════════════════════════════════════════╝\n');

  // Ejecutar orquestador automáticamente
  console.log('Ejecutando orquestador oficial...\n');

  const result = runNpxTsxSync(
    'src/session/session-close-orchestrator.ts',
    ['--reason', 'redirected-from-informal'],
    {
      cwd: ROOT,
      stdio: 'inherit',
    },
  );

  process.exit(result.status ?? 0);
}

/**
 * Marca una advertencia en el reporte sin bloquear
 */
export function markWarning(warning: string, severity: 'LOW' | 'MEDIUM' | 'HIGH'): void {
  const marker = {
    type: 'GUARDIAN_WARNING',
    timestamp: new Date().toISOString(),
    warning,
    severity,
    acknowledged: false,
  };

  writeFileSync(join(ROOT, '.session', 'guardian-warnings.json'), JSON.stringify(marker, null, 2));

  console.warn(`\n[GUARDIAN] ⚠️  ${severity}: ${warning}`);
  console.warn('[GUARDIAN] Para completar correctamente, ejecute:');
  console.warn('[GUARDIAN]   npx tsx src/session/session-close-orchestrator.ts\n');
}

/**
 * Guardián principal - llama al inicio de cualquier operación de cierre
 */
export function guardianCheck(): GuardianCheck {
  const check = detectInformalClosure();

  if (!check.passed && check.action === 'BLOCK') {
    blockAndRedirect(check.warning || 'Cierre informal detectado');
  }

  if (!check.passed && check.action === 'REDIRECT') {
    markWarning(check.warning || 'Posible cierre informal previo', check.severity);
  }

  return check;
}

/**
 * Registra aprendizaje del error
 */
export function learnFromMistake(context: string): void {
  const learning = {
    timestamp: new Date().toISOString(),
    type: 'GUARDIAN_LEARNING',
    context,
    lesson: 'Cierre debe pasar por session-close-orchestrator',
    normativa: 'rules/SESSION-CLOSE-NORMATIVA.md',
    resolved: true,
  };

  appendFileSync(GUARDIAN_LOG, JSON.stringify(learning) + '\n');
}

// Auto-check si se importa directamente
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = guardianCheck();
  console.log('[GUARIDAN] Check:', result.passed ? 'PASS' : 'WARNING');
}
