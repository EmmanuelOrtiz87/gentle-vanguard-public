import { useState, useCallback } from 'react';
import { useSharedWs } from './useSharedWs';

export interface LiveTrace {
  id: string;
  model: string;
  turnCount: number;
  sessionId: string;
  timestamp: string;
}

export function useLiveTraces() {
  const [traces, setTraces] = useState<LiveTrace[]>([]);

  useSharedWs(
    useCallback((msg: any) => {
      if (msg.type === 'trace_update' && msg.session?.state) {
        const s = msg.session.state;
        setTraces((prev) =>
          [
            {
              id: msg.session.id,
              model: s.model || 'unknown',
              turnCount: s.turnCount || 0,
              sessionId: s.sessionId || msg.session.id,
              timestamp: new Date().toISOString(),
            },
            ...prev.filter((t) => t.id !== msg.session.id),
          ].slice(0, 10),
        );
      }
    }, []),
  );

  return traces;
}
