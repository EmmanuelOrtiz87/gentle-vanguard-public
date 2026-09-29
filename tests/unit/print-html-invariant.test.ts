import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { detectPrintHtmlViolations, findPrintGenerators } from '../../src/tools/print-html-invariant.js';

/**
 * INVARIANTE DE ARQUITECTURA: todo HTML que se imprime a PDF en el stack debe
 * llevar su CSS INLINEADO, nunca linkeado.
 *
 * Por qué es una invariante y no una recomendación: un `<link rel="stylesheet">`
 * que no resuelve NO da error. El navegador ignora la hoja y el PDF sale sin
 * estilos — en silencio. Pasó dos veces en docs/educacion y costó dos sesiones
 * de diagnóstico cada vez.
 *
 * La lógica de detección vive en src/tools/print-html-invariant.ts y tiene sus
 * propios negative tests en print-html-invariant-negative.test.ts: este archivo
 * verifica el estado REAL del stack, aquél verifica que el detector funciona.
 */

const ROOT = resolve(import.meta.dirname, '..', '..');
const SCAN_DIRS = ['src', 'apps', 'scripts'];
const MIN_GENERADORES = 3;

test('ningun generador de PDF del stack imprime HTML con <link rel="stylesheet">', () => {
  const roots = SCAN_DIRS.map((d) => join(ROOT, d));
  const offenders = detectPrintHtmlViolations(roots, ROOT);
  const generators = findPrintGenerators(roots, ROOT);

  const report = offenders
    .map((g) => `  ${g.file}\n${g.links.map((l) => `    L${l.line}: ${l.text}`).join('\n')}`)
    .join('\n');

  assert.ok(
    offenders.length === 0,
    `${offenders.length} generador(es) de PDF pueden imprimir HTML con una hoja linkeada ` +
      `(que no resolvería y sairía SIN ESTILOS en silencio):\n${report}\n` +
      `  Fix: inlinear el CSS en un <style> o copiar el asset junto al HTML generado.`,
  );

  // Guard anti-falso-verde: si el escaneo deja de encontrar generadores (un
  // refactor, un renombre), este test pasaría sin comprobar nada.
  assert.ok(
    generators.length >= MIN_GENERADORES,
    `Se esperaban al menos ${MIN_GENERADORES} generadores de PDF en el stack, ` +
      `se detectaron ${generators.length}: el escaneo está vacío.`,
  );
});

test('el renderer de educación valida que el CSS quedó inlineado (falla ruidosamente)', () => {
  const src = readFileSync(join(ROOT, 'src/education/render-study-guide.ts'), 'utf8');
  assert.match(
    src,
    /No se encontró style\.css|el CSS inlineado no quedó en el documento/i,
    'render-study-guide.ts debe fallar si el CSS no se inlineó: es el bug que costó dos sesiones.',
  );
  assert.match(
    src,
    /Queda un <link rel="stylesheet"> sin resolver/i,
    'render-study-guide.ts debe abortar si sobrevive un link a stylesheet sin resolver.',
  );
});

test('el gate de QA imprimible existe y cubre la invariante de CSS', () => {
  const src = readFileSync(join(ROOT, 'src/tools/qa-print-html.ts'), 'utf8');
  for (const check of ['css', 'vacia', 'alto', 'ancho', 'huerfano', 'contraste', 'tipografia']) {
    assert.ok(src.includes(`'${check}'`), `qa-print-html.ts debe cubrir el check "${check}"`);
  }
  assert.match(
    src,
    /ruleCount < 30/,
    'El check de CSS debe fallar si parsean pocas reglas: es la señal del PDF sin estilos.',
  );
});
