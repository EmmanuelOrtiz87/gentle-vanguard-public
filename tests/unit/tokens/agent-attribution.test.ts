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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyZcodeAgent,
  parseCodexSessionMeta,
  classifyCodexAgent,
  codexMessageId,
  classifyClaudeAgent,
  readClaudeProjects,
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

// ─── Claude Code (~/.claude/projects) ─────────────────────────────────────────

test('claude: orquestador real (isSidechain false)', () => {
  assert.deepEqual(classifyClaudeAgent({ isSidechain: false }), { agent: 'orchestrator' });
  assert.deepEqual(classifyClaudeAgent({}), { agent: 'orchestrator' });
});

test('claude: subagente sidechain (Task tool) -> etiqueta estable subagent:sidechain', () => {
  assert.deepEqual(classifyClaudeAgent({ isSidechain: true }), {
    agent: 'subagent',
    agentName: 'subagent:sidechain',
  });
});

test('claude: lee usage real del JSONL (fixture), agrega por sesión y filtra incrementalmente', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gv-claude-fixture-'));
  try {
    // Proyecto codificado como lo hace Claude Code: -Users-x-proj
    const proj = join(dir, '-Users-x-proj');
    mkdirSync(proj);
    const base = 1735689600000; // 2025-01-01T00:00:00.000Z
    const line = (id: string, ts: string, input: number, output: number, side = false) =>
      JSON.stringify({
        parentUuid: null,
        isSidechain: side,
        userType: 'external',
        cwd: '/x/proj',
        sessionId: 'sess-claude-1',
        version: '1.0.85',
        type: 'assistant',
        message: {
          id,
          model: 'claude-sonnet-4-5',
          usage: {
            input_tokens: input,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 1000,
            output_tokens: output,
          },
        },
        timestamp: ts,
      });
    writeFileSync(
      join(proj, 'uuid-aaaa.jsonl'),
      [
        JSON.stringify({ type: 'summary', summary: 'noise' }), // línea no-assistant: se ignora
        line('msg_1', new Date(base).toISOString(), 10, 20),
        JSON.stringify({ type: 'user', message: 'hola' }), // user: se ignora
        line('msg_2', new Date(base + 60_000).toISOString(), 30, 40),
        line('msg_3', new Date(base + 120_000).toISOString(), 5, 5, true), // sidechain
        JSON.stringify('{malformed'), // corrupta: se ignora
      ].join('\n'),
    );
    writeFileSync(
      join(proj, 'uuid-bbbb.jsonl'),
      line('msg_4', new Date(base + 180_000).toISOString(), 0, 0), // sin tokens: se ignora
    );

    const full = readClaudeProjects(0, dir);
    assert.equal(full.sessions.length, 1);
    const s = full.sessions[0];
    assert.equal(s.sessionId, 'sess-claude-1');
    assert.equal(s.tokensInput, 45); // 10 + 30 + 5
    assert.equal(s.tokensOutput, 65); // 20 + 40 + 5
    assert.equal(s.tokensCacheRead, 3000); // 1000 * 3
    assert.equal(s.tokensCacheWrite, 600); // 200 * 3
    assert.equal(s.provider, 'anthropic');
    assert.equal(s.timeUpdated, base + 120_000);
    assert.equal(full.txns.length, 3);
    assert.equal(full.txns[0].messageId, 'claude:msg_1'); // determinista
    assert.equal(full.txns[2].agent, 'subagent');
    assert.equal(full.txns[2].agentName, 'subagent:sidechain');

    // Filtro incremental: solo eventos >= base+120s (el sidechain) sobreviven.
    const inc = readClaudeProjects(base + 120_000, dir);
    assert.equal(inc.txns.length, 1);
    assert.equal(inc.txns[0].messageId, 'claude:msg_3');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('claude: dir inexistente -> vacío sin crash', () => {
  const r = readClaudeProjects(0, join(tmpdir(), 'gv-no-existe-xyz'));
  assert.deepEqual(r, { sessions: [], txns: [] });
});
