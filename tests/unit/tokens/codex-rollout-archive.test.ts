import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import {
  codexMessageId,
  readCodexRollout,
  readRolloutText,
  walkJsonl,
} from '../../../src/tokens/token-ingest/readers.js';

const SESSION = '01a1e925-82e7-7e83-846d-5fa4747c4e39';
const META = JSON.stringify({
  type: 'session_meta',
  payload: { cwd: 'C:/Workspace_local/gentle-vanguard' },
});

function tokenEvent(ts: string, input: number): string {
  return JSON.stringify({
    timestamp: ts,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: {
          input_tokens: input,
          output_tokens: 1,
          cached_input_tokens: 0,
          reasoning_output_tokens: 0,
        },
      },
    },
  });
}

test('codex: ingesta archived_sessions comprimido (.jsonl.zst) y plano', () => {
  const home = mkdtempSync(join(tmpdir(), 'gv-codex-archive-'));
  try {
    const sessions = join(home, '.codex', 'sessions', '2026', '11', '17');
    const archived = join(home, '.codex', 'archived_sessions');
    mkdirSync(sessions, { recursive: true });
    mkdirSync(archived, { recursive: true });
    const zstFile = join(sessions, `rollout-2026-11-17T07-00-00-${SESSION}.jsonl.zst`);
    writeFileSync(
      zstFile,
      zstdCompressSync(
        Buffer.from([META, tokenEvent('2026-11-17T07:00:00.000Z', 100)].join('\n') + '\n'),
      ),
    );
    const plainFile = join(
      archived,
      'rollout-2026-11-17T08-00-00-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl',
    );
    writeFileSync(
      plainFile,
      [
        META,
        tokenEvent('2026-11-17T08:00:00.000Z', 200),
        tokenEvent('2026-11-17T08:01:00.000Z', 300),
      ].join('\n') + '\n',
    );

    const roots = [join(home, '.codex', 'sessions'), archived];
    assert.equal(walkJsonl(roots[0]).length, 1, 'encuentra el rollout comprimido');
    assert.ok(readRolloutText(zstFile).startsWith('{'), 'descomprime zstd');

    const result = readCodexRollout(0, roots);
    assert.equal(result.txns.length, 3);
    assert.equal(result.sessions.find((s) => s.sessionId === SESSION)?.tokensInput, 100);
    // El messageId del archivo comprimido no cambia por el sufijo .zst.
    assert.equal(
      result.txns.find((t) => t.sessionId === SESSION)?.messageId,
      codexMessageId(SESSION, `rollout-2026-11-17T07-00-00-${SESSION}.jsonl`, 1),
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('codex: ordinal estable entre corridas incrementales (no duplica ni omite)', () => {
  const home = mkdtempSync(join(tmpdir(), 'gv-codex-incremental-'));
  try {
    const archived = join(home, '.codex', 'archived_sessions');
    mkdirSync(archived, { recursive: true });
    const file = join(archived, `rollout-2026-11-17T09-00-00-${SESSION}.jsonl`);
    const first = tokenEvent('2026-11-17T09:00:00.000Z', 10);
    const second = tokenEvent('2026-11-17T09:01:00.000Z', 20);
    writeFileSync(file, [META, first, second].join('\n') + '\n');
    const roots = [archived];

    const full = readCodexRollout(0, roots);
    assert.equal(full.txns.length, 2);
    const firstIds = full.txns.map((t) => t.messageId);

    // Re-leer el mismo evento en otra ventana devuelve el MISMO id (estabilidad).
    const incremental = readCodexRollout(Date.parse('2026-11-17T09:00:30.000Z'), roots);
    assert.equal(incremental.txns.length, 1, 'solo el evento dentro de la ventana');
    assert.equal(incremental.txns[0].messageId, firstIds[1], 'mismo evento, mismo id');

    appendFileSync(file, tokenEvent('2026-11-17T09:02:00.000Z', 30) + '\n');
    const next = readCodexRollout(Date.parse('2026-11-17T09:01:30.000Z'), roots);
    assert.equal(next.txns.length, 1);
    assert.ok(!firstIds.includes(next.txns[0].messageId), 'el evento nuevo recibe un id nuevo');
    assert.equal(
      next.txns[0].messageId,
      codexMessageId(SESSION, `rollout-2026-11-17T09-00-00-${SESSION}.jsonl`, 3),
      'ordinal absoluto del archivo, no relativo a la ventana',
    );
    // El borde de la ventana se re-lee (mismo id, el UNIQUE del DB lo descarta).
    const boundary = readCodexRollout(Date.parse('2026-11-17T09:02:00.000Z'), roots);
    assert.equal(boundary.txns.length, 1);
    assert.equal(boundary.txns[0].messageId, next.txns[0].messageId);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('codex: continuaciones "<parent>_<child>" se agrupan por id del meta (no codex-unknown)', () => {
  const home = mkdtempSync(join(tmpdir(), 'gv-codex-continuation-'));
  try {
    const archived = join(home, '.codex', 'archived_sessions');
    mkdirSync(archived, { recursive: true });
    const parent = '01a02c2e-a93a-7b30-a19e-5c99ffb92777';
    const child = '01a02c30-c8e7-7020-9d28-1ba9ecaa925f';
    const metaWithId = JSON.stringify({
      type: 'session_meta',
      payload: { id: parent, session_id: parent, cwd: 'C:/repo' },
    });
    const continued = join(archived, `rollout-2026-08-22T22-16-29-${parent}_${child}.jsonl`);
    writeFileSync(
      continued,
      [metaWithId, tokenEvent('2026-08-23T01:16:30.000Z', 40)].join('\n') + '\n',
    );
    // Sin id en el meta: el fallback toma el uuid físico (child), nunca 'codex-unknown'.
    const noId = join(archived, `rollout-2026-08-22T22-20-00-${child}_${SESSION}.jsonl`);
    writeFileSync(noId, [META, tokenEvent('2026-08-23T01:20:01.000Z', 60)].join('\n') + '\n');

    const result = readCodexRollout(0, [archived]);
    assert.equal(result.txns.length, 2);
    assert.ok(
      result.sessions.every((s) => s.sessionId !== 'codex-unknown'),
      'ningún archivo cae en codex-unknown',
    );
    assert.equal(
      result.sessions.find((s) => s.sessionId === parent)?.tokensInput,
      40,
      'la continuación se agrupa bajo el id del meta',
    );
    assert.equal(
      result.sessions.find((s) => s.sessionId === SESSION)?.tokensInput,
      60,
      'sin meta.id usa el último uuid del nombre',
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
