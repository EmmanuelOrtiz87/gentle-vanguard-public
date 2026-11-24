/**
 * Contrato del recall nativo de Engram (Fase 6, 2026-11-24).
 *
 * El problema medido: Engram tenía 128 escrituras en 7 días y 7 búsquedas — el
 * conocimiento se acumulaba y no se recuperaba. El recall ahora es un PASO del
 * hook de pre-respuesta; estos tests muerden para que no vuelva a depender de
 * que el agente "se acuerde" de buscar.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildRecallQuery,
  formatRecall,
  parseRecallPayload,
  recall,
  type RecalledLesson,
} from './engram-recall.js';

const LESSONS: RecalledLesson[] = [
  { id: 10079, title: 'Sincronización del sitio público: poda de huérfanos', type: 'bugfix' },
  { id: 10082, title: 'Índice del canon y rangos declarados', type: 'pattern' },
];

test('la consulta usa los términos salientes del mensaje, no el mensaje entero', () => {
  const query = buildRecallQuery('sincronizar el repositorio publico con la allowlist');
  assert.ok(query);
  assert.match(query, /sincronizar/);
  assert.match(query, /repositorio/);
  assert.match(query, /allowlist/);
  assert.ok(!query.includes('el '), 'los stopwords no van a la consulta');
});

test('un mensaje sin términos útiles NO dispara recall (no ruido)', () => {
  assert.equal(buildRecallQuery('de la con que los las'), null);
  assert.equal(buildRecallQuery(''), null);
});

test('el payload de Engram se parsea a lecciones', () => {
  const stdout = JSON.stringify({
    results: [
      { id: 1, title: 'Uno', type: 'bugfix' },
      { id: 2, title: 'Dos', type: 'pattern' },
    ],
  });
  const lessons = parseRecallPayload(stdout);
  assert.equal(lessons.length, 2);
  assert.equal(lessons[0].id, 1);
});

test('un payload roto no rompe nada: cero lecciones', () => {
  assert.deepEqual(parseRecallPayload('esto no es json'), []);
  assert.deepEqual(parseRecallPayload(null), []);
});

test('el recall consulta Engram una vez y después sirve de caché', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'gv-engram-recall-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let calls = 0;
  const runner = () => {
    calls++;
    return JSON.stringify({
      results: [{ id: 7, title: 'Lección', type: 'pattern' }],
    });
  };

  const first = recall('sincronizacion del repositorio publico', { workspaceRoot: dir, runner });
  assert.equal(first.source, 'live');
  assert.equal(first.lessons.length, 1);
  assert.equal(calls, 1);

  const second = recall('sincronizacion del repositorio publico', { workspaceRoot: dir, runner });
  assert.equal(second.source, 'cache');
  assert.equal(second.lessons.length, 1);
  assert.equal(calls, 1, 'la caché evita volver a consultar Engram');
});

test('si Engram falla, el recall devuelve cero lecciones y NO lanza', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'gv-engram-recall-fail-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = recall('repositorio publico sincronizacion', {
    workspaceRoot: dir,
    runner: () => {
      throw new Error('engram caído');
    },
  });
  assert.deepEqual(result.lessons, []);
});

test('el recordatorio nombra las lecciones y su id', () => {
  const lines = formatRecall({ query: 'q', lessons: LESSONS, source: 'live' });
  assert.ok(lines.length > 0);
  assert.match(lines.join('\n'), /#10079/);
  assert.match(lines.join('\n'), /Sincronización del sitio público/);
  assert.match(lines.join('\n'), /ENGRAM RECALL/);
});

test('sin lecciones no hay recordatorio (no ruido en cada turno)', () => {
  assert.deepEqual(formatRecall({ query: 'q', lessons: [], source: 'live' }), []);
});
