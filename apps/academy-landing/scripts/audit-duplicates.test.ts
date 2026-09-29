/**
 * Tests del auditor de duplicados del catálogo.
 *
 * El caso que importa: que un producto "PRO" de un tema no colga del mismo
 * texto que el producto base. Es la regla de negocio: nombre similar obliga a
 * contenido distinto (o a ser un combo declarado).
 *
 * Corre contra fixtures en memoria, no contra el catálogo real — el catálogo
 * real tiene su propio smoke test abajo.
 *
 * Run: node --import tsx --test apps/academy-landing/scripts/audit-duplicates.test.ts
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { auditDuplicates, compare, fingerprint, loadFingerprints, type ProductFingerprint } from './audit-duplicates.ts';

/** Construye una huella directa, sin tocar disco. Shingle por TEXTO, no por indice. */
function fp(slug: string, kind: ProductFingerprint['kind'], tier: string, text: string): ProductFingerprint {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const shingles = new Set<number>();
  for (let i = 0; i + 5 <= words.length; i += 1) {
    // Hash del n-grama real: dos textos distintos no pueden compartir shingle.
    const gram = words.slice(i, i + 5).join(' ');
    let h = 0x811c9dc5;
    for (let k = 0; k < gram.length; k += 1) {
      h ^= gram.charCodeAt(k);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    shingles.add(h >>> 0);
  }
  return { slug, kind, tier, title: slug, files: ['content-1.js'], words: words.length, shingles };
}

const TEXTO_A =
  'aprende machine learning con python desde cero construyendo proyectos reales ' +
  'que puedas mostrar en tu portafolio profesional como ingeniero de datos';
const TEXTO_B =
  'domina sql avanzado optimizando consultas lentas sobre tablas de millones de ' +
  'filas en postgres para reportes empresariales-criticales de produccion';
/** Tercer texto distinto: el fixture necesita 3 productos, no 2 textos. */
const TEXTO_C =
  'construye interfaces accesibles con html y css moderno aplicando contraste ' +
  'adecuado y navegacion por teclado para usuarios con discapacidad visual';

test('productos con textos totalmente distintos: sin alerta', () => {
  const pair = compare(fp('a', 'ebook', 'ebook-micro', TEXTO_A), fp('b', 'ebook', 'ebook-micro', TEXTO_B));
  assert.equal(pair, null);
});

test('productos con texto IDENTICO: alerta con similitud 1.0', () => {
  const pair = compare(fp('base', 'ebook', 'ebook-micro', TEXTO_A), fp('pro', 'ebook', 'ebook-micro', TEXTO_A));
  assert.ok(pair, 'debe alertar');
  assert.equal(pair.jaccard, 1);
  assert.equal(pair.containment, 1);
});

test('texto casi identico (una frase cambiada): alerta', () => {
  const casiIgual = TEXTO_A.replace('machine learning', 'aprendizaje automatico');
  const pair = compare(fp('base', 'ebook', 'ebook-micro', TEXTO_A), fp('pro', 'ebook', 'ebook-micro', casiIgual));
  assert.ok(pair, 'debe alertar aunque sea un cambio chico');
  assert.ok(pair.jaccard > 0.5, `Jaccard ${pair.jaccard} deberia ser alto`);
});

test('uno CONTIENE al otro (version corta vs extendida): alerta por containment', () => {
  const corto = 'aprende machine learning con python desde cero construyendo proyectos';
  const largo = `${corto} reales que puedas mostrar en tu portafolio profesional como ingeniero de datos`;
  const pair = compare(fp('mini', 'ebook', 'ebook-micro', corto), fp('full', 'ebook', 'ebook-micro', largo));
  assert.ok(pair, 'el mini esta contenido en el full: hay que revisar si vale la pena cobrar distinto');
  assert.equal(pair.containment, 1, 'el mas chico esta totalmente contenido');
});

test('mismo contenido y mismo tier: el motivo NO acusa de cobrar distinto', () => {
  const pair = compare(fp('a', 'ebook', 'ebook-micro', TEXTO_A), fp('b', 'ebook', 'ebook-micro', TEXTO_A));
  assert.match(pair.reason, /mismo tier \(ebook-micro\)/);
  assert.doesNotMatch(pair.reason, /DISTINTO/, 'con el mismo tier no hay accuse de cobrar distinto');
});

test('mismo contenido pero TIER DISTINTO: acusa cobrar distinto por el mismo texto', () => {
  const pair = compare(fp('a', 'course', 'course-base', TEXTO_A), fp('b', 'course', 'course-mentor', TEXTO_A));
  assert.match(pair.reason, /tier\/precio DISTINTO \(course-base vs course-mentor\)/);
});

test('mismo contenido entre tipos distintos: acusa el cruce curso/ebook/toolkit', () => {
  const pair = compare(fp('a', 'course', 'course-base', TEXTO_A), fp('b', 'toolkit', 'toolkit', TEXTO_A));
  assert.match(pair.reason, /tipos distintos \(course vs toolkit\)/);
});

test('tipo y tier distintos a la vez: el motivo reporta AMBOS hechos', () => {
  const pair = compare(fp('a', 'course', 'course-base', TEXTO_A), fp('b', 'toolkit', 'toolkit', TEXTO_A));
  assert.match(pair.reason, /tipos distintos/, 'informa el cruce de tipo');
  assert.match(pair.reason, /tier\/precio DISTINTO/, 'informa el cruce de precio');
});

test('version corta contenida en la extendida: el motivo lo dice explicitamente', () => {
  const corto = 'aprende machine learning con python desde cero construyendo proyectos';
  const largo = `${corto} reales que puedas mostrar en tu portafolio profesional como ingeniero de datos`;
  const pair = compare(fp('mini', 'ebook', 'ebook-micro', corto), fp('full', 'ebook', 'ebook-premium', largo));
  assert.match(pair.reason, /casi totalmente contenido/);
  assert.equal(pair.sharedShingles > 0, true, 'sharedShingles mide el bloque comun');
});

test('el umbral es configurable y filtra', () => {
  const casiIgual = TEXTO_A.replace('machine learning', 'aprendizaje automatico');
  const a = fp('base', 'ebook', 'ebook-micro', TEXTO_A);
  const b = fp('pro', 'ebook', 'ebook-micro', casiIgual);
  assert.ok(compare(a, b, 0.2), 'al umbral bajo, alerta');
  assert.equal(compare(a, b, 0.99), null, 'al umbral alto, no');
});

// ── carga desde disco ───────────────────────────────────────────────────

/** Fixture con la forma de apps/academy-web/data. */
function fixture(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'gv-dup-'));
  const data = join(root, 'data');
  const mk = (kind: string, slug: string, manifest: string, content: string) => {
    const dir = join(data, kind, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, kind === 'courses' ? 'course.json' : kind === 'ebooks' ? 'ebook.json' : 'toolkit.json'), manifest, 'utf8');
    writeFileSync(join(dir, 'content-1.js'), `window.GV_CONTENT = ["${content}"];`, 'utf8');
  };
  mk('ebooks', 'ia-base', JSON.stringify({ id: 'ia-base', title: 'IA Base', priceTier: 'ebook-micro' }), TEXTO_A);
  mk('ebooks', 'ia-pro', JSON.stringify({ id: 'ia-pro', title: 'IA Pro', priceTier: 'ebook-premium' }), TEXTO_A);
  mk('ebooks', 'sql', JSON.stringify({ id: 'sql', title: 'SQL', priceTier: 'ebook-premium' }), TEXTO_B);
  mk('courses', 'ml', JSON.stringify({ id: 'ml', title: 'ML', priceTier: 'course-base' }), TEXTO_C);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('carga huellas desde disco: kind, tier, title y contenido', () => {
  const f = fixture();
  try {
    const prints = loadFingerprints(join(f.root, 'data'));
    assert.equal(prints.length, 4);
    const base = prints.find((p) => p.slug === 'ia-base')!;
    assert.equal(base.kind, 'ebook');
    assert.equal(base.tier, 'ebook-micro');
    assert.equal(base.title, 'IA Base');
    assert.ok(base.words > 10, `solo ${base.words} palabras: no esta leyendo el content`);
    assert.ok(base.shingles.size > 0);
  } finally {
    f.cleanup();
  }
});

test('audita sobre disco y encuentra el duplicado real (mismo texto, distinto precio)', () => {
  const f = fixture();
  try {
    const pairs = auditDuplicates(0.8, join(f.root, 'data'));
    assert.equal(pairs.length, 1, `esperaba 1 par, hubo ${pairs.length}`);
    assert.deepEqual([pairs[0]!.a, pairs[0]!.b].sort(), ['ia-base', 'ia-pro']);
    assert.match(pairs[0]!.reason, /DISTINTO/);
  } finally {
    f.cleanup();
  }
});

test('un manifest sin priceTier no rompe la carga', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-dup2-'));
  try {
    const dir = join(root, 'data', 'ebooks', 'raro');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'ebook.json'), JSON.stringify({ id: 'raro', title: 'Raro' }), 'utf8');
    writeFileSync(join(dir, 'content-1.js'), 'window.X = ["algo"];', 'utf8');
    const prints = loadFingerprints(join(root, 'data'));
    assert.equal(prints.length, 1);
    assert.equal(prints[0]!.tier, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('manifest con JSON roto se ignora sin tirar', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-dup3-'));
  try {
    const dir = join(root, 'data', 'ebooks', 'roto');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'ebook.json'), '{ roto', 'utf8');
    assert.deepEqual(loadFingerprints(join(root, 'data')), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('directorio inexistente devuelve lista vacia', () => {
  assert.deepEqual(loadFingerprints(join(tmpdir(), 'no-existe-gv-12345')), []);
  assert.deepEqual(auditDuplicates(0.8, join(tmpdir(), 'no-existe-gv-12345')), []);
});

// ── smoke sobre el catálogo real ─────────────────────────────────────────

test('el catálogo real no tiene contenido duplicado (regla de negocio del owner)', () => {
  const prints = loadFingerprints();
  if (prints.length === 0) return; // no estamos en la raíz del repo

  assert.ok(prints.length >= 50, `solo ${prints.length} productos`);
  // Todos tienen contenido real: si alguno viniera en 0, el audit no miraría nada.
  const vacios = prints.filter((p) => p.words < 300);
  assert.equal(vacios.length, 0, `productos con menos de 300 palabras: ${vacios.map((p) => p.slug).join(', ')}`);

  const pares = auditDuplicates(0.8);
  assert.equal(
    pares.length,
    0,
    `productos con contenido casi idéntico: ${pares.map((x) => `${x.a}~${x.b} (${x.jaccard})`).join(', ')}`,
  );
});
