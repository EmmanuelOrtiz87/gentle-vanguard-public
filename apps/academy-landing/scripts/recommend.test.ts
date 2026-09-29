/**
 * Tests del motor de recomendación.
 *
 * Lo que se fija:
 *  - que NUNCA ofrezca el producto comprado
 *  - que NUNCA ofrezca algo con precio absurdo (ni regalado ni de 10x)
 *  - que el motivo sea trazable y específico, no genérico
 *  - que la regla de los 3 toques funcione (rechazar dos veces = no insistir)
 *  - que el catálogo real produzca ofertas con VERDAD, no relleno
 *
 * Run: node --import tsx --test apps/academy-landing/scripts/recommend.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyTouchLimit,
  buildRecommendations,
  loadCatalog,
  priceMakesSense,
  readOfferTouches,
  recordOfferTouch,
  type CatalogItem,
  type Tier,
} from './recommend.ts';

function item(slug: string, kind: CatalogItem['kind'], tier: Tier, price: number, extra: Partial<CatalogItem> = {}): CatalogItem {
  return { slug, kind, tier, title: extra.title ?? slug, categories: [], tags: [], price, ...extra };
}

/** Catálogo de prueba que refleja la forma real (mismos slugs clave). */
const CATALOG: CatalogItem[] = [
  item('agentes-ia', 'course', 'course-base', 50, { tags: ['agentes', 'ia', 'chatgpt'], categories: ['ia-aplicada'] }),
  item('ia-fundamentos', 'course', 'course-base', 50, { tags: ['ia', 'principiantes'], categories: ['ia-aplicada'] }),
  item('gemini', 'course', 'course-base', 50, { tags: ['gemini', 'ia'], categories: ['ia-aplicada'] }),
  item('checklist-semana-1', 'ebook', 'ebook-micro', 20, { tags: ['ia', 'checklist'], categories: ['ia-aplicada'] }),
  item('toolkit-agentes-ia', 'toolkit', 'toolkit', 80, { tags: ['agentes', 'ia'], categories: ['ia-aplicada'] }),
  item('python-inicial', 'course', 'course-base', 50, { tags: ['python'], categories: ['programacion'] }),
  // El catálogo real tiene 3 niveles de Python: inicial → intermedio → avanzado.
  // NEXT_LEVEL declara el paso real (intermedio), no el "más avanzado que exista".
  item('python-intermedio', 'course', 'course-base', 50, { tags: ['python', 'intermedio'], categories: ['programacion'] }),
  item('python-avanzado', 'course', 'course-base', 50, { tags: ['python', 'avanzado'], categories: ['programacion'] }),
  item('git-github', 'course', 'course-base', 50, { tags: ['git', 'github'], categories: ['devops'] }),
  item('linux-intro', 'course', 'course-base', 50, { tags: ['linux', 'terminal'], categories: ['sistemas'] }),
  // Caro: nunca debe ofrecerse a alguien que compró algo barato.
  item('programa-empresas', 'course', 'program-custom', 250, { tags: ['empresas'], categories: ['corporativo'] }),
];

// ── filtros duros ───────────────────────────────────────────────────────

test('NUNCA ofrece el producto ya comprado', () => {
  const bought = CATALOG.find((c) => c.slug === 'agentes-ia')!;
  const recs = buildRecommendations(bought, CATALOG, 5);
  assert.ok(recs.length > 0, 'debe recomendar algo');
  assert.ok(!recs.some((r) => r.slug === 'agentes-ia'), 'no se ofrece a si mismo');
});

test('NUNCA ofrece algo fuera del rango de precio', () => {
  // Compró algo de 20 USD: un programa de 250 USD es 12,5x, no es complemento.
  const bought = item('barato', 'ebook', 'ebook-micro', 20, { tags: ['ia'] });
  const recs = buildRecommendations(bought, CATALOG, 6);
  assert.ok(!recs.some((r) => r.price > 20 * 2.5), `ofreció ${recs.map((r) => `${r.slug}:${r.price}`).join(', ')}`);
});

test('priceMakesSense: rechaza regalado y carisimo', () => {
  assert.equal(priceMakesSense(50, 50), true, 'mismo precio');
  assert.equal(priceMakesSense(50, 80), true, 'toolkit que lo contiene');
  assert.equal(priceMakesSense(50, 250), false, '5x es demasiado');
  assert.equal(priceMakesSense(50, 10), false, 'demasiado barato: no es upsell');
  assert.equal(priceMakesSense(0, 50), false, 'precio desconocido');
  assert.equal(priceMakesSense(50, 0), false, 'precio desconocido');
});

test('no duplica slugs en la lista de recomendaciones', () => {
  for (const bought of CATALOG) {
    const slugs = buildRecommendations(bought, CATALOG, 6).map((r) => r.slug);
    assert.equal(new Set(slugs).size, slugs.length, `duplicados en ${bought.slug}: ${slugs.join(',')}`);
  }
});

test('respeta el limite pedido', () => {
  const bought = CATALOG[0]!;
  for (const n of [1, 2, 3, 5]) {
    assert.ok(buildRecommendations(bought, CATALOG, n).length <= n);
  }
});

// ── el motivo es especifico y trazable ──────────────────────────────────

test('el complemento DECLARADO gana sobre el mismo-tema generico', () => {
  const bought = CATALOG.find((c) => c.slug === 'agentes-ia')!;
  const recs = buildRecommendations(bought, CATALOG, 3);
  const first = recs[0]!;
  assert.equal(first.reason, 'complement', `esperaba complemento, dio ${first.reason}: ${first.slug}`);
  assert.match(first.why, /fundamentos|consolida/i, 'el motivo explica la relación concreta');
});

test('el motivo nombra el tema COMPARTIDO (trazable, no genérico)', () => {
  const bought = item('raro', 'ebook', 'ebook-micro', 20, { tags: ['marketing', 'ia'], categories: ['negocios'] });
  const catalog = [
    bought,
    item('otro-marketing', 'ebook', 'ebook-micro', 20, { tags: ['marketing', 'ventas'], categories: ['negocios'] }),
    item('sin-relacion', 'ebook', 'ebook-micro', 20, { tags: ['cocina'], categories: ['hogar'] }),
  ];
  const recs = buildRecommendations(bought, catalog, 3);
  assert.equal(recs.length, 1, 'solo el que comparte marketing');
  assert.equal(recs[0]!.reason, 'same-topic');
  assert.match(recs[0]!.why, /marketing/, 'el motivo nombra el tag compartido');
  assert.ok(!recs.some((r) => r.slug === 'sin-relacion'), 'no ofrece algo sin relación');
});

test('nada de lo que no comparte tema ni esta declarado se ofrece', () => {
  const bought = item('aislado', 'ebook', 'ebook-micro', 20, { tags: ['cocina'], categories: ['hogar'] });
  const catalog = [
    bought,
    item('sql-futuro', 'ebook', 'ebook-micro', 20, { tags: ['sql', 'db'], categories: ['datos'] }),
    item('otro-cocina', 'ebook', 'ebook-micro', 20, { tags: ['recetas'], categories: ['hogar'] }),
  ];
  const recs = buildRecommendations(bought, catalog, 3);
  // Comparte la CATEGORIA (hogar) pero no los tags: la categoria sola alcanza
  // para una sugerencia tenue, pero no debe inventar relaciones de tema.
  assert.ok(!recs.some((r) => r.slug === 'sql-futuro'), 'nada que ver con bases de datos');
});

test('el siguiente nivel declarado se ofrece con su progresion', () => {
  const bought = CATALOG.find((c) => c.slug === 'python-inicial')!;
  const recs = buildRecommendations(bought, CATALOG, 5);
  // El paso declarado es el INTERMEDIO, no el avanzado.
  const next = recs.find((r) => r.slug === 'python-intermedio');
  assert.ok(next, 'debe ofrecer el nivel siguiente');
  assert.equal(next!.reason, 'next-level');
  assert.match(next!.why, /siguiente/i);
  // El avanzado puede aparecer, pero NO como "siguiente nivel": es un
  // candidato legitimo por compartir el tag `python` (razon same-topic). Lo
  // que no puede es presentarse como la progresion inmediata.
  const advanced = recs.find((r) => r.slug === 'python-avanzado');
  if (advanced) assert.equal(advanced.reason, 'same-topic', 'no debe saltarse un nivel en la progresion');
});

test('el paso intermedio declara el avanzado como siguiente', () => {
  const bought = CATALOG.find((c) => c.slug === 'python-intermedio')!;
  const recs = buildRecommendations(bought, CATALOG, 5);
  const next = recs.find((r) => r.slug === 'python-avanzado');
  assert.ok(next, 'desde intermedio se ofrece avanzado');
  assert.equal(next!.reason, 'next-level');
});

test('el bundle que ya contiene lo comprado se ofrece como upgrade de nivel', () => {
  const bought = CATALOG.find((c) => c.slug === 'agentes-ia')!;
  const recs = buildRecommendations(bought, CATALOG, 5);
  const bundle = recs.find((r) => r.slug === 'toolkit-agentes-ia');
  assert.ok(bundle, 'el toolkit que trae el curso debe aparecer');
  assert.equal(bundle!.reason, 'bundle');
});

test('el orden es determinista (mismo input, mismo output)', () => {
  const bought = CATALOG.find((c) => c.slug === 'agentes-ia')!;
  const a = buildRecommendations(bought, CATALOG, 3).map((r) => r.slug);
  const b = buildRecommendations(bought, CATALOG, 3).map((r) => r.slug);
  assert.deepEqual(a, b);
});

// ── regla de los 3 toques ───────────────────────────────────────────────

test('rechazar dos veces = no volver a ofrecer (regla de los 3 toques)', () => {
  const bought = CATALOG[0]!;
  const candidates = buildRecommendations(bought, CATALOG, 3);
  assert.ok(candidates.length >= 1);

  // 1er toque: se ofrece.
  const t1 = applyTouchLimit(candidates, new Map(), 2);
  assert.equal(t1.visible.length, candidates.length);

  // Ya le Offerció las 2 veces (rechazó ambas): se agota.
  const dosVeces = new Map(candidates.map((c) => [c.slug, 2]));
  const t3 = applyTouchLimit(candidates, dosVeces, 2);
  assert.equal(t3.visible.length, 0, 'no insiste');
  assert.equal(t3.exhausted.length, candidates.length);
});

test('un Set cuenta 1 toque por elemento (compatibilidad)', () => {
  const bought = CATALOG[0]!;
  const candidates = buildRecommendations(bought, CATALOG, 3);
  // Un Set no puede expresar "2 veces": cada elemento cuenta 1.
  const t = applyTouchLimit(candidates, new Set(candidates.map((c) => c.slug)), 2);
  assert.equal(t.visible.length, candidates.length, 'con 1 toque previo todavia se ofrece');
  assert.equal(t.exhausted.length, 0);
});

test('un rechazo previo NO bloquea la siguiente vez', () => {
  const bought = CATALOG[0]!;
  const candidates = buildRecommendations(bought, CATALOG, 3);
  const once = new Map([[candidates[0]!.slug, 1]]);
  const t2 = applyTouchLimit(candidates, once, 2);
  assert.ok(t2.visible.some((v) => v.slug === candidates[0]!.slug), 'puede reintentarse una vez mas');
});

// ── persistencia de toques ──────────────────────────────────────────────

test('readOfferTouches tolera null, vacio y JSON roto', () => {
  assert.equal(readOfferTouches(null).size, 0);
  const fake = fakeStorage();
  assert.equal(readOfferTouches(fake).size, 0);
  fake.setItem('gv-offer-touches', '{ roto');
  assert.equal(readOfferTouches(fake).size, 0, 'JSON roto no debe romper la landing');
});

test('recordOfferTouch acumula el conteo entre llamadas', () => {
  const fake = fakeStorage();
  recordOfferTouch(fake, 'python-avanzado');
  recordOfferTouch(fake, 'python-avanzado');
  recordOfferTouch(fake, 'ia-fundamentos');
  const counts = readOfferTouches(fake);
  assert.equal(counts.get('python-avanzado'), 2);
  assert.equal(counts.get('ia-fundamentos'), 1);
});

test('readOfferTouches migra el formato Set legado (sin romper)', () => {
  const fake = fakeStorage();
  fake.setItem('gv-offer-touches', JSON.stringify(['viejo-a', 'viejo-b']));
  const counts = readOfferTouches(fake);
  assert.equal(counts.get('viejo-a'), 1, 'un slug suelto cuenta 1 toque');
  assert.equal(counts.size, 2);
});

test('un storage que tira no rompe la landing', () => {
  const roto = {
    getItem() { throw new Error('boom'); },
    setItem() { throw new Error('boom'); },
  } as unknown as Storage;
  assert.doesNotThrow(() => recordOfferTouch(roto, 'x'));
  assert.doesNotThrow(() => readOfferTouches(roto));
});

/** Storage en memoria con la misma superficie que localStorage. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

test('applyTouchLimit es puro: no muta la entrada', () => {
  const bought = CATALOG[0]!;
  const candidates = buildRecommendations(bought, CATALOG, 3);
  const before = JSON.stringify(candidates);
  applyTouchLimit(candidates, new Set(), 2);
  assert.equal(JSON.stringify(candidates), before, 'no debe mutar');
});

// ── el catálogo real ────────────────────────────────────────────────────

test('el catalogo REAL carga y produce ofertas con contenido real', () => {
  const catalog = loadCatalog();
  if (catalog.length === 0) return; // no estamos en la raiz del repo
  assert.ok(catalog.length >= 50, `solo ${catalog.length} productos`);
  assert.ok(catalog.every((c) => c.price > 0), 'todo producto debe tener precio');

  for (const bought of catalog) {
    const recs = buildRecommendations(bought, catalog, 3);
    for (const r of recs) {
      assert.ok(r.why.length > 20, `motivo demasiado corto para ${bought.slug}->${r.slug}: "${r.why}"`);
      assert.ok(r.why.trim().length > 0, 'motivo vacio');
      assert.ok(r.price > 0, 'precio invalido');
      assert.notEqual(r.slug, bought.slug, 'se ofrecio a si mismo');
    }
  }
});

test('en el catalogo real, ningun producto se ofrece a si mismo ni duplica', () => {
  const catalog = loadCatalog();
  if (catalog.length === 0) return;
  for (const bought of catalog) {
    const slugs = buildRecommendations(bought, catalog, 3).map((r) => r.slug);
    assert.ok(!slugs.includes(bought.slug), `${bought.slug} se ofrecio a si mismo`);
    assert.equal(new Set(slugs).size, slugs.length, `${bought.slug} produjo duplicados`);
  }
});
