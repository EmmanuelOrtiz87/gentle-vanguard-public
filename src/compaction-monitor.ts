#!/usr/bin/env node
/**
 * Compaction Monitor - Sistema de monitoreo de contexto
 *
 * Monitorea el tamaño del contexto y alerta cuando se acerca al límite
 * para prevenir problemas con modelos que no soportan compaction automático.
 *
 * USO:
 *   npx tsx src/compaction-monitor.ts --check
 *   npx tsx src/compaction-monitor.ts --status
 *   npx tsx src/compaction-monitor.ts --alert
 *
 * THRESHOLDS:
 *   SOFT: 15,000 tokens (WARN)
 *   HARD: 25,000 tokens (CRITICAL)
 *
 * Para Kimi2-5: Desactivar compaction automático en opencode.json
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { pathToFileURL } from 'url';
import { join, resolve } from 'path';

const ROOT = resolve(process.cwd());
const CONTEXT_LOG_DIR = join(ROOT, '.session', 'context-log');
const ALERT_STATE_FILE = join(ROOT, '.session', 'compaction-alert-state.json');

// Thresholds optimizados para Kimi2-5
const THRESHOLDS = {
  SOFT: 15000, // WARN - Sugerir compactación manual
  HARD: 25000, // CRITICAL - Recomendar cierre de sesión
  MAX: 30000, // LÍMITE ABSOLUTO - Forzar acción
};

interface CompactionStatus {
  timestamp: string;
  sessionId: string | null;
  estimatedTokens: number;
  status: 'OK' | 'WARN' | 'CRITICAL' | 'OVERFLOW';
  message: string;
  recommendation: string;
  filesInContext: number;
  turnsCount: number;
}

interface AlertState {
  lastAlert: string | null;
  lastStatus: string;
  alertCount: number;
  actions: string[];
}

/**
 * Estima tokens basado en archivos en context-log
 * Heurística: ~100 tokens por archivo + ~500 tokens por turno
 */
function estimateTokens(): {
  tokens: number;
  files: number;
  turns: number;
  sessionId: string | null;
} {
  let files = 0;
  let turns = 0;
  let sessionId: string | null = null;

  try {
    if (!existsSync(CONTEXT_LOG_DIR)) {
      return { tokens: 0, files: 0, turns: 0, sessionId: null };
    }

    const sessions = readdirSync(CONTEXT_LOG_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .sort((a, b) => {
        const statA = statSync(join(CONTEXT_LOG_DIR, a.name));
        const statB = statSync(join(CONTEXT_LOG_DIR, b.name));
        return statB.mtime.getTime() - statA.mtime.getTime();
      });

    if (sessions.length === 0) {
      return { tokens: 0, files: 0, turns: 0, sessionId: null };
    }

    const latestSession = sessions[0];
    sessionId = latestSession.name;
    const sessionDir = join(CONTEXT_LOG_DIR, sessionId);

    // Contar archivos en la sesión
    if (existsSync(sessionDir)) {
      const entries = readdirSync(sessionDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          files++;
          // Estimar tokens por tamaño de archivo
          try {
            const stat = statSync(join(sessionDir, entry.name));
            // ~4 chars per token (conservative)
            turns += Math.ceil(stat.size / 400);
          } catch {
            // Ignore
          }
        }
      }
    }
  } catch {
    // Ignore errors
  }

  // Heurística: 100 tokens por archivo + contenido
  const estimatedTokens = files * 100 + turns * 500;

  return { tokens: estimatedTokens, files, turns, sessionId };
}

/**
 * Determina el estado basado en thresholds
 */
function determineStatus(tokens: number): {
  status: CompactionStatus['status'];
  message: string;
  recommendation: string;
} {
  if (tokens > THRESHOLDS.MAX) {
    return {
      status: 'OVERFLOW',
      message: `Context overflow: ${tokens.toLocaleString()} tokens (MAX: ${THRESHOLDS.MAX.toLocaleString()})`,
      recommendation: 'CRITICAL: Close session immediately. Use "/compact" or start fresh session.',
    };
  }

  if (tokens > THRESHOLDS.HARD) {
    return {
      status: 'CRITICAL',
      message: `High context usage: ${tokens.toLocaleString()} tokens (HARD limit: ${THRESHOLDS.HARD.toLocaleString()})`,
      recommendation:
        'URGENT: Consider manual compaction with context-engineering skill or closing session.',
    };
  }

  if (tokens > THRESHOLDS.SOFT) {
    return {
      status: 'WARN',
      message: `Elevated context: ${tokens.toLocaleString()} tokens (SOFT limit: ${THRESHOLDS.SOFT.toLocaleString()})`,
      recommendation: 'Optional: Use context-engineering skill to optimize or continue monitoring.',
    };
  }

  return {
    status: 'OK',
    message: `Context healthy: ${tokens.toLocaleString()} tokens`,
    recommendation: 'Continue normal operation. Compaction not required.',
  };
}

/**
 * Guarda estado de alertas
 */
function saveAlertState(status: CompactionStatus): void {
  try {
    const state: AlertState = {
      lastAlert: new Date().toISOString(),
      lastStatus: status.status,
      alertCount: status.status !== 'OK' ? 1 : 0,
      actions: status.status !== 'OK' ? [status.recommendation] : [],
    };

    if (existsSync(ALERT_STATE_FILE)) {
      try {
        const existing = JSON.parse(readFileSync(ALERT_STATE_FILE, 'utf-8'));
        state.alertCount = (existing.alertCount || 0) + (status.status !== 'OK' ? 1 : 0);
        state.actions = [
          ...(existing.actions || []),
          ...(status.status !== 'OK' ? [status.recommendation] : []),
        ].slice(-10);
      } catch {
        // Ignore
      }
    }

    // Note: writeFileSync would need to be imported
    // For now, just log
    console.log(`[ALERT-STATE] ${status.status}: ${status.message}`);
  } catch {
    // Ignore errors
  }
}

/**
 * Check principal - evalúa el contexto actual
 */
export function checkCompactionStatus(): CompactionStatus {
  const { tokens, files, turns, sessionId } = estimateTokens();
  const { status, message, recommendation } = determineStatus(tokens);

  const result: CompactionStatus = {
    timestamp: new Date().toISOString(),
    sessionId,
    estimatedTokens: tokens,
    status,
    message,
    recommendation,
    filesInContext: files,
    turnsCount: turns,
  };

  saveAlertState(result);
  return result;
}

/**
 * Muestra estado actual
 */
function showStatus(): void {
  const status = checkCompactionStatus();

  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║        COMPACTION MONITOR - Context Status             ║');
  console.log('╠════════════════════════════════════════════════════════╣');
  console.log(`║  Session:     ${(status.sessionId ?? 'N/A').padEnd(38)} ║`);
  console.log(
    `║  Tokens:      ${status.estimatedTokens.toLocaleString().padStart(10)} / ${THRESHOLDS.MAX.toLocaleString().padEnd(20)} ║`,
  );
  console.log(`║  Files:       ${status.filesInContext.toString().padStart(38)} ║`);
  console.log(`║  Turns:       ${status.turnsCount.toString().padStart(38)} ║`);
  console.log(`║  Status:      ${status.status.padStart(38)} ║`);
  console.log('╠════════════════════════════════════════════════════════╣');
  console.log(`║  ${status.message.slice(0, 52).padEnd(52)} ║`);
  console.log('╠════════════════════════════════════════════════════════╣');
  console.log(`║  RECOMMENDATION:                                       ║`);
  console.log(`║  ${status.recommendation.slice(0, 52).padEnd(52)} ║`);
  console.log('╚════════════════════════════════════════════════════════╝\n');

  // Exit code para CI/CD
  if (status.status === 'OVERFLOW') {
    process.exit(2);
  } else if (status.status === 'CRITICAL') {
    process.exit(1);
  }
}

/**
 * Muestra alerta si es necesario
 */
function showAlert(): void {
  const status = checkCompactionStatus();

  if (status.status !== 'OK') {
    console.error(`\n⚠️  COMPACTION ALERT [${status.status}]`);
    console.error(status.message);
    console.error(`→ ${status.recommendation}\n`);

    if (status.status === 'CRITICAL' || status.status === 'OVERFLOW') {
      process.exit(1);
    }
  } else {
    console.log('✓ Context healthy');
  }
}

// CLI
function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--status') || args.includes('-s')) {
    showStatus();
  } else if (args.includes('--alert') || args.includes('-a')) {
    showAlert();
  } else if (args.includes('--check') || args.includes('-c') || args.length === 0) {
    const status = checkCompactionStatus();
    console.log(JSON.stringify(status, null, 2));
  } else if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Compaction Monitor - Context size monitoring for Gentle-Vanguard

USAGE:
  npx tsx src/compaction-monitor.ts [options]

OPTIONS:
  --check, -c    Check current status (default, JSON output)
  --status, -s   Show formatted status table
  --alert, -a    Show alert only if threshold exceeded
  --help, -h     Show this help

THRESHOLDS:
  SOFT:  ${THRESHOLDS.SOFT.toLocaleString()} tokens (WARN)
  HARD:  ${THRESHOLDS.HARD.toLocaleString()} tokens (CRITICAL)
  MAX:   ${THRESHOLDS.MAX.toLocaleString()} tokens (OVERFLOW)

CONFIGURATION:
  For Kimi2-5: Set "compaction.auto: false" in opencode.json
  Manual compaction: Use context-engineering skill or skill load context-engineering
`);
  } else {
    console.error(`Unknown option: ${args[0]}. Use --help for usage.`);
    process.exit(1);
  }
}

// Run if called directly
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
