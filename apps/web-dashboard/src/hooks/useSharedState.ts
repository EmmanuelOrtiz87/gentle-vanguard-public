import { useState, useEffect, useRef, useCallback } from 'react';

interface TimelineEvent {
  timestamp: string;
  event: string;
  execution_id?: string;
  payload?: string;
  status: string;
}

interface AgentTask {
  id: string;
  agent: string;
  task: string;
  status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
  startedAt: string;
  completedAt?: string;
  execution_id?: string;
}

export function useSharedState(url?: string) {
  const defaultUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
      : 'ws://localhost:8080';
  const resolvedUrl = url || defaultUrl;
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<NodeJS.Timeout | null>(null);
  const urlRef = useRef(resolvedUrl);

  useEffect(() => {
    urlRef.current = resolvedUrl;
  }, [resolvedUrl]);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(urlRef.current);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case 'state_history':
              setEvents(msg.events || []);
              break;
            case 'state_delta':
              setEvents((prev) => {
                const updated = [...(msg.delta || []), ...prev];
                return updated.slice(0, 50);
              });
              break;
            case 'state_event':
              setEvents((prev) => {
                const updated = [msg.event, ...prev];
                return updated.slice(0, 50);
              });
              break;
            case 'state_tasks':
              setTasks(msg.tasks || []);
              break;
            case 'task_delta':
              setTasks((prev) => {
                const idx = prev.findIndex((t) => t.id === msg.taskId);
                if (idx === -1) return prev;
                const updated = [...prev];
                updated[idx] = {
                  ...updated[idx],
                  status: msg.to,
                  completedAt: msg.at,
                };
                return updated;
              });
              break;
          }
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        reconnectRef.current = setTimeout(connect, 3000);
      };
      ws.onerror = () => setConnected(false);
    } catch {
      setConnected(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
    wsRef.current?.close();
  }, []);

  const emitEvent = useCallback((event: string, payload: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'agent',
          action: 'emit_event',
          event,
          payload,
        }),
      );
    }
  }, []);

  useEffect(() => {
    connect();
    return disconnect;
  }, [connect, disconnect]);

  return { events, tasks, connected, emitEvent };
}
