#!/usr/bin/env node
/**
 * engram-session-bridge.ts — Centralized Engram Session Management
 *
 * Unifica el flujo de sesiones Engram para que funcione idénticamente
 * en TODAS las herramientas (OpenCode, Claude, Cline, Cursor, etc.)
 *
 * Flujo:
 *   1. sessionStart() → Crea un identificador de sesión local
 *   2. Durante sesión → Usar mem_save, mem_search directamente
 *   3. sessionEnd() → Persiste el resumen vía CLI + HTTP fallback
 *
 * NO depende del plugin OpenCode automático - funciona en todas las herramientas
 */

import { runSync } from '../core/run-command.js';
import { pathToFileURL } from 'url';
import * as http from 'http';

const ENGRAM_PORT = Number(process.env.ENGRAM_PORT || 7437);
const PROJECT = 'gentle-vanguard';

export interface SessionStartResult {
  success: boolean;
  sessionId: string;
  error?: string;
}

export interface SessionEndResult {
  success: boolean;
  sessionId: string;
  mcpSuccess: boolean;
  httpSuccess: boolean;
  error?: string;
}

/**
 * Creates a local session identifier. The native CLI has no session-start command.
 */
export function sessionStart(sessionId?: string): SessionStartResult {
  const sid = sessionId || `session-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  console.log(`[ENGRAM] Session started locally: ${sid}`);
  return { success: true, sessionId: sid };
}

/**
 * Persists a session summary using the native Engram save contract.
 */
export function sessionSummary(
  content: {
    goal?: string;
    discoveries?: string[];
    accomplished?: string[];
    nextSteps?: string[];
  },
  sessionId: string,
): boolean {
  try {
    const summary = [
      `## Goal`,
      content.goal || 'Session completed',
      ``,
      `## Discoveries`,
      ...(content.discoveries?.map((d) => `- ${d}`) || ['- Session completed']),
      ``,
      `## Accomplished`,
      ...(content.accomplished?.map((a) => `- ✅ ${a}`) || ['- ✅ Session completed']),
      ``,
      `## Next Steps`,
      ...(content.nextSteps?.map((s) => `- ${s}`) || ['- Review session artifacts']),
    ].join('\n');

    const result = runSync(
      'engram',
      [
        'save',
        `Session summary: ${sessionId}`,
        summary,
        '--type',
        'session_summary',
        '--project',
        PROJECT,
        '--scope',
        'project',
      ],
      { timeout: 10000 },
    );

    return result.status === 0;
  } catch (error) {
    console.warn(`[ENGRAM] Summary warning:`, error);
    return false;
  }
}

/**
 * Persists and closes a session via CLI + HTTP fallback.
 */
export async function sessionEnd(
  sessionId: string,
  summary?: {
    goal?: string;
    discoveries?: string[];
    accomplished?: string[];
    nextSteps?: string[];
  },
): Promise<SessionEndResult> {
  let mcpSuccess = false;
  let httpSuccess = false;
  let error = '';

  // 1. Intentar generar resumen vía MCP
  if (summary) {
    mcpSuccess = sessionSummary(summary, sessionId);
  }

  // 2. Intentar cierre vía MCP explícito
  try {
    if (!summary) mcpSuccess = sessionSummary({}, sessionId);
    if (mcpSuccess) console.log(`[ENGRAM] Session persisted: ${sessionId}`);
  } catch (e) {
    error = String(e);
    console.warn(`[ENGRAM] MCP close warning: ${error}`);
  }

  // 3. Fallback HTTP API (para compatibilidad con plugin OpenCode)
  try {
    const saved = await postSessionEndHttp(sessionId, summary);
    if (saved) {
      httpSuccess = true;
      console.log(`[ENGRAM] Session closed (HTTP): ${sessionId}`);
    }
  } catch (e) {
    error += ` HTTP: ${e}`;
    console.warn(`[ENGRAM] HTTP close warning:`, e);
  }

  const success = mcpSuccess || httpSuccess;

  if (!success) {
    console.warn(`[ENGRAM] Could not close session gracefully: ${sessionId}`);
  }

  return {
    success,
    sessionId,
    mcpSuccess,
    httpSuccess,
    error: error || undefined,
  };
}

/**
 * HTTP POST a /sessions/{id}/end (fallback)
 */
function postSessionEndHttp(
  sessionId: string,
  summary?: {
    goal?: string;
    discoveries?: string[];
    accomplished?: string[];
    nextSteps?: string[];
  },
): Promise<boolean> {
  return new Promise((resolve) => {
    const summaryContent = summary
      ? [
          `## Goal\n${summary.goal || 'Session completed'}`,
          `## Discoveries\n${summary.discoveries?.map((d) => `- ${d}`).join('\n') || '- Session completed'}`,
          `## Accomplished\n${summary.accomplished?.map((a) => `- ✅ ${a}`).join('\n') || '- ✅ Session completed'}`,
          `## Next Steps\n${summary.nextSteps?.map((s) => `- ${s}`).join('\n') || '- Review session artifacts'}`,
        ].join('\n\n')
      : 'Session completed';

    const payload = JSON.stringify({ summary: summaryContent });

    const req = http.request(
      {
        host: '127.0.0.1',
        port: ENGRAM_PORT,
        path: `/sessions/${encodeURIComponent(sessionId)}/end`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 5000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200 || res.statusCode === 201);
      },
    );

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.write(payload);
    req.end();
  });
}

// Auto-ejecutar si es main module
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  const sessionId =
    process.argv[3] || `session-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;

  if (command === 'start') {
    const result = sessionStart(sessionId);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  } else if (command === 'end') {
    sessionEnd(sessionId)
      .then((result) => {
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.success ? 0 : 1);
      })
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  } else {
    console.log('Usage: npx tsx src/engram-session-bridge.ts {start|end} [session-id]');
    process.exit(1);
  }
}
