/**
 * QueuePort — hexagonal port for task/job queues (STACK-EVOLUTION-PLAN F3.3).
 *
 * Contract: at-least-once delivery with explicit ack. `dequeue` marks a message
 * in-flight; only `ack` removes it. `nack` (or a crash before ack) makes the
 * message eligible for redelivery.
 *
 * Adapters:
 *   - InProcessQueue → today's local-first default (single instance)
 *   - Future: Redis/BullMQ adapter behind the same interface (GV_QUEUE=redis),
 *     which is what unlocks multi-instance horizontal scale. See ADR-0024.
 */

export interface QueueMessage<T = unknown> {
  id: string;
  queue: string;
  payload: T;
  /** ISO timestamp of enqueue. */
  enqueuedAt: string;
  /** Delivery attempt count (increments on redelivery). */
  attempts: number;
}

export interface QueuePort {
  /** Enqueue a payload; returns the assigned message id. */
  enqueue<T>(queue: string, payload: T): string;

  /**
   * Dequeue the next pending message (FIFO), marking it in-flight.
   * Returns undefined when the queue is empty. A message stays reserved until
   * `ack` or `nack` is called on its id.
   */
  dequeue<T = unknown>(queue: string, opts?: { reserveMs?: number }): QueueMessage<T> | undefined;

  /** Acknowledge successful processing — removes the message. True when the id was in-flight. */
  ack(queue: string, id: string): boolean;

  /** Negatively acknowledge — requeues the message for redelivery. True when the id was in-flight. */
  nack(queue: string, id: string): boolean;

  /** Pending + in-flight message count for a queue. */
  depth(queue: string): number;
}

interface StoredMessage {
  id: string;
  payload: unknown;
  enqueuedAt: string;
  attempts: number;
  /** Expiry of the in-flight reservation (epoch ms); 0 = pending, not in-flight. */
  reservedUntil: number;
}

/** In-process FIFO queue with reservation expiry (visibility timeout). */
export class InProcessQueue implements QueuePort {
  private nextId = 1;
  private readonly queues = new Map<string, StoredMessage[]>();

  private q(queue: string): StoredMessage[] {
    let list = this.queues.get(queue);
    if (!list) {
      list = [];
      this.queues.set(queue, list);
    }
    return list;
  }

  enqueue<T>(queue: string, payload: T): string {
    const id = `qmsg-${this.nextId++}`;
    this.q(queue).push({
      id,
      payload,
      enqueuedAt: new Date().toISOString(),
      attempts: 0,
      reservedUntil: 0,
    });
    return id;
  }

  dequeue<T = unknown>(
    queue: string,
    opts: { reserveMs?: number } = {},
  ): QueueMessage<T> | undefined {
    const reserveMs = opts.reserveMs ?? 30_000;
    const now = Date.now();
    const list = this.q(queue);
    const idx = list.findIndex((m) => m.reservedUntil === 0 || m.reservedUntil < now);
    if (idx === -1) return undefined;
    const m = list[idx];
    m.reservedUntil = now + reserveMs;
    m.attempts += 1;
    return {
      id: m.id,
      queue,
      payload: m.payload as T,
      enqueuedAt: m.enqueuedAt,
      attempts: m.attempts,
    };
  }

  private takeInFlight(queue: string, id: string): StoredMessage | undefined {
    const list = this.q(queue);
    const idx = list.findIndex((m) => m.id === id && m.reservedUntil > Date.now());
    if (idx === -1) return undefined;
    const [m] = list.splice(idx, 1);
    return m;
  }

  ack(queue: string, id: string): boolean {
    return this.takeInFlight(queue, id) !== undefined;
  }

  nack(queue: string, id: string): boolean {
    const m = this.takeInFlight(queue, id);
    if (!m) return false;
    m.reservedUntil = 0;
    this.q(queue).push(m); // requeue at the tail for redelivery
    return true;
  }

  depth(queue: string): number {
    return this.q(queue).length;
  }
}
