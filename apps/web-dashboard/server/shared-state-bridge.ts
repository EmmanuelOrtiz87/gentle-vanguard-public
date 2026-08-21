import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { DatabaseManager } from './database/manager.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../../..');
const EVENT_BUS_DIR = join(ROOT, '.event-bus');
const HISTORY_PATH = join(EVENT_BUS_DIR, 'history.json');

export interface BusEvent {
  timestamp: string;
  event: string;
  execution_id?: string;
  payload?: string;
  status: string;
  handlers_triggered?: number;
}

interface BusHistory {
  version: string;
  events: BusEvent[];
  max_history: number;
}

export interface AgentTask {
  id: string;
  agent: string;
  task: string;
  status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
  startedAt: string;
  completedAt?: string;
  execution_id?: string;
}

export interface TaskDelta {
  taskId: string;
  from: AgentTask['status'];
  to: AgentTask['status'];
  at: string;
}

export interface StateDelta {
  delta: BusEvent[];
  since: string;
}

export class SharedStateBridge extends EventEmitter {
  private pollTimer: NodeJS.Timeout | null = null;
  private lastEventCount = 0;
  private _tasks: AgentTask[] = [];
  private taskSubscribers = new Map<string, Set<(task: AgentTask) => void>>();

  get tasks(): AgentTask[] {
    return this._tasks;
  }

  start(intervalMs = 3000): void {
    this.readHistory();
    this.pollTimer = setInterval(() => this.readHistory(), intervalMs);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  subscribeByTask(taskId: string, callback: (task: AgentTask) => void): () => void {
    let subs = this.taskSubscribers.get(taskId);
    if (!subs) {
      subs = new Set();
      this.taskSubscribers.set(taskId, subs);
    }
    subs.add(callback);
    return () => {
      const current = this.taskSubscribers.get(taskId);
      if (current) {
        current.delete(callback);
        if (current.size === 0) this.taskSubscribers.delete(taskId);
      }
    };
  }

  getTask(taskId: string): AgentTask | undefined {
    return this._tasks.find((t) => t.id === taskId);
  }

  private readHistory(): void {
    try {
      if (!existsSync(HISTORY_PATH)) return;
      const raw = readFileSync(HISTORY_PATH, 'utf-8');
      const history: BusHistory = JSON.parse(raw);

      if (history.events.length > this.lastEventCount) {
        const newEvents = history.events.slice(0, history.events.length - this.lastEventCount);
        this.lastEventCount = history.events.length;
        const delta = newEvents.slice();
        const since =
          history.events[delta.length]?.timestamp ?? delta[delta.length - 1]?.timestamp ?? '';

        for (const evt of newEvents.reverse()) {
          this.processEvent(evt);
          this.emit('event', evt);
        }
        this.emit('state_delta', { delta, since });
        this.emit('history_update', history.events.slice(0, 20));
      }
    } catch {
      // File might be temporarily locked
    }
  }

  private processEvent(evt: BusEvent): void {
    if (evt.event === 'agent.dispatched' && evt.payload) {
      try {
        const p = JSON.parse(evt.payload);
        const task: AgentTask = {
          id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          agent: p.agent || 'unknown',
          task: p.task || 'unknown',
          status: 'running',
          startedAt: evt.timestamp,
          execution_id: evt.execution_id,
        };
        this._tasks.unshift(task);
        this.emit('task_update', this._tasks);
        this.notifyTaskChange(task, 'pending', 'running', evt.timestamp);
      } catch {
        /* ignore */
      }
    }

    if (evt.event === 'agent.completed' && evt.execution_id) {
      const task = this._tasks.find(
        (t) => t.execution_id === evt.execution_id && t.status === 'running',
      );
      if (task) {
        task.status = 'completed';
        task.completedAt = evt.timestamp;
        this.emit('task_update', this._tasks);
        this.notifyTaskChange(task, 'running', 'completed', evt.timestamp);
      }
    }

    if (evt.event === 'agent.error' && evt.execution_id) {
      const task = this._tasks.find(
        (t) => t.execution_id === evt.execution_id && t.status === 'running',
      );
      if (task) {
        task.status = 'error';
        task.completedAt = evt.timestamp;
        this.emit('task_update', this._tasks);
        this.notifyTaskChange(task, 'running', 'error', evt.timestamp);
      }
    }

    if (evt.event === 'agent.cancelled' && evt.execution_id) {
      const task = this._tasks.find(
        (t) => t.execution_id === evt.execution_id && t.status === 'running',
      );
      if (task) {
        task.status = 'cancelled';
        task.completedAt = evt.timestamp;
        this.emit('task_update', this._tasks);
        this.notifyTaskChange(task, 'running', 'cancelled', evt.timestamp);
      }
    }
  }

  private notifyTaskChange(
    task: AgentTask,
    from: AgentTask['status'],
    to: AgentTask['status'],
    at: string,
  ): void {
    this.emit('task_delta', { taskId: task.id, from, to, at });
    const subs = this.taskSubscribers.get(task.id);
    if (subs) {
      for (const cb of subs) {
        try {
          cb(task);
        } catch {
          // Subscriber errors must not break the bridge
        }
      }
    }
  }

  emitEvent(eventName: string, payload: Record<string, unknown>): void {
    const entry: BusEvent = {
      timestamp: new Date().toISOString(),
      event: eventName.toLowerCase(),
      payload: JSON.stringify(payload),
      status: 'emitted',
      execution_id: (payload.execution_id as string) || undefined,
      handlers_triggered: 0,
    };

    try {
      if (!existsSync(EVENT_BUS_DIR)) {
        mkdirSync(EVENT_BUS_DIR, { recursive: true });
      }

      let history: BusHistory;
      if (existsSync(HISTORY_PATH)) {
        history = JSON.parse(readFileSync(HISTORY_PATH, 'utf-8'));
      } else {
        history = { version: '1.0', events: [], max_history: 100 };
      }

      const since = history.events[0]?.timestamp ?? '';
      history.events.unshift(entry);
      if (history.events.length > history.max_history) {
        history.events = history.events.slice(0, history.max_history);
      }

      writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
      this.lastEventCount = history.events.length;
      this.processEvent(entry);
      this.emit('event', entry);
      this.emit('state_delta', { delta: [entry], since });
      this.emit('history_update', history.events.slice(0, 20));
      this.persistEventToNexus(entry);
    } catch {
      // File might be locked
    }
  }

  private persistEventToNexus(evt: BusEvent): void {
    try {
      const db = DatabaseManager.getInstance();
      db.getDb()
        .prepare('INSERT INTO events (type, payload, created_at) VALUES (?, ?, ?)')
        .run(evt.event, JSON.stringify(evt), evt.timestamp);
    } catch {
      // Nexus unavailable — the event-bus file remains the primary source
    }
  }

  async getPersistedEvents(limit = 50): Promise<BusEvent[]> {
    try {
      const db = DatabaseManager.getInstance();
      const rows = db
        .getDb()
        .prepare(
          'SELECT payload FROM events WHERE payload IS NOT NULL ORDER BY created_at DESC LIMIT ?',
        )
        .all(500) as Array<{ payload: string }>;
      const events: BusEvent[] = [];
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.payload);
          if (
            parsed &&
            typeof parsed === 'object' &&
            typeof (parsed as BusEvent).event === 'string' &&
            typeof (parsed as BusEvent).timestamp === 'string'
          ) {
            events.push(parsed as BusEvent);
            if (events.length >= limit) break;
          }
        } catch {
          // Skip payloads that are not BusEvent-shaped
        }
      }
      return events;
    } catch {
      return this.readFileEvents(limit);
    }
  }

  private readFileEvents(limit: number): BusEvent[] {
    try {
      if (!existsSync(HISTORY_PATH)) return [];
      const history: BusHistory = JSON.parse(readFileSync(HISTORY_PATH, 'utf-8'));
      return history.events.slice(0, limit);
    } catch {
      return [];
    }
  }
}

let instance: SharedStateBridge | null = null;

export function getStateBridge(): SharedStateBridge {
  if (!instance) {
    instance = new SharedStateBridge();
  }
  return instance;
}
