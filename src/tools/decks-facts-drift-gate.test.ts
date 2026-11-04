/**
 * decks-facts-drift-gate.test.ts — El gate de cifras tiene que morder.
 *
 * Un gate que no falla cuando hay una cifra vieja es peor que no tener gate:
 * entrena al equipo a ignorarlo. Por eso estos tests tienen una parte positiva
 * (los decks reales estan al dia) y una parte negativa (un deck con un numero
 * viejo produce un error).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkDeckFacts,
  collectDeckFiles,
  expectedValues,
  measureFacts,
  parseNumber,
  type DeckFacts,
} from './decks-facts-drift-gate.js';

const ROOT = process.cwd();

/** Hechos sinteticos: el test no depende del estado real del repo. */
const FACTS: DeckFacts = {
  qualityGates: { total: 36, enforced: 33, preCommit: 19 },
  skills: { indexed: 253, critical: 28 },
  nexus: { tables: 38, migrations: 22 },
  agents: { definitions: 20, openCode: 10, roles: 29, bindings: 30 },
  scale: { tsFiles: 806, testFiles: 555, npmScripts: 611, apps: 28 },
  watchtower: { components: 35 },
  academy: {
    products: 89,
    courses: 30,
    hours: 429,
    ebooks: 33,
    pages: 2634,
    premium: 18,
    toolkits: 26,
  },
  ci: { workflows: 21 },
};

test('parseNumber normaliza separadores de miles', () => {
  assert.equal(parseNumber('2.634'), 2634);
  assert.equal(parseNumber('2,634'), 2634);
  assert.equal(parseNumber('35'), 35);
  assert.ok(Number.isNaN(parseNumber('Free')));
});

test('ignora comentarios HTML que no forman parte del contenido publicado', () => {
  const report = checkDeckFacts(
    [{ path: 'index.html', text: '<!-- L2 AGENTS --><span>20 agents</span>' }],
    FACTS,
  );
  assert.equal(report.ok, true);
  assert.equal(report.claims, 1);
});

test('un numero viejo produce un error facts/drift', () => {
  const report = checkDeckFacts(
    [{ path: 'deck.js', text: "body: '30 quality gates, escaneo de secretos.'" }],
    FACTS,
  );
  assert.equal(report.ok, false);
  assert.equal(report.errors, 1);
  assert.equal(report.findings[0]?.rule, 'facts/drift');
  assert.match(report.findings[0]?.message ?? '', /30 quality gates/);
});

test('la cifra correcta no produce ningun error', () => {
  const report = checkDeckFacts(
    [{ path: 'deck.js', text: "body: '36 quality gates, escaneo de secretos.'" }],
    FACTS,
  );
  assert.equal(report.ok, true);
  assert.equal(report.errors, 0);
});

test('un tile con el valor viejo se detecta', () => {
  const report = checkDeckFacts(
    [{ path: 'deck.js', text: "{ value: '30', label: 'Quality gates', sub: 'x' }" }],
    FACTS,
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]?.rule, 'facts/drift');
  assert.match(report.findings[0]?.message ?? '', /Quality gates/);
});

test('un tile con el valor correcto pasa', () => {
  const report = checkDeckFacts(
    [{ path: 'deck.js', text: "{ value: '36', label: 'Quality gates', sub: 'x' }" }],
    FACTS,
  );
  assert.equal(report.ok, true);
});

test('el total de checks del watchtower es una afirmacion prohibida', () => {
  const report = checkDeckFacts(
    [{ path: 'deck.js', text: "body: 'Watchtower con 154 checks sobre 29 componentes.'" }],
    FACTS,
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]?.rule, 'facts/volatile-claim');
});

test('el total de verificaciones de salud tambien es una afirmacion prohibida', () => {
  const report = checkDeckFacts(
    [{ path: 'social-post.html', text: '82 verificaciones de salud ejecutadas continuamente' }],
    FACTS,
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]?.rule, 'facts/volatile-claim');
});

test('los skills criticas no se confunden con el total de skills', () => {
  const report = checkDeckFacts(
    [{ path: 'deck.js', text: "body: 'Solo 28 skills criticas se propagan.'" }],
    FACTS,
  );
  assert.equal(report.ok, true, report.findings.map((f) => f.message).join(' | '));
});

test('no confunde skills de una disciplina con el total del indice', () => {
  const report = checkDeckFacts(
    [{ path: 'study-material.html', text: '25 skills de ciberseguridad' }],
    FACTS,
  );
  assert.equal(report.ok, true);
  assert.equal(report.claims, 0);
});

test('solo compara cifras de horas cuando describen video de Academy', () => {
  const report = checkDeckFacts(
    [
      { path: 'contract.html', text: '8 horas de capacitacion y 48 hours to build an MVP' },
      { path: 'deck.js', text: '429 horas de contenido en video y 429 hours of video content' },
    ],
    FACTS,
  );
  assert.equal(report.ok, true);
  assert.equal(report.claims, 2);
});

test('solo valida paginas cuando estan asociadas al catalogo de ebooks', () => {
  const report = checkDeckFacts(
    [
      { path: 'README.md', text: 'El registro mantiene 26 páginas y 19 páginas cuantificadas.' },
      { path: 'deck.js', text: '33 ebooks, 2.634 páginas' },
    ],
    FACTS,
  );
  assert.equal(report.ok, true, report.findings.map((f) => f.message).join(' | '));
  assert.equal(report.claims, 2);
});

test('no confunde PS1 scripts con el total de npm scripts', () => {
  const report = checkDeckFacts(
    [
      { path: 'health.html', text: 'No PS1 scripts. All TypeScript via npx tsx.' },
      { path: 'site.js', text: '611 scripts npm catalogados' },
    ],
    FACTS,
  );
  assert.equal(report.ok, true);
  assert.equal(report.claims, 1);
});

test('las afirmaciones en prosa tambien se verifican', () => {
  const report = checkDeckFacts(
    [{ path: 'deck.js', text: "body: '43 tablas de Nexus y 21 migraciones.'" }],
    FACTS,
  );
  assert.equal(report.ok, false);
  assert.equal(report.errors, 2);
});

test('distingue agentes definidos del subconjunto instalado para OpenCode', () => {
  const report = checkDeckFacts(
    [{ path: 'deck.js', text: '20 agents in the roster; 10 agentes OpenCode disponibles.' }],
    FACTS,
  );
  assert.equal(report.ok, true, report.findings.map((f) => f.message).join(' | '));
  assert.equal(report.claims, 2);
});

test('un piso que exagera el repo falla', () => {
  const report = checkDeckFacts(
    [{ path: 'deck.js', text: "body: '9999 archivos TypeScript en src/.'" }],
    FACTS,
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]?.rule, 'facts/drift');
});

test('un piso holgado dentro de la tolerancia no falla', () => {
  const report = checkDeckFacts(
    [{ path: 'deck.js', text: "body: '790 archivos TypeScript en src/.'" }],
    FACTS,
  );
  assert.equal(report.ok, true, report.findings.map((f) => f.message).join(' | '));
});

test('el gate detecta drift en el HTML y la localizacion del sitio publico', () => {
  const report = checkDeckFacts(
    [
      { path: 'docs/presentations/index.html', text: '254 skills indexadas' },
      { path: 'docs/presentations/assets/js/i18n-content.js', text: '23 tables, 16 migrations' },
    ],
    FACTS,
  );
  assert.equal(report.ok, false);
  assert.equal(report.errors, 3);
  assert.deepEqual(
    report.findings.map((finding) => finding.file),
    [
      'docs/presentations/index.html',
      'docs/presentations/assets/js/i18n-content.js',
      'docs/presentations/assets/js/i18n-content.js',
    ],
  );
});

test('el gate valida cifras en los indicadores HTML traducibles', () => {
  const report = checkDeckFacts(
    [
      {
        path: 'docs/presentations/index.html',
        text: '<div class="stat-n">256</div><div class="stat-l" data-i18n="presence_skills">Skills</div>',
      },
    ],
    FACTS,
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]?.rule, 'facts/drift');
  assert.equal(report.errors, 1);
});

test('el inventario incluye paginas HTML, i18n y fuente del deck manual', () => {
  const files = collectDeckFiles(ROOT);
  const paths = new Set(files.map((file) => file.path));
  assert.ok(paths.has('docs/presentations/index.html'));
  assert.ok(paths.has('docs/presentations/decks/speech/README.md'));
  assert.ok(paths.has('docs/presentations/assets/js/i18n.js'));
  assert.ok(paths.has('docs/presentations/assets/js/i18n-content.js'));
  assert.ok(paths.has('docs/presentations/assets/js/i18n-extra.js'));
  assert.ok(paths.has('docs/presentations/STACK-FACTS-BRIEF.md'));
  assert.ok(paths.has('docs/presentations/IMAGE-STUDIO-README.md'));
  assert.ok(paths.has('docs/presentations/decks/build/manual.js'));
});

test('expectedValues expone los valores medidos', () => {
  const values = expectedValues(FACTS);
  assert.deepEqual(values['quality-gates'], [36]);
  assert.deepEqual(values['quality-gates-enforced'], [33, 36]);
  assert.deepEqual(values['open-code-agents'], [10]);
  assert.deepEqual(values['academy-products'], [89]);
});

test('los decks, guiones y copy publico reales estan al dia', () => {
  const { facts, source } = measureFacts(ROOT);
  assert.ok(facts.qualityGates.total > 0);
  assert.ok(facts.skills.indexed > 0);
  assert.ok(facts.academy.products > 0);
  const files = collectDeckFiles(ROOT);
  assert.ok(files.length >= 30, `se esperaban decks, guiones y copy publico, hay ${files.length}`);
  const report = checkDeckFacts(files, facts);
  const detail = report.findings.map((f) => `${f.file}: ${f.message}`).join('\n');
  assert.equal(report.ok, true, `drift en las cifras de los decks:\n${detail}`);
  assert.ok(report.claims > 50, `se esperaban muchas afirmaciones, hay ${report.claims}`);
  assert.ok(['git', 'filesystem'].includes(source));
});
