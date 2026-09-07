import { WebSocket } from 'ws';
import type {
  AgentSession,
  AgentMessage,
  AgentToolCall,
  HitlRequest,
  HitlResponse,
  UIHint,
} from '../../src/types/agent.ts';
import { parseSkillList, buildSkillListHint } from '../../src/lib/agent-command-utils.ts';
import { getBridge } from '../mcp-bridge.ts';
import { getStateBridge } from '../shared-state-bridge.ts';
import { sessions, activeSkillExecutions, sendJson, type ActiveSkillExecution } from './context.ts';
import {
  addMessage,
  broadcastToSession,
  createSession,
  subscribeToAgentSession,
} from './session-store.ts';

const hitlTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleHitlTimeout(request: HitlRequest, sessionId: string): void {
  if (!request.timeoutMs || request.timeoutMs <= 0) return;
  const timeout = setTimeout(() => {
    hitlTimeouts.delete(request.id);
    const session = sessions.get(sessionId);
    if (session) session.status = 'active';
    const response: HitlResponse = {
      requestId: request.id,
      kind: request.kind,
      approved: false,
      reviewed: false,
      timedOut: true,
      sessionId,
    };
    broadcastToSession(sessionId, { type: 'hitl_resolved', requestId: request.id, response });
  }, request.timeoutMs);
  hitlTimeouts.set(request.id, timeout);
}

export function cancelHitlTimeout(requestId: string): void {
  const timeout = hitlTimeouts.get(requestId);
  if (timeout) {
    clearTimeout(timeout);
    hitlTimeouts.delete(requestId);
  }
}

export function buildDemoHitlRequest(session: AgentSession, text: string): HitlRequest {
  const base = {
    id: `hitl-${Date.now()}`,
    sessionId: session.id,
    timeoutMs: 60000,
  };
  if (text.includes('elige') || text.includes('choose') || text.includes('select')) {
    return {
      ...base,
      kind: 'selection' as const,
      title: 'Select an Option',
      message: `Agent ${session.agent} needs you to pick an option.`,
      options: ['Option A', 'Option B', 'Option C'],
    };
  }
  if (text.includes('formulario') || /\bform\b/.test(text)) {
    return {
      ...base,
      kind: 'form' as const,
      title: 'Complete the Form',
      message: `Agent ${session.agent} needs additional input.`,
      fields: [
        { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Your name' },
        { name: 'count', label: 'Count', type: 'number', required: true },
        {
          name: 'mode',
          label: 'Mode',
          type: 'select',
          required: true,
          options: ['fast', 'safe', 'balanced'],
        },
        { name: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Optional notes' },
        { name: 'dryRun', label: 'Dry run', type: 'boolean' },
      ],
    };
  }
  if (text.includes('revisar') || text.includes('review')) {
    return {
      ...base,
      kind: 'review' as const,
      title: 'Review Changes',
      message: `Agent ${session.agent} prepared changes for your review.`,
      review: [
        { label: 'File', value: 'src/config.ts', severity: 'info' },
        { label: 'Lines changed', value: '+42 / -17', severity: 'info' },
        { label: 'Breaking change', value: 'Yes — API contract updated', severity: 'warning' },
        { label: 'Security', value: 'New secret rotation required', severity: 'error' },
      ],
    };
  }
  return {
    ...base,
    kind: 'confirmation' as const,
    title: 'Human-in-the-Loop Required',
    message: `Agent ${session.agent} requires your approval before proceeding.`,
  };
}

export async function handleAgentCommand(
  ws: WebSocket,
  msg: Record<string, unknown>,
): Promise<void> {
  const { action, sessionId, agent, skill, params } = msg as Record<string, string>;

  if (action === 'create_session') {
    const session = createSession(agent || 'DEV');
    subscribeToAgentSession(ws, session.id);
    sendJson(ws, { type: 'agent_session_created', session });
    return;
  }

  if (!sessionId) {
    sendJson(ws, { type: 'error', error: 'sessionId required' });
    return;
  }

  const session = sessions.get(sessionId as string);
  if (!session) {
    sendJson(ws, { type: 'error', error: 'Session not found' });
    return;
  }

  if (action === 'subscribe') {
    subscribeToAgentSession(ws, sessionId as string);
    sendJson(ws, { type: 'subscribed', sessionId });
    return;
  }

  if (action === 'list_sessions') {
    const list = Array.from(sessions.values()).map((s) => ({
      id: s.id,
      agent: s.agent,
      status: s.status,
      messageCount: s.messages.length,
      updatedAt: s.updatedAt,
    }));
    sendJson(ws, { type: 'agent_sessions', sessions: list });
    return;
  }

  if (action === 'list_history') {
    sendJson(ws, { type: 'agent_history', sessions: Array.from(sessions.values()) });
    return;
  }

  if (action === 'get_session') {
    sendJson(ws, { type: 'agent_session', session });
    return;
  }

  if (action === 'list_tools') {
    const bridge = getBridge();
    sendJson(ws, { type: 'agent_tools', tools: bridge.tools, connected: bridge.connected });
    return;
  }

  if (action === 'execute_skill') {
    void executeSkillAndStream(
      ws,
      session,
      skill as string,
      params as unknown as Record<string, unknown>,
    );
    return;
  }

  if (action === 'cancel') {
    cancelSkillExecution(session.id, ws);
    return;
  }

  if (action === 'list_skills' || action === 'search_skills') {
    await handleSkillListing(ws, session, action, (msg as { query?: string }).query);
    return;
  }

  if (action === 'emit_event') {
    const eventMsg = msg as { event?: string; payload?: Record<string, unknown> };
    if (eventMsg.event) {
      getStateBridge().emitEvent(eventMsg.event, eventMsg.payload || {});
    }
    return;
  }

  if (action === 'hitl_response') {
    const hitlResponse = msg as unknown as HitlResponse;
    session.status = 'active';
    cancelHitlTimeout(hitlResponse.requestId);
    broadcastToSession(session.id, {
      type: 'hitl_resolved',
      requestId: hitlResponse.requestId,
      response: hitlResponse,
    });
    return;
  }

  if (action === 'send_message') {
    const userMsg: AgentMessage = {
      id: `msg-${Date.now()}`,
      agent: session.agent,
      role: 'user',
      content: (msg as Record<string, string>).message || '',
      timestamp: new Date().toISOString(),
    };
    addMessage(session.id, userMsg);
    broadcastToSession(session.id, { type: 'agent_message', message: userMsg });

    const assistantMsg: AgentMessage = {
      id: `msg-${Date.now()}-1`,
      agent: session.agent,
      role: 'assistant',
      content: `Procesando solicitud en agente ${session.agent}...`,
      timestamp: new Date().toISOString(),
      streaming: true,
    };
    addMessage(session.id, assistantMsg);
    broadcastToSession(session.id, { type: 'agent_message', message: assistantMsg });

    const text = (msg as Record<string, string>).message?.toLowerCase() || '';
    const needsHITL =
      text.includes('approve') ||
      text.includes('confirm') ||
      text.includes('delegate') ||
      text.includes('revisar') ||
      text.includes('elige') ||
      text.includes('choose') ||
      text.includes('select') ||
      text.includes('formulario') ||
      /\bform\b/.test(text);

    if (needsHITL) {
      session.status = 'awaiting_input';
      const hitlRequest = buildDemoHitlRequest(session, text);
      broadcastToSession(session.id, { type: 'hitl_request', hitlRequest });
      scheduleHitlTimeout(hitlRequest, session.id);
    } else {
      setTimeout(() => {
        assistantMsg.streaming = false;
        assistantMsg.content = `Solicitud procesada por agente ${session.agent}. La respuesta sería generada aquí en producción.`;
        broadcastToSession(session.id, { type: 'agent_message', message: assistantMsg });
        broadcastToSession(session.id, { type: 'agent_stream_done', messageId: assistantMsg.id });
      }, 1500);
    }
    return;
  }
}

export function cancelSkillExecution(sessionId: string, ws: WebSocket): void {
  const exec = activeSkillExecutions.get(sessionId);
  if (!exec || !exec.active) {
    sendJson(ws, { type: 'error', error: 'No active skill execution to cancel' });
    return;
  }
  exec.cancelled = true;
  exec.abortController?.abort();
  const systemMsg: AgentMessage = {
    id: `msg-${Date.now()}`,
    agent: 'system',
    role: 'system',
    content: 'Ejecución cancelada.',
    timestamp: new Date().toISOString(),
  };
  addMessage(sessionId, systemMsg);
  broadcastToSession(sessionId, { type: 'agent_message', message: systemMsg });
  if (exec.messageId) {
    broadcastToSession(sessionId, { type: 'agent_stream_done', messageId: exec.messageId });
  }
}

export async function handleSkillListing(
  ws: WebSocket,
  session: AgentSession,
  action: 'list_skills' | 'search_skills',
  query?: string,
): Promise<void> {
  const bridge = getBridge();
  if (!bridge.connected) {
    sendJson(ws, { type: 'error', error: 'MCP bridge not connected' });
    return;
  }
  try {
    const args = action === 'search_skills' ? { query: query || '' } : {};
    const result = await bridge.callTool(action, args);
    const names = parseSkillList(result);
    const content =
      action === 'list_skills'
        ? `${names.length} skills disponibles. Haz clic en una skill para ejecutarla.`
        : `${names.length} resultado(s) para "${query || ''}". Haz clic en una skill para ejecutarla.`;
    const listMsg: AgentMessage = {
      id: `msg-${Date.now()}`,
      agent: session.agent,
      role: 'assistant',
      content,
      timestamp: new Date().toISOString(),
      uiHints: [buildSkillListHint(names)],
    };
    addMessage(session.id, listMsg);
    broadcastToSession(session.id, { type: 'agent_message', message: listMsg });
  } catch (err) {
    sendJson(ws, {
      type: 'error',
      error: `Failed to ${action}: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

export function extractUiHints(result: unknown): UIHint[] | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.ui_hints)) return r.ui_hints as UIHint[];
  if (r.uiHint && typeof r.uiHint === 'object') return [r.uiHint as UIHint];
  return null;
}

export function extractChunks(result: unknown): string[] | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const chunks = Array.isArray(r.chunks) ? r.chunks : Array.isArray(r.stream) ? r.stream : null;
  if (!chunks) return null;
  return chunks.filter((c): c is string => typeof c === 'string');
}

export async function executeSkillAndStream(
  _ws: WebSocket,
  session: AgentSession,
  skillName: string,
  params?: Record<string, unknown>,
): Promise<void> {
  session.status = 'active';

  const toolCall: AgentToolCall = {
    id: `tc-${Date.now()}`,
    tool: 'execute_skill',
    args: { name: skillName, ...params },
    status: 'running',
    startedAt: new Date().toISOString(),
  };

  const msg: AgentMessage = {
    id: `msg-${Date.now()}`,
    agent: session.agent,
    role: 'assistant',
    content: `Ejecutando skill "${skillName}"...`,
    timestamp: new Date().toISOString(),
    streaming: true,
    toolCalls: [toolCall],
  };

  const exec: ActiveSkillExecution = {
    active: true,
    cancelled: false,
    messageId: msg.id,
    abortController: new AbortController(),
  };
  activeSkillExecutions.set(session.id, exec);

  addMessage(session.id, msg);
  broadcastToSession(session.id, { type: 'agent_message', message: msg });

  const finalize = (cancelled: boolean): void => {
    exec.active = false;
    if (activeSkillExecutions.get(session.id) === exec) {
      activeSkillExecutions.delete(session.id);
    }
    msg.streaming = false;
    if (cancelled) {
      msg.content = `Skill "${skillName}" cancelado.`;
      toolCall.status = 'cancelled';
      toolCall.completedAt = new Date().toISOString();
    }
    broadcastToSession(session.id, { type: 'agent_message', message: msg });
    broadcastToSession(session.id, { type: 'agent_stream_done', messageId: msg.id });
    session.status = 'idle';
  };

  try {
    const bridge = getBridge();
    if (!bridge.connected) {
      throw new Error('MCP bridge not connected');
    }

    const result = await bridge.callTool('execute_skill', { name: skillName, params });
    if (exec.cancelled) {
      finalize(true);
      return;
    }

    // AG-UI Hints (patrón 2): parsear ui_hints de la respuesta MCP
    const uiHints = extractUiHints(result);
    if (uiHints && uiHints.length > 0) {
      msg.uiHints = uiHints;
      broadcastToSession(session.id, { type: 'agent_ui_hints', messageId: msg.id, uiHints });
    }

    // Streaming incremental (patrón 1): emitir chunks antes del mensaje final
    const chunks = extractChunks(result);

    toolCall.result = JSON.stringify(result);
    toolCall.completedAt = new Date().toISOString();

    if (chunks && chunks.length > 0) {
      chunks.forEach((chunk, i) => {
        setTimeout(
          () => {
            if (exec.cancelled) return;
            broadcastToSession(session.id, {
              type: 'agent_stream_chunk',
              messageId: msg.id,
              content: chunk,
            });
          },
          50 * (i + 1),
        );
      });
      setTimeout(
        () => {
          if (exec.cancelled) {
            finalize(true);
            return;
          }
          toolCall.status = 'completed';
          msg.content = chunks.join('');
          finalize(false);
        },
        50 * (chunks.length + 1),
      );
    } else {
      toolCall.status = 'completed';
      msg.content = `Skill "${skillName}" ejecutado exitosamente.`;
      finalize(false);
    }
  } catch (err) {
    if (exec.cancelled) {
      finalize(true);
      return;
    }
    msg.content = `Error ejecutando skill "${skillName}": ${err instanceof Error ? err.message : String(err)}`;
    toolCall.status = 'error';
    toolCall.error = err instanceof Error ? err.message : String(err);
    toolCall.completedAt = new Date().toISOString();
    finalize(false);
  }
}
