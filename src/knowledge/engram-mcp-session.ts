/**
 * Engram session lifecycle via native MCP stdio — GB-2026-10-28
 *
 * ONE-SHOT cliente MCP mínimo (ndjson, framing tolerante LSP) contra
 * `engram mcp`. Registra la sesión del stack con mem_session_start y la
 * cierra con mem_session_end: elimina la clase de error "multiple active
 * runtime sessions match the current project and directory".
 *
 * Best-effort por diseño (S4 del feature-doc): cualquier fallo se reporta
 * sin bloquear el flujo del bridge (CLI + local state siguen vigentes).
 */

import { spawnSync } from 'node:child_process';

const MCP_TIMEOUT_MS = 15000;

export interface EngramMcpCallResult {
  ok: boolean;
  /** contenido de result del tools/call (texto crudo) o null */
  result: string | null;
  error: string | null;
}

/** Parse tolerante: NDJSON una-mensaje-por-línea o framing LSP (Content-Length). */
export function parseMcpStdout(stdout: string): unknown[] {
  const messages: unknown[] = [];
  // Framed LSP: Content-Length: N\r\n\r\n<payload>
  const frameRe = /Content-Length:\s*(\d+)\r?\n\r?\n/g;
  let framed = false;
  let m: RegExpExecArray | null;
  while ((m = frameRe.exec(stdout)) !== null) {
    framed = true;
    const start = m.index + m[0].length;
    const len = Number.parseInt(m[1] ?? '0', 10);
    const payload = stdout.slice(start, start + len);
    try {
      messages.push(JSON.parse(payload));
    } catch {
      /* frame inválido: se ignora tolerante */
    }
  }
  if (framed) return messages;
  // NDJSON
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      messages.push(JSON.parse(t));
    } catch {
      /* línea corrupta: tolerante */
    }
  }
  return messages;
}

interface JsonRpcMsg {
  id?: unknown;
  result?: unknown;
  error?: { message?: string } | null;
}

interface McpToolPayload {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}

/** Extrae el texto del contenido de un tools/call response */
export function extractToolText(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const p = result as McpToolPayload;
  if (!Array.isArray(p.content)) return p.isError ? null : JSON.stringify(result);
  const texts = p.content
    .filter((c) => c && (c.type === 'text' || typeof c.text === 'string'))
    .map((c) => c.text ?? '')
    .filter((t) => t.length > 0);
  return texts.length > 0 ? texts.join('\n') : null;
}

/**
 * Un solo tool/call contra `engram mcp` (va directo al exe: windowsHide).
 * Envía initialize + initialized + tools/call en batch y extrae la respuesta
 * del id 2 (initialize = id1, notification sin id, call = id2).
 */
export function engramMcpCall(
  tool: string,
  args: Record<string, unknown>,
  opts: { timeout?: number } = {},
): EngramMcpCallResult {
  const mk = (id: number, method: string, params: Record<string, unknown>) =>
    JSON.stringify({ jsonrpc: '2.0', id, method, params });
  const input = [
    mk(1, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'gv-engram-bridge', version: '1.0.0' },
    }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    mk(2, 'tools/call', { name: tool, arguments: args }),
    '', // newline final
  ].join('\n');

  let out: { status: number | null } & { stdout: string; stderr?: string };
  try {
    out = spawnSync('engram', ['mcp'], {
      input,
      encoding: 'utf-8',
      timeout: opts.timeout ?? MCP_TIMEOUT_MS,
      windowsHide: true,
      shell: false,
    }) as { status: number | null } & { stdout: string; stderr?: string };
  } catch (e) {
    return { ok: false, result: null, error: e instanceof Error ? e.message : String(e) };
  }
  if (!out.stdout || out.stdout.length === 0) {
    return { ok: false, result: null, error: `engram mcp sin respuesta (status ${out.status})` };
  }
  const msgs = parseMcpStdout(out.stdout).filter(
    (x): x is JsonRpcMsg => !!x && typeof x === 'object' && 'id' in (x as JsonRpcMsg),
  );
  const callResp = msgs.find((x) => x.id === 2);
  if (!callResp) {
    return { ok: false, result: null, error: 'sin respuesta para tools/call (id 2)' };
  }
  if (callResp.error) {
    return { ok: false, result: null, error: callResp.error.message ?? 'JSON-RPC error' };
  }
  const text = extractToolText(callResp.result);
  const ok = !(callResp.result as McpToolPayload | undefined)?.isError;
  return { ok, result: ok ? text : null, error: ok ? null : text ?? 'tool error' };
}

/** mem_session_start idempotente para la sesión del stack */
export function engramSessionStart(id: string, directory?: string): EngramMcpCallResult {
  return engramMcpCall('mem_session_start', directory ? { id, directory } : { id });
}

/** mem_session_end con summary opcional — cierra la sesión del stack en engram */
export function engramSessionEnd(
  id: string,
  summary?: string,
): EngramMcpCallResult {
  return engramMcpCall('mem_session_end', summary ? { id, summary } : { id });
}
