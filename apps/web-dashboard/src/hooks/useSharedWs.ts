import { useEffect, useRef, useState, useCallback } from 'react';

type Listener = (msg: any) => void;

let sharedWs: WebSocket | null = null;
const listeners = new Set<Listener>();
const connectedCbs = new Set<(v: boolean) => void>();
let refCount = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let intentionallyStopped = true;
let _sharedConnected = false;

function notifyConnected(v: boolean) {
  _sharedConnected = v;
  connectedCbs.forEach((cb) => cb(v));
}

function connect() {
  if (intentionallyStopped || refCount <= 0) return;
  if (
    sharedWs &&
    (sharedWs.readyState === WebSocket.OPEN || sharedWs.readyState === WebSocket.CONNECTING)
  )
    return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  sharedWs = new WebSocket(`${protocol}//${window.location.host}/ws`);
  const ws = sharedWs;
  ws.onopen = () => {
    reconnectDelay = 1000;
    notifyConnected(true);
  };
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      listeners.forEach((fn) => fn(msg));
    } catch {
      /* ignore */
    }
  };
  ws.onclose = () => {
    if (sharedWs !== ws || intentionallyStopped) return;
    notifyConnected(false);
    if (refCount > 0) {
      const delay = reconnectDelay;
      const jitter = Math.round(Math.random() * Math.min(1000, delay * 0.25));
      reconnectDelay = Math.min(30000, delay * 2);
      reconnectTimer = setTimeout(connect, delay + jitter);
    }
  };
  ws.onerror = () => {
    notifyConnected(false);
  };
}

function disconnect() {
  intentionallyStopped = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (sharedWs) {
    sharedWs.onopen = null;
    sharedWs.onclose = null;
    sharedWs.onerror = null;
    sharedWs.onmessage = null;
    if (sharedWs.readyState === WebSocket.OPEN) {
      sharedWs.close();
    }
    sharedWs = null;
  }
  notifyConnected(false);
}

export function useSharedWs(
  listener: (msg: Record<string, unknown>) => void,
  deps: unknown[] = [],
) {
  const [connected, setConnected] = useState(_sharedConnected);
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(() => {
    const wrapper = (msg: Record<string, unknown>) => listenerRef.current(msg);
    listeners.add(wrapper);
    connectedCbs.add(setConnected);
    refCount++;
    intentionallyStopped = false;
    if (!sharedWs || sharedWs.readyState === WebSocket.CLOSED) {
      connect();
    }
    if (_sharedConnected) setConnected(true);
    return () => {
      listeners.delete(wrapper);
      connectedCbs.delete(setConnected);
      refCount--;
      if (refCount <= 0) disconnect();
    };
  }, deps);

  const send = useCallback((data: Record<string, unknown>) => {
    if (sharedWs?.readyState === WebSocket.OPEN) {
      sharedWs.send(JSON.stringify(data));
    }
  }, []);

  return { connected, send };
}
