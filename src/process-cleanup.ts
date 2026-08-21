#!/usr/bin/env node
/**
 * Process Cleanup Manager - Node.js Native
 * Limpia procesos zombie y archivos stale SIN dependencias externas
 */

import { runSyncShell } from './core/run-command.js';
import { pathToFileURL } from 'url';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

/**
 * Kill processes using specific ports using native Node.js
 * NO usa PowerShell - usa netstat.exe nativo de Windows
 */
export function killZombieDashboard(): number {
  let killed = 0;
  const ports = [8080, 5173, 3000];

  for (const port of ports) {
    try {
      // Use netstat.exe nativo (viene con Windows, no requiere PowerShell)
      const output = runSyncShell(`netstat -ano | findstr :${port}`, {}).stdout;

      const lines = output.split('\n').filter((line) => line.includes('LISTENING'));

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];

        if (pid && !isNaN(parseInt(pid))) {
          try {
            // taskkill es nativo de Windows
            runSyncShell(`taskkill /F /T /PID ${pid}`, {
              stdio: 'pipe',
            });
            console.log(`[CLEANUP] Killed PID ${pid} on port ${port}`);
            killed++;
          } catch {
            // Already dead or no permission
          }
        }
      }
    } catch {
      // Port not in use or error
    }
  }

  return killed;
}

/**
 * Kill node processes by name
 */
export function killNodeProcesses(): number {
  let killed = 0;

  try {
    // Find node processes
    const result = runSyncShell('tasklist /FI "IMAGENAME eq node.exe" /FO CSV', {}).stdout;

    const lines = result.split('\n').slice(1); // Skip header

    for (const line of lines) {
      const parts = line.replace(/"/g, '').split(',');
      const pid = parts[1];

      if (pid && !isNaN(parseInt(pid))) {
        try {
          // Don't kill ourselves
          if (parseInt(pid) !== process.pid) {
            runSyncShell(`taskkill /F /T /PID ${pid}`, {
              stdio: 'pipe',
            });
            killed++;
          }
        } catch {}
      }
    }
  } catch {}

  return killed;
}

export function cleanPidFiles(): string[] {
  const cleaned: string[] = [];
  const files = [
    join(ROOT, '.runtime', 'dashboard-ws.pid'),
    join(ROOT, '.runtime', 'dashboard-ws-watchdog.pid'),
    join(ROOT, '.runtime', 'dashboard-vite.pid'),
    join(ROOT, '.session', '.active-session.json'),
  ];

  for (const file of files) {
    try {
      if (existsSync(file)) {
        unlinkSync(file);
        cleaned.push(file);
        console.log(`[CLEANUP] Removed ${file}`);
      }
    } catch {}
  }

  return cleaned;
}

export function fullCleanup(): { killed: number; cleaned: number } {
  console.log('[CLEANUP] Starting cleanup (Node.js native, no PowerShell)...');

  const killed = killZombieDashboard();
  const cleaned = cleanPidFiles().length;

  console.log(`[CLEANUP] Summary: ${killed} processes killed, ${cleaned} files cleaned`);

  return { killed, cleaned };
}

// CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fullCleanup();
}
