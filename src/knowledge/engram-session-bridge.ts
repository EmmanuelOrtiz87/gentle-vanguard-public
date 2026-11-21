#!/usr/bin/env node
/**
 * engram-session-bridge.ts — Centralized Engram Session Management
 *
 * Unifica el flujo de sesiones Engram para que funcione idénticamente
 * en TODAS las herramientas (OpenCode, Claude, Cline, Cursor, etc.)
 *
 * PATRÓN REAL DE SESIONES ENGRAM (v3.4.0 MCP EXPLICÍTO — actualizado 2026-10-28,
 * GB-2026-10-28-engram-session-lifecycle.md):
 *   El CLI `engram` no tiene subcomando session, PERO el MCP (`engram mcp`)
 *   SÍ expone `mem_session_start`/`mem_session_end`/`mem_session_summary`.
 *   Este bridge los usa NATIVO (one-shot stdio, src/knowledge/engram-mcp-session.ts):
 *   sessionStart() REGISTRA la sesión y sessionEnd() la CIERRA — cerrando asÍ
 *   la clase de error "multiple active runtime sessions match the current
 *   project and directory" (antes: sesiones de stack sin registro ni cierre →
 *   zombis activos que bloqueaban mem_save).

 *   El sessionId del stack (`session-<ISO>`) es caller-provided
 *   (`Caller-provided unique session ID`) — válido para mem_session_start.
 *
 *   El cierre real ante Engram es PERSISTIR un resumen (`engram save
 *   --type session_summary`), que adjunta la observación a la sesión
 *   automática vigente de Engram. Este fichero NO depende del plugin OpenCode.
 *
 * Flujo correcto:
 *   1. sessionStart() → Persiste el tracking local (status:'active') en .session/
 *   2. Durante sesión → Usar mem_save, mem_search directamente (MCP/CLI)
 *   3. sessionEnd()   → 1) Persiste resumen vía CLI (MCP), 2) marca el cierre
 *                       local (status:'closed') para que ninguna sesión quede
 *                       colgada, 3) fallback HTTP (server opcional, puede no
 *                       estar escuchando — NO es la fuente de verdad).
 */

import { runSync } from '../core/run-command.js';
import {
  engramSessionEnd as engramMcpSessionEnd,
  engramSessionStart,
} from './engram-mcp-session.js';
import { pathToFileURL } from 'url';
import * as http from 'http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENGRAM_PORT = Number(process.env.ENGRAM_PORT || 7437);
const PROJECT = 'gentle-vanguard';
const ROOT = resolve(__dirname, '..', '..');
const SESSION_FILE = join(ROOT, '.session', 'session-current.json');

/** Actualiza el estado de tracking local en .session/session-current.json. */
function updateLocalSessionState(sessionId: string, status: 'active' | 'closed'): boolean {
  try {
    let state: Record<string, unknown> = {};
    if (existsSync(SESSION_FILE)) {
      try {
        state = JSON.parse(readFileSync(SESSION_FILE, 'utf-8')) as Record<string, unknown>;
      } catch {
        /* corrupto — sobreescribir limpio */
      }
    } else {
      mkdirSync(dirname(SESSION_FILE), { recursive: true });
    }
    state.sessionId = sessionId;
    state.id = sessionId;
    state.engramBridge = status;
    if (status === 'closed') {
      state.status = 'closed';
      state.closedAt = new Date().toISOString();
    } else {
      state.status = 'active';
    }
    writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.warn(`[ENGRAM] Local session state update failed:`, error);
    return false;
  }
}

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
  localClosed: boolean;
  hostOwned?: boolean;
  error?: string;
}

export function usesHostOwnedEngramSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.CODEX_SESSION_ID || env.CODEX_THREAD_ID);
}

/** Persiste el seguimiento local. En Codex, el host registra la sesión de Engram. */
export function sessionStart(sessionId?: string): SessionStartResult {
  const sid = sessionId || `session-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const persisted = updateLocalSessionState(sid, 'active');
  if (!persisted) {
    return { success: false, sessionId: sid, error: 'Could not persist local session tracking' };
  }
  if (usesHostOwnedEngramSession()) {
    console.log('[ENGRAM] Local session tracking persisted; Codex owns runtime registration');
    return { success: true, sessionId: sid };
  }
  // Nuevo (2026-10-28): registra la sesión EN engram via MCP nativo (one-shot).
  // Best-effort (S4): un fallo no bloquea el start.
  let mcpNote = 'mcp: skipped';
  try {
    const r = engramSessionStart(sid, ROOT);
    mcpNote = r.ok ? 'mcp: registered' : `mcp: ${r.error ?? 'error'}`;
  } catch (e) {
    mcpNote = `mcp: ${e instanceof Error ? e.message : e}`;
  }
  console.log(
    `[ENGRAM] Session started locally: ${sid} (tracking persisted: ${persisted}, ${mcpNote})`,
  );
  return { success: true, sessionId: sid };
}

/** `session-<ISO>`/UUID identifican UNA sesion; cualquier otra etiqueta se comparte. */
const UNIQUE_SESSION_RE = /^(session[-_]\d{8}T|session[-_]\d{4}-|[0-9a-f]{8}-[0-9a-f]{4}-)/i;

/**
 * Topic key para el resumen. Engram upserta por topic (`--topic`): re-cerrar la
 * misma sesion actualiza su resumen en vez de acumular uno nuevo. Cuando el id
 * no identifica una sesion (p. ej. el nombre del proyecto) se usa un topic
 * rodante para que la memoria guarde el ultimo estado y no 729 duplicados.
 */
export function sessionSummaryTopic(sessionId: string): string {
  const slug = sessionId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return UNIQUE_SESSION_RE.test(sessionId)
    ? `session/summary-${slug}`
    : `session/latest-${slug || 'unknown'}`;
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
  if (usesHostOwnedEngramSession()) return false;
  const substantive = Boolean(
    content.goal ||
    content.discoveries?.length ||
    content.accomplished?.length ||
    content.nextSteps?.length,
  );
  if (!substantive) {
    console.log('[ENGRAM] Summary skipped: sin contenido durable (no es memoria)');
    return true;
  }
  try {
    const summary = [
      `## Session`,
      `${sessionId} — ${new Date().toISOString()}`,
      ``,
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
        '--topic',
        sessionSummaryTopic(sessionId),
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
  if (usesHostOwnedEngramSession()) {
    const localClosed = updateLocalSessionState(sessionId, 'closed');
    return {
      success: localClosed,
      sessionId,
      mcpSuccess: false,
      httpSuccess: false,
      localClosed,
      hostOwned: true,
    };
  }
  let mcpSuccess = false;
  let httpSuccess = false;
  let mcpNativeClose = false;
  let error = '';

  // 1. Intentar generar resumen vía MCP (CLI `engram save --type session_summary`)
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

  // 3. Fallback HTTP API (server opcional — puede no estar escuchando; NO es
  //    la fuente de verdad del cierre, que es el resumen persistido por CLI)
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

  // 3. Cierre NATIVO MCP (2026-10-28, GB-2026-10-28-engram-session-lifecycle):
  //    mem_session_end cierra la sesión runtime del stack en engram — sin esto
  //    quedan zombis activos y mem_save del MCP falla por "multiple active
  //    runtime sessions". Best-effort (S4).
  try {
    const r = engramMcpSessionEnd(
      sessionId,
      summary ? 'Cerrada por session-close orchestrator' : undefined,
    );
    mcpNativeClose = r.ok;
    if (!r.ok) error += ` MCP-native-close: ${r.error ?? 'error'}`;
    else console.log(`[ENGRAM] Runtime session closed via MCP: ${sessionId}`);
  } catch (e) {
    error += ` MCP-native-close: ${e instanceof Error ? e.message : e}`;
  }

  // 4. SIEMPRE marcar el cierre local en .session/session-current.json para que
  //    ninguna sesión del stack quede colgada como "active" sin actividad real.
  const localClosed = updateLocalSessionState(sessionId, 'closed');
  const success = mcpSuccess || httpSuccess || mcpNativeClose;
  if (localClosed) console.log(`[ENGRAM] Local session closed: ${sessionId}`);

  return {
    success,
    sessionId,
    mcpSuccess,
    httpSuccess,
    error: error || undefined,
    localClosed,
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
