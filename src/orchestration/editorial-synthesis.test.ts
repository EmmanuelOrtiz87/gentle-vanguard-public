import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editorialIntent } from './editorial-intent.js';
import {
  checkEvidence,
  extractJsonObject,
  normalizeFindings,
  readSynthesisSources,
} from './editorial-synthesis.js';

const sources = [
  { id: 'F1', name: 'Ana.md', text: 'El pago de 12,5 EUR fue autorizado.' },
  { id: 'F2', name: 'Luis.md', text: 'El pago de 12,5 EUR no fue autorizado.' },
];

test('routes synthesis in ES, EN and PT and leaves code migration outside', () => {
  for (const task of [
    'Unifica la información de distintos autores',
    'Synthesize the findings from both documents',
    'Consolide as informações dos relatórios',
  ])
    assert.equal(editorialIntent(task), 'synthesis');
  assert.equal(editorialIntent('Migra el código de JavaScript a TypeScript'), undefined);
});

test('requires literal evidence from every source', () => {
  const evidence = sources.map(({ id, text }) => ({ sourceId: id, quote: text }));
  assert.deepEqual(checkEvidence(sources, evidence), []);
  assert.ok(checkEvidence(sources, evidence.slice(0, 1)).length);
  assert.ok(
    checkEvidence(sources, [evidence[0], { ...evidence[1], quote: sources[0].text }]).length,
  );
  assert.ok(checkEvidence(sources, [...evidence, { sourceId: 'F3', quote: 'Fabricated' }]).length);
});

test('rejects missing, empty and mislabeled source input', () => {
  assert.deepEqual(readSynthesisSources(JSON.stringify(sources)), sources);
  for (const candidate of [
    sources.slice(0, 1),
    [sources[0], sources[0]],
    [sources[0], { ...sources[1], text: ' ' }],
  ]) {
    assert.throws(() => readSynthesisSources(JSON.stringify(candidate)));
  }
});

test('recognizes distinct editorial operations through their usual requests', () => {
  const cases = {
    summary: 'Resume el informe',
    translation: 'Translate this document',
    transcription: 'Transcreva o áudio',
    rewrite: 'Reescribe el correo',
    extract: 'Extrae citas del texto',
    conversion: 'Convierte este PDF a Markdown',
    draft: 'Redacta un mensaje para el equipo',
  };
  for (const [operation, task] of Object.entries(cases))
    assert.equal(editorialIntent(task), operation);
  assert.equal(editorialIntent('Por favor, prepara un resumen de la reunión'), 'summary');
  assert.equal(editorialIntent('Faça um resumo da reunião'), 'summary');
  assert.equal(editorialIntent('Dame un extracto del informe'), 'extract');
});

test('extracts the first balanced JSON object from provider renders', () => {
  assert.deepEqual(extractJsonObject('{"verdict":"pass","findings":[]}'), {
    verdict: 'pass',
    findings: [],
  });
  // Prosas y decoraciones del CLI alrededor del JSON (hallazgo medido 2026-11-19)
  assert.deepEqual(
    extractJsonObject(
      'Analizo el material.\n{"status":"draft","text":"contenido","limitations":[]}',
    ),
    { status: 'draft', text: 'contenido', limitations: [] },
  );
  assert.deepEqual(extractJsonObject('```json\n{"verdict":"fail","findings":["omitió X"]}\n```'), {
    verdict: 'fail',
    findings: ['omitió X'],
  });
  // Llaves dentro de strings y escapes no rompen el balance
  assert.deepEqual(extractJsonObject('{"text":"usa { y } \\"cuidado\\""}'), {
    text: 'usa { y } "cuidado"',
  });
  for (const broken of ['sin json', '{"cortado": "va', 'nada {} de {} donde {"a":1}']) {
    if (broken === 'nada {} de {} donde {"a":1}') {
      assert.deepEqual(extractJsonObject(broken), { a: 1 });
    } else {
      assert.throws(() => extractJsonObject(broken));
    }
  }
});

test('normalizes review findings without discarding their content', () => {
  // Hallazgo medido 2026-11-19: el revisor devolvió objetos {fragment, discrepancy}
  assert.deepEqual(
    normalizeFindings([
      'afirmación sin respaldo',
      { fragment: '«texto citado»', discrepancy: 'la fuente dice lo contrario' },
      { unknown: 'estructura' },
      42,
    ]),
    ['afirmación sin respaldo', '«texto citado» — la fuente dice lo contrario', 'estructura', '42'],
  );
});
