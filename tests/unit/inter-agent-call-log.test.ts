/**
 * inter-agent-call-log.test.ts — la regla C4 (log de llamadas inter-agentes) es
 * operable: cada delegación orquestador→agente queda en JSONL append-only
 * (GB-20261120 S4). La observabilidad nunca bloquea la delegación.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordInterAgentCall } from '../../src/orchestration/agent-delegator.js';

const dirs: string[] = [];
function tempLogPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gv-iac-'));
  dirs.push(dir);
  return join(dir, 'inter-agent-calls.jsonl');
}

test('una delegación ok deja una entrada con esquema de la norma C4', () => {
  const path = tempLogPath();
  recordInterAgentCall(
    { agent: 'editorial-agent', task: 'Reescribe este párrafo'.repeat(30), timeoutSeconds: 390 },
    { success: true, duration: 45006, model: 'gpt-5.6-sol' },
    path,
  );
  const entry = JSON.parse(readFileSync(path, 'utf-8').trim().split('\n')[0]);
  assert.equal(entry.source, 'orchestrator');
  assert.equal(entry.target, 'editorial-agent');
  assert.equal(typeof entry.correlationId, 'string');
  assert.equal(entry.result, 'ok');
  assert.equal(entry.metadata.durationMs, 45006);
  assert.equal(entry.metadata.model, 'gpt-5.6-sol');
  assert.equal(entry.metadata.timeoutSeconds, 390);
  assert.ok(entry.task.description.length <= 300, 'descripción truncada a 300');
});

test('un fallo queda registrado con error truncado', () => {
  const path = tempLogPath();
  recordInterAgentCall(
    { agent: 'e2e-agent', task: 'smoke' },
    { success: false, duration: 218, model: 'ollama/qwen3-14b-32k', error: 'x'.repeat(500) },
    path,
  );
  const entry = JSON.parse(readFileSync(path, 'utf-8').trim().split('\n')[0]);
  assert.equal(entry.result, 'fail');
  assert.ok(entry.error.length <= 300);
  assert.equal(entry.metadata.durationMs, 218);
});

test('append-only: dos llamadas producen dos líneas', () => {
  const path = tempLogPath();
  recordInterAgentCall({ agent: 'a', task: 't' }, { success: true, duration: 1, model: 'm' }, path);
  recordInterAgentCall(
    { agent: 'b', task: 't' },
    { success: false, duration: 2, model: 'm' },
    path,
  );
  const lines = readFileSync(path, 'utf-8').trim().split('\n');
  assert.equal(lines.length, 2);
});

test('un path imposible no lanza (la observabilidad nunca bloquea)', () => {
  const impossible =
    process.platform === 'win32' ? 'Z:\\no-existe\\x\\y.jsonl' : '/proc/no/x.jsonl';
  assert.doesNotThrow(() =>
    recordInterAgentCall(
      { agent: 'a', task: 't' },
      { success: true, duration: 1, model: 'm' },
      impossible,
    ),
  );
});
