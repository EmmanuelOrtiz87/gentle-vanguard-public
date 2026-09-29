import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { detectPrintHtmlViolations } from '../../src/tools/print-html-invariant.js';

/**
 * NEGATIVE TESTS de la invariante de CSS inlineado.
 *
 * Un guard que nunca se vio fallar no es un guard: es una hope. Estos tests
 * construyen generadores de PDF EN UN DIRECTORIO TEMPORAL y comprueban que el
 * detector los rechaza, para que el guard del stack no pueda volverse vacuo
 * sin que nadie se entere.
 */

function makeGen(dir: string, name: string, body: string): void {
  mkdirSync(join(dir, name.replace('.ts', '')), { recursive: true });
  writeFileSync(join(dir, name.replace('.ts', ''), name), body, 'utf8');
}

function scan(): ReturnType<typeof detectPrintHtmlViolations> {
  return detectPrintHtmlViolations([tempRoot]);
}

let tempRoot: string;

test.before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'print-invariant-'));
});

test.after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

test('detecta un generador que emite la hoja linkeada', () => {
  makeGen(
    tempRoot,
    'bad-link.ts',
    `export function buildHtml() {
  return \`<!doctype html><html><head>
<link rel="stylesheet" href="../../assets/brand.css">
</head><body>x</body></html>\`;
}
export const args = ['--headless=new', '--print-to-pdf=out.pdf'];`,
  );
  const found = scan();
  assert.equal(found.length, 1, `Debe encontrar 1 violación, encontró ${found.length}`);
  assert.match(found[0].links[0].text, /stylesheet/i);
  assert.ok(found[0].links[0].line > 0, 'Debe reportar la línea');
});

test('no marca un generador que INLINEA el CSS', () => {
  makeGen(
    tempRoot,
    'good-inline.ts',
    `export function buildHtml() {
  return \`<!doctype html><html><head>
<style>body{color:#000}</style>
</head><body>x</body></html>\`;
}
export const args = ['--headless=new', '--print-to-pdf=out.pdf'];`,
  );
  const onlyThis = detectPrintHtmlViolations([join(tempRoot, 'good-inline')]);
  assert.equal(onlyThis.length, 0, 'Un generador con CSS inlineado no es violación');
});

test('no marca el link que aparece en la PROPIA guarda del generador', () => {
  makeGen(
    tempRoot,
    'self-guard.ts',
    `export const LINK = /<link[^>]+stylesheet/i;
export function sanitize(html: string) {
  if (LINK.test(html)) throw new Error('Queda un <link rel="stylesheet"> sin resolver');
  return html;
}
export const args = ['--headless=new', '--print-to-pdf=out.pdf'];`,
  );
  const onlyThis = detectPrintHtmlViolations([join(tempRoot, 'self-guard')]);
  assert.equal(onlyThis.length, 0, 'Mencionar el patrón para detectarlo NO es emitirlo');
});

test('ignora archivos que no generan PDF', () => {
  makeGen(
    tempRoot,
    'not-a-generator.ts',
    `export const html = \`<html><head><link rel="stylesheet" href="x.css"></head></html>\`;`,
  );
  const onlyThis = detectPrintHtmlViolations([join(tempRoot, 'not-a-generator')]);
  assert.equal(onlyThis.length, 0, 'Sin marcador de impresión no es generador de PDF');
});

test('el reporte nombra el archivo y sugiere un fix accionable', () => {
  const found = scan();
  const report = found
    .map((g) => `${g.file}\n${g.links.map((l) => `  L${l.line}`).join('\n')}`)
    .join('\n');
  assert.match(report, /bad-link/);
  assert.match(report, /L\d+/, 'El reporte debe incluir línea para poder saltar al código');
  // El mensaje de aserción del test del stack debe mencionar el fix.
  const src = readFileSync(join(import.meta.dirname, 'print-html-invariant.test.ts'), 'utf8');
  assert.match(src, /inlinear el CSS en un <style>/i);
});
