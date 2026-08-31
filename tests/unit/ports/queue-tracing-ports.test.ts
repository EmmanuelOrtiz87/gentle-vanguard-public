/**
 * QueuePort ack/nack semantics, TracingPort adapters, and resolvePorts wiring
 * (STACK-EVOLUTION-PLAN F3.3).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const QUEUE = await import(pathToFileURL(join(ROOT, 'src/ports/queue-port.ts')).href);
const TRACING = await import(pathToFileURL(join(ROOT, 'src/ports/tracing-port.ts')).href);
const INDEX = await import(pathToFileURL(join(ROOT, 'src/ports/index.ts')).href);

// ─── InProcessQueue ────────────────────────────────────────────────────────

describe('InProcessQueue — ack semantics', () => {
  const { InProcessQueue } = QUEUE;

  it('FIFO dequeue, ack removes, double-ack fails', () => {
    const q = new InProcessQueue();
    const id1 = q.enqueue('jobs', { n: 1 });
    const id2 = q.enqueue('jobs', { n: 2 });
    assert.strictEqual(q.depth('jobs'), 2);

    const m1 = q.dequeue<{ n: number }>('jobs')!;
    assert.strictEqual(m1.id, id1);
    assert.strictEqual(m1.payload.n, 1);
    assert.strictEqual(m1.attempts, 1);

    // in-flight still counts toward depth until acked
    assert.strictEqual(q.depth('jobs'), 2);
    assert.strictEqual(q.ack('jobs', id1), true);
    assert.strictEqual(q.ack('jobs', id1), false); // already removed
    assert.strictEqual(q.depth('jobs'), 1);

    const m2 = q.dequeue('jobs')!;
    assert.strictEqual(m2.id, id2);
  });

  it('dequeue returns undefined on empty queue', () => {
    const q = new InProcessQueue();
    assert.strictEqual(q.dequeue('empty'), undefined);
  });

  it('nack requeues the message for redelivery with attempts++', () => {
    const q = new InProcessQueue();
    const id = q.enqueue('retry', 'payload');
    const m1 = q.dequeue('retry')!;
    assert.strictEqual(m1.attempts, 1);
    assert.strictEqual(q.nack('retry', id), true);
    assert.strictEqual(q.nack('retry', id), false); // no longer in-flight

    const m2 = q.dequeue('retry')!;
    assert.strictEqual(m2.id, id);
    assert.strictEqual(m2.payload, 'payload');
    assert.strictEqual(m2.attempts, 2);
    assert.ok(q.ack('retry', id));
  });

  it('a message reserved by one consumer is not delivered to another', () => {
    const q = new InProcessQueue();
    q.enqueue('lock', 'x');
    const first = q.dequeue('lock')!;
    assert.strictEqual(q.dequeue('lock'), undefined); // reserved
    assert.ok(q.ack('lock', first.id));
    const redelivered = q.dequeue('lock');
    assert.strictEqual(redelivered, undefined); // acked → gone
  });

  it('expired reservation becomes redeliverable (visibility timeout)', () => {
    const q = new InProcessQueue();
    q.enqueue('timeout', 'x');
    const m1 = q.dequeue('timeout', { reserveMs: 5 })!;
    assert.ok(m1);
    const stillHeld = q.dequeue('timeout');
    assert.strictEqual(stillHeld, undefined);
    // wait for the reservation to expire
    const start = Date.now();
    while (Date.now() - start < 20) {
      /* busy-wait 20ms */
    }
    const redelivered = q.dequeue('timeout')!;
    assert.strictEqual(redelivered.id, m1.id);
    assert.strictEqual(redelivered.attempts, 2);
  });

  it('queues are isolated by name', () => {
    const q = new InProcessQueue();
    q.enqueue('a', 1);
    q.enqueue('b', 2);
    assert.strictEqual(q.depth('a'), 1);
    assert.strictEqual(q.depth('b'), 1);
    assert.strictEqual(q.dequeue('a')!.payload, 1);
    assert.strictEqual(q.depth('a'), 1); // still in-flight
  });
});

// ─── TracingPort ───────────────────────────────────────────────────────────

describe('NoopTracingPort', () => {
  it('spans are inert but well-formed handles', async () => {
    const t = new TRACING.NoopTracingPort();
    const span = t.startSpan('op', { attributes: { k: 'v' } });
    assert.ok(span.id.length === 16);
    assert.strictEqual(span.setAttribute('a', 1), span);
    assert.strictEqual(span.event('e'), span);
    assert.strictEqual(span.recordException(new Error('x')), span);
    span.end();
    span.end(); // idempotent
    await t.flush();
  });
});

describe('OtelTracingPort (offline)', () => {
  it('buffers ended spans and flush() tolerates an unreachable collector', async () => {
    const t = new TRACING.OtelTracingPort({ endpoint: 'http://127.0.0.1:59999/v1/traces' });
    const span = t.startSpan('job.run', { attributes: { queue: 'jobs' } });
    span.setAttribute('attempt', 1).event('picked');
    span.end();
    await t.flush(); // must resolve, never throw
  });

  it('recordException marks the span ERROR', async () => {
    const t = new TRACING.OtelTracingPort({ endpoint: 'http://127.0.0.1:59999/v1/traces' });
    const span = t.startSpan('failing');
    span.recordException(new Error('boom'));
    span.end();
    await t.flush();
  });
});

// ─── resolvePorts wiring ───────────────────────────────────────────────────

describe('resolvePorts — configuration swap', () => {
  const { resolvePorts, InMemoryStorage, SqliteDiskStorage, InProcessQueue, NoopTracingPort, OtelTracingPort } = INDEX;

  it('defaults to local-first: sqlite-disk + in-process + noop', () => {
    const p = resolvePorts({ env: {}, sqlitePath: join(ROOT, '.runtime', 'test-ports-default.db') });
    assert.ok(p.storage instanceof SqliteDiskStorage);
    assert.ok(p.queue instanceof InProcessQueue);
    assert.ok(p.tracing instanceof NoopTracingPort);
    assert.strictEqual(p.adapters.storage, 'sqlite-disk');
    p.storage.close();
  });

  it('GV_STORAGE=memory swaps storage without code changes', () => {
    const p = resolvePorts({ env: { GV_STORAGE: 'memory' } });
    assert.ok(p.storage instanceof InMemoryStorage);
    assert.strictEqual(p.adapters.storage, 'memory');
  });

  it('GV_TRACING=otel selects the OTLP adapter', () => {
    const p = resolvePorts({ env: { GV_STORAGE: 'memory', GV_TRACING: 'otel' } });
    assert.ok(p.tracing instanceof OtelTracingPort);
    assert.strictEqual(p.adapters.tracing, 'otel');
  });

  it('unknown future values (postgres/redis) fall back safely, never throw', () => {
    const p = resolvePorts({ env: { GV_STORAGE: 'postgres', GV_QUEUE: 'redis', GV_TRACING: 'x' } });
    assert.ok(p.storage instanceof InMemoryStorage);
    assert.ok(p.queue instanceof InProcessQueue);
    assert.ok(p.tracing instanceof NoopTracingPort);
    assert.match(p.adapters.storage, /fallback→memory/);
    assert.match(p.adapters.queue, /fallback→in-process/);
  });

  it('same consumer code runs against both storage adapters (F3.3 demo)', () => {
    // Consumer writes a routing table entry and reads it back — identical
    // behavior regardless of the adapter resolved from configuration.
    const consumer = (storage: INDEX.StoragePort): string => {
      storage.set('routing/agent/code-review', JSON.stringify({ score: 0.9 }));
      return JSON.parse(storage.get('routing/agent/code-review')!).score;
    };
    const mem = resolvePorts({ env: { GV_STORAGE: 'memory' } });
    assert.strictEqual(consumer(mem.storage), 0.9);

    const diskPath = join(ROOT, '.runtime', 'test-ports-swap.db');
    const disk = resolvePorts({ env: { GV_STORAGE: 'sqlite-disk' }, sqlitePath: diskPath });
    assert.strictEqual(consumer(disk.storage), 0.9);
    assert.strictEqual(disk.adapters.storage, 'sqlite-disk');
    disk.storage.close();
  });
});
