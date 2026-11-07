/**
 * CONTRATO del message bus P2P (slice 5, GB-2026-10-24).
 *
 * El bus ya tenia send/poll/ack/broadcast (GB-20261105-c). Este archivo
 * verifica el flujo request -> reply -> wait con correlacion real entre
 * mailboxes por worker:
 *
 *   1. La respuesta aterriza en el mailbox del EMISOR original (no en el del
 *      respondedor) con correlation_id = id del request y el MISMO
 *      conversation_id.
 *   2. El request queda marcado `responded` en el mailbox del respondedor.
 *   3. waitForReply encuentra la respuesta correlacionada y devuelve null en
 *      timeout (no se cuelga).
 *   4. busRequestAndWait hace el ciclo completo en una llamada.
 *
 * Los mailboxes viven en .event-bus/agent-mailboxes (runtime); los nombres de
 * agente llevan un sufijo unico por corrida para no pisar restos de otras
 * ejecuciones, y se purgan al final.
 *
 * Corre con:
 *   node --import tsx --test src/orchestration/agent-message-bus.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it, after } from 'node:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  busRequestAndWait,
  busReply,
  busSend,
  readMailboxForTest,
  waitForReply,
  type AgentMessage,
} from './agent-message-bus.js';

const RUN = Date.now().toString(36);
const ORCH = `orch-${RUN}`;
const WORKER = `worker-${RUN}`;

function cleanup(): void {
  for (const agent of [ORCH, WORKER, `broadcast-${RUN}`]) {
    rmSync(join('.event-bus', 'agent-mailboxes', `${agent}.json`), { force: true });
  }
}

describe('message bus P2P: request -> reply -> wait (slice 5)', () => {
  after(cleanup);

  it('POSITIVO: la respuesta correlacionada aterriza en el mailbox del emisor', async () => {
    const request = busSend({
      from: ORCH,
      to: WORKER,
      subject: 'analiza diff',
      payload: { files: 3 },
      type: 'request',
      ttlSeconds: 60,
    });

    // El "worker" responde: la respuesta debe ir al mailbox de ORCH.
    const original = readMailboxForTest(WORKER).messages.find((m) => m.id === request.id);
    assert.ok(original, 'el request debe estar en el mailbox del worker');
    const reply = busReply({
      from: WORKER,
      original: original as AgentMessage,
      payload: { verdict: 'ok', files: 3 },
    });

    assert.equal(reply.recipient, ORCH, 'la respuesta va al emisor original');
    assert.equal(reply.correlation_id, request.id, 'correlacion con el id del request');
    assert.equal(reply.conversation_id, request.conversation_id, 'misma conversacion');
    assert.equal(reply.type, 'response');

    const got = await waitForReply(ORCH, request.id, { timeoutMs: 2000 });
    assert.ok(got, 'waitForReply debe encontrar la respuesta');
    assert.equal((got?.payload as Record<string, unknown>).verdict, 'ok');

    // El request queda marcado responded en el mailbox del respondedor.
    const after = readMailboxForTest(WORKER).messages.find((m) => m.id === request.id);
    assert.equal(after?.responded, true, 'el original debe marcarse responded');
  });

  it('NEGATIVO: waitForReply devuelve null en timeout (no se cuelga)', async () => {
    const t0 = Date.now();
    const got = await waitForReply(ORCH, 'no-existe', { timeoutMs: 250, pollMs: 50 });
    assert.equal(got, null);
    assert.ok(Date.now() - t0 >= 200, 'respeto el timeout');
    assert.ok(Date.now() - t0 < 5000, 'no espero de mas');
  });

  it('busRequestAndWait: ciclo completo con respuesta diferida del worker', async () => {
    // El worker responde 200 ms despues (simula trabajo real).
    const worker = `worker-late-${RUN}`;
    const orch = `orch-late-${RUN}`;
    setTimeout(() => {
      const req = readMailboxForTest(worker).messages.find((m) => m.type === 'request');
      if (req) busReply({ from: worker, original: req as AgentMessage, payload: { done: true } });
    }, 200);

    const { request, reply } = await busRequestAndWait({
      from: orch,
      to: worker,
      subject: 'trabajo pesado',
      payload: { n: 1 },
      timeoutMs: 5000,
    });
    assert.ok(request.id);
    assert.ok(reply, 'la respuesta diferida debe llegar antes del timeout');
    assert.equal((reply?.payload as Record<string, unknown>).done, true);
    assert.equal(reply?.correlation_id, request.id);
    rmSync(join('.event-bus', 'agent-mailboxes', `${orch}.json`), { force: true });
    rmSync(join('.event-bus', 'agent-mailboxes', `${worker}.json`), { force: true });
  });

  it('NEGATIVO: responder sin el original en el propio mailbox no rompe la entrega', () => {
    const phantom: AgentMessage = {
      id: 'msg-phantom',
      type: 'request',
      sender: ORCH,
      recipient: WORKER,
      conversation_id: 'conv-phantom',
      correlation_id: '',
      subject: 'fantasma',
      payload: null,
      timestamp: new Date().toISOString(),
      expires_at: null,
      priority: 'normal',
      ack: false,
    };
    const reply = busReply({ from: WORKER, original: phantom, payload: 'igual responde' });
    assert.equal(reply.recipient, ORCH);
    assert.equal(reply.correlation_id, 'msg-phantom');
  });
});
