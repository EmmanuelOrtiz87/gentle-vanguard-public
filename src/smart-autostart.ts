#!/usr/bin/env node
/**
 * Smart Session Autostart
 * Wrapper inteligente que evita reinicios innecesarios
 *
 * Lógica:
 * 1. Limpia procesos zombie
 * 2. Verifica si sesión está activa
 * 3. Si activa: solo toca timestamp
 * 4. Si inactiva: ejecuta autostart completo
 */

import { runSync, runSyncShell } from './core/run-command.js';
import { existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const SESSION_FILE = join(ROOT, '.session', '.active-session.json');

interface SessionState {
  id: string;
  lastActivity: string;
  pid: number;
}

function isSessionActive(): { active: boolean; reason: string } {
  try {
    if (!existsSync(SESSION_FILE)) {
      return { active: false, reason: 'No session state' };
    }

    const state: SessionState = JSON.parse(require('fs').readFileSync(SESSION_FILE, 'utf-8'));

    // Check 30min timeout
    const lastActivity = new Date(state.lastActivity).getTime();
    if (Date.now() - lastActivity > 30 * 60 * 1000) {
      return { active: false, reason: 'Session expired (>30min)' };
    }

    // Check process alive
    try {
      process.kill(state.pid, 0);
    } catch {
      return { active: false, reason: 'Process dead' };
    }

    return { active: true, reason: 'Session active' };
  } catch {
    return { active: false, reason: 'Invalid state' };
  }
}

function touchSession(): void {
  try {
    if (existsSync(SESSION_FILE)) {
      const state = JSON.parse(require('fs').readFileSync(SESSION_FILE, 'utf-8'));
      state.lastActivity = new Date().toISOString();
      require('fs').writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2));
    }
  } catch {}
}

function killZombieProcesses(): void {
  const ports = [8080, 5173];
  for (const port of ports) {
    try {
      const output = runSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`,
        ],
        { stdio: 'pipe' },
      ).stdout;

      const pids = output
        .trim()
        .split('\n')
        .filter((p) => p && !isNaN(parseInt(p)));
      for (const pid of pids) {
        try {
          runSyncShell(`taskkill /F /T /PID ${pid} 2>NUL`, { stdio: 'pipe' });
          console.log(`[SMART] Killed zombie PID ${pid} on port ${port}`);
        } catch {}
      }
    } catch {}
  }
}

// MAIN
const status = isSessionActive();

if (status.active) {
  console.log('[SMART] Session already active, reusing...');
  touchSession();
  console.log('[SMART] ✅ Session touched, ready to use');
  console.log('[SMART] 💰 Saved ~40K tokens by reusing session');
} else {
  console.log(`[SMART] ${status.reason}, starting fresh...`);
  console.log('[SMART] Cleaning zombie processes...');
  killZombieProcesses();

  console.log('[SMART] Starting session autostart...');
  try {
    runSync('npm', ['run', 'session:autostart:detached'], {
      stdio: 'inherit',
      cwd: ROOT,
    });
    console.log('[SMART] ✅ Session started');
  } catch (e) {
    console.error('[SMART] ❌ Autostart failed:', e);
    process.exit(1);
  }
}
