import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { dirname } from 'path';
import { WebSocket } from 'ws';
import type { AgentSession, AgentMessage } from '../../src/types/agent.ts';
import { sessions, agentSubscriptions, safeSend, SESSIONS_HISTORY_PATH } from './context.ts';

export function saveSessions(): void {
  try {
    const dir = dirname(SESSIONS_HISTORY_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const list = Array.from(sessions.values()).map((s) => ({
      id: s.id,
      agent: s.agent,
      status: s.status,
      messageCount: s.messages.length,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messages: s.messages,
    }));
    writeFileSync(SESSIONS_HISTORY_PATH, JSON.stringify(list, null, 2), 'utf-8');
  } catch {
    /* persistence best-effort */
  }
}

export function loadSessions(): void {
  try {
    if (!existsSync(SESSIONS_HISTORY_PATH)) return;
    const content = readFileSync(SESSIONS_HISTORY_PATH, 'utf-8');
    const list: AgentSession[] = JSON.parse(content);
    for (const s of list) {
      if (!s.messages) s.messages = [];
      if (!sessions.has(s.id)) sessions.set(s.id, s);
    }
    console.log(`[HISTORY] Loaded ${list.length} sessions from disk`);
  } catch {
    /* best-effort */
  }
}

export function createSession(agent: string): AgentSession {
  const session: AgentSession = {
    id: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    agent,
    status: 'idle',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  sessions.set(session.id, session);
  return session;
}

export function addMessage(sessionId: string, msg: AgentMessage): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.messages.push(msg);
    session.updatedAt = new Date().toISOString();
    saveSessions();
  }
}

export function broadcastToSession(sessionId: string, payload: Record<string, unknown>): void {
  const subs = agentSubscriptions.get(sessionId);
  if (!subs) return;
  const msg = JSON.stringify(payload);
  for (const ws of subs) {
    safeSend(ws, msg);
  }
}

export function subscribeToAgentSession(ws: WebSocket, sessionId: string): void {
  if (!agentSubscriptions.has(sessionId)) {
    agentSubscriptions.set(sessionId, new Set());
  }
  const subs = agentSubscriptions.get(sessionId);
  if (subs) subs.add(ws);
}
