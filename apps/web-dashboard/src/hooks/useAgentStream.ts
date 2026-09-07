import { useState, useCallback } from 'react';
import { useSharedWs } from './useSharedWs';
import type { AgentSession, AgentMessage, HitlRequest, HitlResponse, UIHint } from '../types/agent';

interface UseAgentStreamOptions {
  agent?: string;
}

export function useAgentStream(opts: UseAgentStreamOptions = {}) {
  const { agent: defaultAgent = 'DEV' } = opts;

  const [session, setSession] = useState<AgentSession | null>(null);
  const [connected, setConnected] = useState(false);
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [agentSessions, setAgentSessions] = useState<
    Array<{ id: string; agent: string; status: string; messageCount: number; updatedAt: string }>
  >([]);
  const [tools, setTools] = useState<Array<{ name: string; description: string }>>([]);
  const [hitlRequest, setHitlRequest] = useState<HitlRequest | null>(null);
  const [historySessions, setHistorySessions] = useState<AgentSession[]>([]);

  const { send } = useSharedWs(
    useCallback((msg: any) => {
      switch (msg.type) {
        case 'bridge_status':
          setBridgeConnected(!!msg.connected);
          setConnected(true);
          break;
        case 'agent_session_created':
          setSession(msg.session as AgentSession);
          break;
        case 'agent_session':
          setSession(msg.session as AgentSession);
          break;
        case 'agent_sessions':
          setAgentSessions(msg.sessions as any[]);
          break;
        case 'agent_message':
          setSession((prev) => {
            if (!prev) return prev;
            const message = msg.message as AgentMessage;
            const exists = prev.messages.some((m) => m.id === message.id);
            if (exists) {
              return {
                ...prev,
                messages: prev.messages.map((m) => (m.id === message.id ? message : m)),
              };
            }
            return { ...prev, messages: [...prev.messages, message] };
          });
          break;
        case 'agent_stream_done':
          setSession((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === msg.messageId ? { ...m, streaming: false } : m,
              ),
            };
          });
          break;
        case 'agent_ui_hints':
          setSession((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === msg.messageId ? { ...m, uiHints: msg.uiHints as UIHint[] } : m,
              ),
            };
          });
          break;
        case 'agent_stream_chunk':
          setSession((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              messages: prev.messages.map((m) => {
                if (m.id !== msg.messageId) return m;
                const chunk = typeof msg.content === 'string' ? msg.content : '';
                const base = m.content.startsWith('Ejecutando skill') ? '' : m.content;
                return { ...m, content: base + chunk, streaming: true };
              }),
            };
          });
          break;
        case 'agent_tools':
          setTools(msg.tools as any[]);
          setBridgeConnected(!!msg.connected);
          break;
        case 'hitl_request':
          setHitlRequest(msg.hitlRequest as HitlRequest);
          setSession((prev) => (prev ? { ...prev, status: 'awaiting_input' } : prev));
          break;
        case 'hitl_resolved':
          setHitlRequest((prev) => (prev?.id === msg.requestId ? null : prev));
          setSession((prev) => (prev ? { ...prev, status: 'active' } : prev));
          break;
        case 'agent_history':
          setHistorySessions(msg.sessions as AgentSession[]);
          break;
      }
    }, []),
  );

  const createSession = useCallback(
    (agent?: string) => {
      send({ type: 'agent', action: 'create_session', agent: agent || defaultAgent });
    },
    [send, defaultAgent],
  );

  const sendMessage = useCallback(
    (sessionId: string, message: string) => {
      send({ type: 'agent', action: 'send_message', sessionId, message });
    },
    [send],
  );

  const executeSkill = useCallback(
    (sessionId: string, skill: string, params?: Record<string, unknown>) => {
      send({ type: 'agent', action: 'execute_skill', sessionId, skill, params });
    },
    [send],
  );

  const cancelExecution = useCallback(
    (sessionId: string) => {
      send({ type: 'agent', action: 'cancel', sessionId });
    },
    [send],
  );

  const listSkills = useCallback(
    (sessionId: string) => {
      send({ type: 'agent', action: 'list_skills', sessionId });
    },
    [send],
  );

  const searchSkills = useCallback(
    (sessionId: string, query: string) => {
      send({ type: 'agent', action: 'search_skills', sessionId, query });
    },
    [send],
  );

  const listSessions = useCallback(() => {
    send({ type: 'agent', action: 'list_sessions' });
  }, [send]);

  const getSession = useCallback(
    (sessionId: string) => {
      send({ type: 'agent', action: 'get_session', sessionId });
    },
    [send],
  );

  const listTools = useCallback(() => {
    send({ type: 'agent', action: 'list_tools' });
  }, [send]);

  const subscribe = useCallback(
    (sessionId: string) => {
      send({ type: 'agent', action: 'subscribe', sessionId });
    },
    [send],
  );

  const listHistory = useCallback(() => {
    send({ type: 'agent', action: 'list_history' });
  }, [send]);

  const resolveHitl = useCallback(
    (response: HitlResponse) => {
      send({ type: 'agent', action: 'hitl_response', ...response });
      setHitlRequest(null);
    },
    [send],
  );

  return {
    session,
    connected,
    bridgeConnected,
    agentSessions,
    tools,
    hitlRequest,
    historySessions,
    createSession,
    sendMessage,
    executeSkill,
    cancelExecution,
    listSkills,
    searchSkills,
    listSessions,
    getSession,
    listTools,
    subscribe,
    resolveHitl,
    listHistory,
  };
}
