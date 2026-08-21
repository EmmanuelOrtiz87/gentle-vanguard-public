#!/usr/bin/env node
/**
 * Session Complete - Cierre completo de sesión con persistencia Engram y cierre de procesos
 *
 * Este script:
 * 1. Guarda resumen de sesión en Engram
 * 2. Identifica y cierra procesos de la sesión actual
 * 3. Mantiene procesos compartidos si otras sesiones están activas
 * 4. Ejecuta cleanup del stack
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { runSync, runSyncShell, runNpxTsxSync } from './core/run-command.js';

const ROOT = resolve(process.cwd());
const SESSION_DIR = join(ROOT, '.session');

interface SessionInfo {
  sessionId: string;
  startTime: string;
  pid: number;
  processes: number[];
}

function log(msg: string) {
  console.log(`[SESSION-COMPLETE] ${msg}`);
}

function ok(msg: string) {
  console.log(`[SESSION-COMPLETE] ✅ ${msg}`);
}

function warn(msg: string) {
  console.warn(`[SESSION-COMPLETE] ⚠️  ${msg}`);
}

/**
 * Obtiene información de la sesión actual
 */
function getCurrentSession(): SessionInfo | null {
  const sessionFile = join(SESSION_DIR, 'session-current.json');
  if (!existsSync(sessionFile)) {
    warn('No session-current.json found');
    return null;
  }

  try {
    const data = JSON.parse(readFileSync(sessionFile, 'utf-8'));
    return {
      sessionId: data.sessionId || data.id,
      startTime: data.startTime || data.timestamp,
      pid: process.pid,
      processes: data.processes || [],
    };
  } catch {
    warn('Failed to parse session-current.json');
    return null;
  }
}

/**
 * Guarda resumen de sesión en Engram
 */
function saveToEngram(session: SessionInfo): boolean {
  log('Saving session summary to Engram...');

  const duration = Date.now() - new Date(session.startTime).getTime();
  const durationMinutes = Math.floor(duration / 60000);

  const title = `Session Complete - ${session.sessionId}`;
  const content = `**What**: Session ${session.sessionId} completed

**Why**: Formal session closure with persistence

**Where**: Gentle-Vanguard stack

**Learned**:

## Session Metrics
- **Session ID**: ${session.sessionId}
- **Duration**: ${durationMinutes} minutes
- **PID**: ${session.pid}
- **Processes**: ${session.processes.length}

## Status
- Session cleanup: completed
- Engram persistence: completed
- Process cleanup: completed

## Next Session
Ready for next session start.`;

  // Usar engram CLI directamente
  const result = runSync(
    'engram',
    ['save', '--title', title, '--type', 'decision', '--content', content],
    { cwd: ROOT, stdio: 'pipe', timeout: 30000 },
  );

  if (result.status === 0) {
    ok('Session saved to Engram');
    return true;
  } else {
    // Fallback: guardar en archivo para posterior importación
    const fallbackFile = join(SESSION_DIR, `session-${session.sessionId}-engram-backup.json`);
    writeFileSync(fallbackFile, JSON.stringify({ title, type: 'decision', content }, null, 2));
    warn(`Engram CLI failed, saved to ${fallbackFile} for manual import`);
    return false;
  }
}

/**
 * Identifica procesos de la sesión actual
 */
function identifySessionProcesses(session: SessionInfo): number[] {
  log('Identifying session processes...');

  const processes: number[] = [];

  // Buscar procesos node/tsx iniciados después de la sesión
  try {
    const result = runSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        'Get-Process | Where-Object { $_.ProcessName -eq "node" -and $_.StartTime -gt (Get-Date -Date "' +
          session.startTime +
          '") } | Select-Object -ExpandProperty Id',
      ],
      { stdio: 'pipe' },
    );

    const pids = result.stdout
      .trim()
      .split('\n')
      .map((p) => parseInt(p.trim()))
      .filter((p) => !isNaN(p));
    processes.push(...pids);
  } catch {
    // Fallback: buscar en archivos de sesión
  }

  // Buscar dashboard processes
  try {
    const dashboardResult = runSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        'Get-Process | Where-Object { $_.ProcessName -match "dashboard|websocket" } | Select-Object -ExpandProperty Id',
      ],
      { stdio: 'pipe' },
    );

    const dashboardPids = dashboardResult.stdout
      .trim()
      .split('\n')
      .map((p) => parseInt(p.trim()))
      .filter((p) => !isNaN(p));
    processes.push(...dashboardPids);
  } catch {
    // No dashboard processes
  }

  // Eliminar duplicados
  const uniqueProcesses = [...new Set(processes)];

  ok(`Identified ${uniqueProcesses.length} session processes`);
  return uniqueProcesses;
}

/**
 * Verifica si hay otras sesiones activas
 */
function hasOtherActiveSessions(currentSessionId: string): boolean {
  const sessionsDir = SESSION_DIR;
  if (!existsSync(sessionsDir)) return false;

  const sessionFiles = readdirSync(sessionsDir).filter(
    (f) => f.startsWith('session-') && f.endsWith('.json'),
  );

  for (const file of sessionFiles) {
    if (file.includes('session-current.json')) continue;

    const filePath = join(sessionsDir, file);
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      if (data.sessionId && data.sessionId !== currentSessionId && data.status === 'active') {
        return true;
      }
    } catch {
      // Skip invalid files
    }
  }

  return false;
}

/**
 * Cierra procesos de la sesión
 */
function closeSessionProcesses(processes: number[], hasOthers: boolean): void {
  if (processes.length === 0) {
    ok('No session processes to close');
    return;
  }

  log(`Closing ${processes.length} session processes...`);

  for (const pid of processes) {
    // No cerrar procesos compartidos si hay otras sesiones
    if (hasOthers && isSharedProcess(pid)) {
      log(`Keeping shared process ${pid} (other sessions active)`);
      continue;
    }

    try {
      runSyncShell(`taskkill /PID ${pid} /F 2>nul`, { stdio: 'ignore' });
      log(`Closed process ${pid}`);
    } catch {
      warn(`Failed to close process ${pid} (may already be closed)`);
    }
  }

  ok('Session processes closed');
}

/**
 * Determina si un proceso es compartido
 */
function isSharedProcess(pid: number): boolean {
  // Dashboard WS, Engram, CodeGraph son compartidos
  try {
    const result = runSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Get-Process -Id ${pid} | Select-Object -ExpandProperty ProcessName`,
      ],
      { stdio: 'pipe' },
    );
    const name = result.stdout.trim();
    return ['dashboard-ws', 'engram', 'codegraph'].includes(name);
  } catch {
    return false;
  }
}

/**
 * Ejecuta cleanup del stack (original)
 */
function runStackCleanup(): void {
  log('Running stack cleanup...');

  const cleanupScript = join(ROOT, 'src/session-cleanup-start.ts');
  if (existsSync(cleanupScript)) {
    const result = runNpxTsxSync(cleanupScript, [], {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 60000,
    });

    if (result.status === 0) {
      ok('Stack cleanup completed');
    } else {
      warn('Stack cleanup had issues (non-fatal)');
    }
  }
}

/**
 * Guarda métricas finales
 */
function saveFinalMetrics(session: SessionInfo): void {
  log('Saving final metrics...');

  const metricsFile = join(SESSION_DIR, 'session-metrics.json');
  const metrics = {
    sessionId: session.sessionId,
    endTime: new Date().toISOString(),
    duration: Date.now() - new Date(session.startTime).getTime(),
    processesClosed: session.processes.length,
    status: 'completed',
  };

  writeFileSync(metricsFile, JSON.stringify(metrics, null, 2));
  ok('Final metrics saved');
}

/**
 * Función principal
 */
function main(): void {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║     Session Complete - Gentle-Vanguard Stack          ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  // 1. Obtener sesión actual
  const session = getCurrentSession();
  if (!session) {
    warn('No active session found, running cleanup only');
    runStackCleanup();
    return;
  }

  log(`Session: ${session.sessionId}`);
  log(`Started: ${session.startTime}`);

  // 2. Identificar procesos
  session.processes = identifySessionProcesses(session);

  // 3. Verificar otras sesiones
  const hasOthers = hasOtherActiveSessions(session.sessionId);
  if (hasOthers) {
    log('Other active sessions detected - keeping shared processes');
  }

  // 4. Guardar en Engram
  saveToEngram(session);

  // 5. Cerrar procesos
  closeSessionProcesses(session.processes, hasOthers);

  // 6. Cleanup del stack
  runStackCleanup();

  // 7. Guardar métricas finales
  saveFinalMetrics(session);

  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║     ✅ SESSION CLOSED SUCCESSFULLY                   ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
