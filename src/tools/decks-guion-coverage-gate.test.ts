/**
 * TEST NEGATIVO del gate de cobertura de guiones.
 *
 * Reproduce el hueco real (2026-11-03): los 7 decks del toolkit no tenian
 * guion. Un deck sin guion se presenta a ciegas: se improvisa el texto y lo
 * que se improvisa se inventa (numeros que el repo no respalda, clientes que
 * no existen).
 *
 * Corre con:  node --import tsx --test src/tools/decks-guion-coverage-gate.test.ts
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import {
  checkGuionCoverage,
  parseGuion,
  readDeck,
  REQUIRED_SECTION_KEYS,
} from './decks-guion-coverage-gate.js';

const temps: string[] = [];

after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** Repo minimo con un deck de N slides y, opcionalmente, su guion. */
function makeRepo(slides: number, guion?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'guion-coverage-'));
  temps.push(root);
  const contentDir = join(root, 'docs', 'presentations', 'decks', 'content');
  const speechDir = join(root, 'docs', 'presentations', 'decks', 'speech');
  mkdirSync(contentDir, { recursive: true });
  mkdirSync(speechDir, { recursive: true });

  const body = Array.from(
    { length: slides },
    (_, i) => `    {\n      layout: 'cover',\n      title: 'Slide ${i + 1}',\n    },`,
  ).join('\n');
  writeFileSync(
    join(contentDir, 'mi-deck.es.js'),
    `export default {\n  id: 'mi-deck-es',\n  title: 'Mi deck',\n  slides: [\n${body}\n  ],\n};\n`,
    'utf8',
  );

  if (guion !== undefined) writeFileSync(join(speechDir, 'mi-deck-es.md'), guion, 'utf8');
  return root;
}

/**
 * Etiquetas que el gate exige en un guion en espanol.
 *
 * `REQUIRED_SECTION_KEYS` son objetos (`{ es, en, label }`) porque el gate
 * acepta la variante inglesa: lo que importa es que la informacion este, no
 * como se rotule. Este test escribe guiones en espanol, asi que usa la
 * etiqueta `es`.
 */
const ES_KEYS = REQUIRED_SECTION_KEYS.map((k) => k.es);

/** Guion valido para N slides. */
function guionFor(slides: number, opts: { omitKey?: string; extraSlide?: boolean } = {}): string {
  const sections: string[] = ['# Guion — Mi deck (ES)\n'];
  for (let n = 1; n <= slides; n++) {
    const keys = ES_KEYS.filter((k) => k !== opts.omitKey)
      .map((k) => `**${k.replace(/\*/g, '').replace(':', '')}:** contenido`)
      .join('\n');
    sections.push(`## Slide ${n} — Slide ${n}\n\n${keys}\n`);
  }
  if (opts.extraSlide) {
    sections.push(`## Slide ${slides + 1} — De mas\n\n${ES_KEYS.map((k) => `${k} x`).join('\n')}\n`);
  }
  return sections.join('\n---\n');
}

describe('decks-guion-coverage-gate', () => {
  it('lee el id y la cantidad de slides de un content file', () => {
    const root = makeRepo(3);
    const deck = readDeck(join(root, 'docs', 'presentations', 'decks', 'content', 'mi-deck.es.js'));
    assert.ok(deck);
    assert.equal(deck!.id, 'mi-deck-es');
    assert.equal(deck!.slides, 3);
  });

  it('DETECTA el deck sin guion (el hueco real)', () => {
    const root = makeRepo(3);
    const report = checkGuionCoverage(root);
    assert.equal(report.ok, false);
    const finding = report.findings.find((f) => f.rule === 'guion/missing');
    assert.ok(finding, JSON.stringify(report.findings, null, 2));
    assert.match(finding!.message, /mi-deck-es/);
    assert.match(finding!.message, /3 slides/);
  });

  it('DETECTA la slide sin cubrir en el guion', () => {
    const root = makeRepo(3, guionFor(2));
    const report = checkGuionCoverage(root);
    assert.equal(report.ok, false);
    const finding = report.findings.find((f) => f.rule === 'guion/missing-slide');
    assert.ok(finding, JSON.stringify(report.findings, null, 2));
    assert.match(finding!.message, /## Slide 3/);
  });

  it('DETECTA la seccion sin la clave obligatoria', () => {
    const root = makeRepo(2, guionFor(2, { omitKey: '**Qué decir:**' }));
    const report = checkGuionCoverage(root);
    assert.equal(report.ok, false);
    const finding = report.findings.find((f) => f.rule === 'guion/missing-key');
    assert.ok(finding, JSON.stringify(report.findings, null, 2));
    assert.match(finding!.message, /Qué decir/);
  });

  it('DETECTA la slide de mas (el guion no puede inventar slides)', () => {
    const root = makeRepo(2, guionFor(2, { extraSlide: true }));
    const report = checkGuionCoverage(root);
    assert.equal(report.ok, false);
    const finding = report.findings.find((f) => f.rule === 'guion/extra-slide');
    assert.ok(finding, JSON.stringify(report.findings, null, 2));
  });

  it('acepta un guion completo', () => {
    const root = makeRepo(3, guionFor(3));
    const report = checkGuionCoverage(root);
    assert.equal(report.ok, true, JSON.stringify(report.findings, null, 2));
    assert.equal(report.errors, 0);
    assert.equal(report.decks, 1);
    assert.equal(report.slides, 3);
  });

  it('parsea las secciones en orden', () => {
    const { sections, order } = parseGuion(guionFor(3));
    assert.deepEqual(order, [1, 2, 3]);
    assert.equal(sections.size, 3);
  });
});
