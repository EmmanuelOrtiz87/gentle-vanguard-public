/**
 * Ports barrel + factory (STACK-EVOLUTION-PLAN F3.3).
 *
 * `resolvePorts()` makes the adapter swap a configuration concern:
 *
 *   GV_STORAGE = memory | sqlite-disk   (default: sqlite-disk, local-first)
 *   GV_QUEUE   = in-process | redis     (default: in-process; redis = future adapter)
 *   GV_TRACING = noop | otel            (default: noop)
 *
 * The env source is the ConfigService contract (src/config/config-service.ts):
 * callers pass `configService` when they have one, or a raw env record in
 * tests. Unknown values fall back to the local-first default with no throw
 * (ADR-0017: never break local startup).
 */

export type { StoragePort, StorageEntry, SqliteDiskStorageOptions } from './storage-port';
export { InMemoryStorage, SqliteDiskStorage } from './storage-port';
export type { QueuePort, QueueMessage } from './queue-port';
export { InProcessQueue } from './queue-port';
export type { TracingPort, SpanHandle, SpanOptions, OtelTracingPortOptions } from './tracing-port';
export { NoopTracingPort, OtelTracingPort } from './tracing-port';

import { join } from 'path';
import { InMemoryStorage, SqliteDiskStorage, type StoragePort } from './storage-port';
import { InProcessQueue, type QueuePort } from './queue-port';
import { NoopTracingPort, OtelTracingPort, type TracingPort } from './tracing-port';

export interface Ports {
  storage: StoragePort;
  queue: QueuePort;
  tracing: TracingPort;
  /** Resolved adapter names (for logging / watchtower checks). */
  adapters: { storage: string; queue: string; tracing: string };
}

export interface ResolvePortsOptions {
  /** Raw env source; defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Override the SQLite file location (defaults to .runtime/ports-storage.db under repo root). */
  sqlitePath?: string;
}

/** Minimal env-shaped source so ConfigService instances satisfy it structurally. */
type EnvSource =
  Pick<NodeJS.ProcessEnv, 'GV_STORAGE' | 'GV_QUEUE' | 'GV_TRACING'> | NodeJS.ProcessEnv;

export function resolvePorts(opts: ResolvePortsOptions & { env?: EnvSource } = {}): Ports {
  const env = (opts.env ?? process.env) as NodeJS.ProcessEnv;
  const storageKind = (env.GV_STORAGE ?? 'sqlite-disk').trim();
  const queueKind = (env.GV_QUEUE ?? 'in-process').trim();
  const tracingKind = (env.GV_TRACING ?? 'noop').trim();

  let storage: StoragePort;
  if (storageKind === 'memory') {
    storage = new InMemoryStorage();
  } else if (storageKind === 'sqlite-disk') {
    storage = new SqliteDiskStorage({
      dbPath: opts.sqlitePath ?? join(process.cwd(), '.runtime', 'ports-storage.db'),
    });
  } else {
    // Unknown/declared-future value (e.g. postgres): local-first fallback, not a crash.
    storage = new InMemoryStorage();
  }

  let queue: QueuePort = new InProcessQueue();
  if (queueKind !== 'in-process') {
    // GV_QUEUE=redis is a future adapter (ADR-0024); fall back in-process today.
    queue = new InProcessQueue();
  }

  const tracing: TracingPort =
    tracingKind === 'otel' ? new OtelTracingPort() : new NoopTracingPort();

  return {
    storage,
    queue,
    tracing,
    adapters: {
      storage:
        storage instanceof InMemoryStorage
          ? storageKind === 'memory'
            ? 'memory'
            : `${storageKind} (fallback→memory)`
          : 'sqlite-disk',
      queue: queueKind === 'in-process' ? 'in-process' : `${queueKind} (fallback→in-process)`,
      tracing: tracingKind === 'otel' ? 'otel' : 'noop',
    },
  };
}
