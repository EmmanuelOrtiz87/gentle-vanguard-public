#!/usr/bin/env node
/**
 * Session Persistence Manager
 * Evita reinicios costosos manteniendo estado entre comandos
 *
 * Problem: Each command triggers full session-autostart (40K+ tokens)
 * Solution: Check session state, only initialize if needed
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const ROOT = process.cwd();
const SESSION_STATE_FILE = join(ROOT, '.session', '.active-session.json');
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

interface SessionState {
  id: string;
  startedAt: string;
  lastActivity: string;
  pid: number;
  components: {
    autostart: boolean;
    dashboard: boolean;
    watchtower: boolean;
    nexus: boolean;
    engram: boolean;
  };
}

/**
 * Check if session is active and valid
 */
export function isSessionActive(): { active: boolean; state?: SessionState; reason?: string } {
  try {
    if (!existsSync(SESSION_STATE_FILE)) {
      return { active: false, reason: 'No session state file' };
    }

    const state: SessionState = JSON.parse(readFileSync(SESSION_STATE_FILE, 'utf-8'));

    // Check if session is recent
    const lastActivity = new Date(state.lastActivity).getTime();
    const now = Date.now();
    const inactive = now - lastActivity > SESSION_TIMEOUT_MS;

    if (inactive) {
      return { active: false, state, reason: 'Session expired (>30min)' };
    }

    // Check if process is alive
    try {
      process.kill(state.pid, 0);
    } catch {
      return { active: false, state, reason: 'Process not running' };
    }

    return { active: true, state };
  } catch {
    return { active: false, reason: 'Invalid state file' };
  }
}

/**
 * Update session activity timestamp
 */
export function touchSession(): void {
  try {
    if (existsSync(SESSION_STATE_FILE)) {
      const state: SessionState = JSON.parse(readFileSync(SESSION_STATE_FILE, 'utf-8'));
      state.lastActivity = new Date().toISOString();
      writeFileSync(SESSION_STATE_FILE, JSON.stringify(state, null, 2));
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Create new session state
 */
export function createSessionState(id: string): SessionState {
  const state: SessionState = {
    id,
    startedAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    pid: process.pid,
    components: {
      autostart: false,
      dashboard: false,
      watchtower: false,
      nexus: false,
      engram: false,
    },
  };

  writeFileSync(SESSION_STATE_FILE, JSON.stringify(state, null, 2));
  return state;
}

/**
 * Mark component as initialized
 */
export function markComponentReady(component: keyof SessionState['components']): void {
  try {
    if (existsSync(SESSION_STATE_FILE)) {
      const state: SessionState = JSON.parse(readFileSync(SESSION_STATE_FILE, 'utf-8'));
      state.components[component] = true;
      state.lastActivity = new Date().toISOString();
      writeFileSync(SESSION_STATE_FILE, JSON.stringify(state, null, 2));
    }
  } catch {
    // Ignore errors
  }
}

// CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];

  switch (command) {
    case 'check': {
      const result = isSessionActive();
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.active ? 0 : 1);
    }
    case 'touch': {
      touchSession();
      console.log('Session activity updated');
      break;
    }
    case 'create': {
      const id = process.argv[3] || `session-${Date.now()}`;
      const state = createSessionState(id);
      console.log('Session created:', state.id);
      break;
    }
    default: {
      console.log('Usage: npx tsx src/session-persist.ts [check|touch|create]');
      console.log('  check  - Check if session is active');
      console.log('  touch  - Update activity timestamp');
      console.log('  create <id> - Create new session state');
    }
  }
}
