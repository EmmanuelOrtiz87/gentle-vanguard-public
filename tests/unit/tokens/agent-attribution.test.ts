#!/usr/bin/env node
/**
 * Unit Tests: token-ingest — atribución de subagentes nombrados
 *
 * Patrón upstream gentle-ai (e26faee, 2026-09-11): usage atribuido a
 * subagentes NOMBRADOS por runtime, con delivery IDs deterministas.
 *
 * Contratos:
 *  - zcode: querySource/sessionId-prefix detectan subagente (model.role NO
 *    existe en el JSONL real) → etiqueta estable subagent:<uuid-8>.
 *  - codex: session_meta (1ra línea) trae thread_source + nombre real
 *    (payload.source.subagent.other, ej: "guardian").
 *  - codex messageId: ordinal por archivo (append-only) — el viejo índice
 *    relativo a la ventana del run duplicaba filas entre corridas.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  classifyZcodeAgent,
  parseCodexSessionMeta,
  classifyCodexAgent,
  codexMessageId,
} from '../../../src/tokens/token-ingest/readers.js';

const BS = String.fromCharCode(92);

test('zcode: orchestrator real (querySource main_turn, sessionId de usuario)', () => {
  const r = classifyZcodeAgent({ sessionId: 'sess_7d9a387d-bbd7', querySource: 'main_turn' });
  assert.deepEqual(r, { agent: 'orchestrator' });
});

test('zcode: subagente real (querySource subagent) -> etiqueta con uuid-8', () => {
  const r = classifyZcodeAgent({
    sessionId: 'sess_subagent_agent_4dd0db51-b3e9-4040-a060-9c41ef971cde',
    querySource: 'subagent',
  });
  assert.equal(r.agent, 'subagent');
  assert.equal(r.agentName, 'subagent:4dd0db51');
});

test('zcode: subagente detectado por prefijo de sessionId aunque falte querySource', () => {
  const r = classifyZcodeAgent({ sessionId: 'sess_subagent_agent_0123abcd' });
  assert.equal(r.agent, 'subagent');
  assert.equal(r.agentName, 'subagent:0123abcd');
});

test('zcode: fallback legacy model.role (campos que ya no existen en el rollout)', () => {
  assert.deepEqual(classifyZcodeAgent({ model: { role: 'main' } }), { agent: 'orchestrator' });
  assert.equal(classifyZcodeAgent({ model: { role: 'worker' } }).agent, 'subagent');
});

test('zcode: subagente sin uuid parseable -> subagent:unknown (no crashea)', () => {
  const r = classifyZcodeAgent({ sessionId: 'sess_subagent_', querySource: 'subagent' });
  assert.equal(r.agentName, 'subagent:unknown');
});

test('codex session_meta: parsea thread_source y nombre real del subagente', () => {
  const line = `{"timestamp":"2026-09-26T10:00:00.000Z","type":"session_meta","payload":{"thread_source":"subagent","source":{"subagent":{"other":"guardian"}}}}`;
  const meta = parseCodexSessionMeta(line);
  assert.equal(meta.threadSource, 'subagent');
  assert.equal(meta.subagentName, 'guardian');
});

test('codex session_meta: línea que no es meta -> vacío (sin crash)', () => {
  assert.deepEqual(parseCodexSessionMeta('{"payload":{"type":"token_count"}}'), {});
  assert.deepEqual(parseCodexSessionMeta(undefined), {});
  assert.deepEqual(parseCodexSessionMeta('{json roto'), {});
});

test('codex: thread_source user -> orchestrator', () => {
  assert.deepEqual(classifyCodexAgent({ threadSource: 'user' }), { agent: 'orchestrator' });
  assert.deepEqual(classifyCodexAgent({}), { agent: 'orchestrator' });
});

test('codex: subagente con nombre real (guardian) -> subagent:guardian', () => {
  const r = classifyCodexAgent({ threadSource: 'subagent', subagentName: 'guardian' });
  assert.deepEqual(r, { agent: 'subagent', agentName: 'guardian' });
});

test('codex: guardian_review sin nombre -> subagent:guardian_review (etiqueta por fuente)', () => {
  const r = classifyCodexAgent({ threadSource: 'guardian_review' });
  assert.deepEqual(r, { agent: 'subagent', agentName: 'subagent:guardian_review' });
});

test('codex messageId: determinista por (sessionId, archivo, ordinal) — no por ventana del run', () => {
  const a = codexMessageId('sess-abc', 'rollout-2026-09-26T10-00-00-uuid.jsonl', 3);
  const b = codexMessageId('sess-abc', 'rollout-2026-09-26T10-00-00-uuid.jsonl', 3);
  const c = codexMessageId('sess-abc', 'rollout-2026-09-26T10-00-00-uuid.jsonl', 4);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.ok(a.startsWith('codex:sess-abc:rollout-'));
});
