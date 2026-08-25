/**
 * Event Sourcing API — Wrapper exportable para appendEvent y otras operaciones
 *
 * Este módulo envuelve event-sourcing.ts para permitir uso programático
 * desde otros módulos del stack.
 */

import { runNpxTsx } from './core/run-command';

interface AppendEventOptions {
  aggregateId: string;
  eventType: string;
  eventData: Record<string, unknown>;
  quiet?: boolean;
}

/**
 * Append an event to the event store.
 *
 * Note: This spawns the event-sourcing.ts CLI since it uses command-line args.
 * For synchronous operations that should not block, use fire-and-forget.
 */
export async function appendEvent(options: AppendEventOptions): Promise<void> {
  const { aggregateId, eventType, eventData, quiet = false } = options;

  return new Promise((resolve, reject) => {
    const args = [
      '-Action',
      'append',
      '-AggregateId',
      aggregateId,
      '-EventType',
      eventType,
    ];

    if (eventData && Object.keys(eventData).length > 0) {
      args.push('-EventData', JSON.stringify(eventData));
    }

    const child = runNpxTsx('src/event-sourcing.ts', args, {
      stdio: quiet ? 'ignore' : 'pipe',
    });

    let stdout = '';
    let stderr = '';

    if (!quiet) {
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
    }

    child.on('close', (code) => {
      if (code === 0) {
        if (!quiet) console.log(stdout);
        resolve();
      } else {
        if (!quiet) console.error(stderr);
        reject(new Error(`Event sourcing failed with code ${code}`));
      }
    });

    child.on('error', (err) => {
      if (!quiet) console.error('Failed to spawn event-sourcing.ts:', err);
      resolve(); // Fail silently - event sourcing is best-effort
    });
  });
}

/**
 * Fire-and-forget event append (non-blocking).
 * Use this for user-context events that should not block the main operation.
 */
export function appendEventFireAndForget(options: AppendEventOptions): void {
  const { aggregateId, eventType, eventData } = options;

  try {
    const args = [
      '-Action',
      'append',
      '-AggregateId',
      aggregateId,
      '-EventType',
      eventType,
      '-EventData',
      JSON.stringify(eventData ?? {}),
    ];

    // Spawn detached process (hidden, shell-free)
    const child = runNpxTsx('src/event-sourcing.ts', args, {
      stdio: 'ignore',
      detached: true,
    });

    // Unref to let parent exit
    child.unref();
  } catch {
    // Fail silently - event sourcing is best-effort
  }
}

/**
 * Get events for an aggregate.
 */
export async function getEvents(aggregateId: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const args = ['-Action', 'replay', '-AggregateId', aggregateId];

    const child = runNpxTsx('src/event-sourcing.ts', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        try {
          const events = JSON.parse(stdout);
          resolve(events);
        } catch {
          resolve([]);
        }
      } else {
        reject(new Error(`Failed to get events: ${stderr}`));
      }
    });

    child.on('error', reject);
  });
}

/**
 * Get projection for an aggregate.
 */
export async function getProjection(aggregateId: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const args = [
      '-Action',
      'project',
      '-AggregateId',
      aggregateId,
    ];

    const child = runNpxTsx('src/event-sourcing.ts', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        try {
          const projection = JSON.parse(stdout);
          resolve(projection);
        } catch {
          resolve({});
        }
      } else {
        reject(new Error(`Failed to get projection: ${stderr}`));
      }
    });

    child.on('error', reject);
  });
}

// Re-export
export default { appendEvent, appendEventFireAndForget, getEvents, getProjection };
