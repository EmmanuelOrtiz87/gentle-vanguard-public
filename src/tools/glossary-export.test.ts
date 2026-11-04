/**
 * TEST del exportador de glosario.
 *
 * El bug real que cubre (2026-11-03): el HTML del glosario parte los tags en
 * varias lineas (`</span\n              >`). Un parser ingenuo dejaba el markup
 * pegado al texto: el termino salia como
 * "Command Center</span ><span class="gloss-cat" ...>app" en el Markdown.
 *
 * Corre con:  node --import tsx --test src/tools/glossary-export.test.ts
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { exportGlossary, parseGlossary, renderMarkdown, stripTags } from './glossary-export.js';

const temps: string[] = [];

after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** HTML minimo con el caso real: el cierre de span partido en dos lineas. */
const HTML = `
<div class="row g-3">
  <div class="gloss-card" id="term-command-center">
    <div class="gloss-head">
      <span class="gloss-term mono">Command Center</span
      ><span class="gloss-cat" style="color: #22d3ee">app</span>
    </div>
    <p class="gloss-def">
      Panel standalone para gestionar el ciclo de vida on-demand
      de las apps construidas, en el puerto 8090.
    </p>
    <div class="gloss-where mono">📍 apps/command-center</div>
  </div>
  <div class="gloss-card" id="term-acid">
    <div class="gloss-head">
      <span class="gloss-term mono">ACID</span>
      <span class="gloss-cat" style="color: #94a3b8">concepto</span>
    </div>
    <p class="gloss-def">
      Atomicidad, Consistencia, Aislamiento y Durabilidad.
    </p>
    <div class="gloss-where mono">📍 apps/web-dashboard/server/database/</div>
  </div>
</div>
`;

describe('glossary-export', () => {
  it('parsea las cards del glosario', () => {
    const entries = parseGlossary(HTML);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].term, 'Command Center');
    assert.equal(entries[0].category, 'app');
    assert.match(entries[0].definition, /Panel standalone/);
    assert.match(entries[0].where, /apps\/command-center/);
  });

  it('NO deja markup pegado al termino (el bug del </span partido)', () => {
    const entries = parseGlossary(HTML);
    const term = entries[0].term;
    assert.ok(!term.includes('<'), `el termino trae markup: ${term}`);
    assert.ok(!term.includes('gloss-cat'), `el termino trae markup: ${term}`);
    assert.equal(term, 'Command Center');
  });

  it('stripTags limpia etiquetas y entities', () => {
    assert.equal(stripTags('a &amp; b'), 'a & b');
    assert.equal(stripTags('<span>x</span> y'), 'x y');
  });

  it('renderiza Markdown agrupado por categoria', () => {
    const md = renderMarkdown(parseGlossary(HTML));
    assert.match(md, /## Conceptos/);
    assert.match(md, /## App/);
    assert.match(md, /\| \*\*ACID\*\* \|/);
    assert.match(md, /apps\/command-center/);
  });

  it('detecta el drift entre el HTML y el Markdown generado', () => {
    const root = mkdtempSync(join(tmpdir(), 'glossary-export-'));
    temps.push(root);
    const docsDir = join(root, 'docs', 'presentations');
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, 'glossary.html'), HTML, 'utf8');

    // Sin el MD generado, hay drift.
    const before = exportGlossary(root, true);
    assert.equal(before.drift, true);

    // Generado y sincronizado -> sin drift.
    exportGlossary(root, false);
    const after = exportGlossary(root, true);
    assert.equal(after.drift, false);
    assert.equal(after.ok, true);
    assert.equal(after.count, 2);

    // Si el HTML cambia y el MD no, vuelve a haber drift.
    writeFileSync(join(docsDir, 'glossary.html'), HTML.replace('ACID', 'ACID2'), 'utf8');
    const stale = exportGlossary(root, true);
    assert.equal(stale.drift, true);
  });

  it('el Markdown generado se puede releer como Markdown', () => {
    const root = mkdtempSync(join(tmpdir(), 'glossary-export-'));
    temps.push(root);
    const docsDir = join(root, 'docs', 'presentations');
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, 'glossary.html'), HTML, 'utf8');
    exportGlossary(root, false);
    const md = readFileSync(join(docsDir, 'NOMENCLATURA.md'), 'utf8');
    assert.match(md, /^# Nomenclatura/m);
    assert.ok(md.includes('| Término | Definición | En el repo |'));
  });
});
