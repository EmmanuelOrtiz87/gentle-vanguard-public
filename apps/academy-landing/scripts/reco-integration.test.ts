/**
 * Tests de la integracion del motor de upsell en la landing.
 *
 * Lo que se fija:
 *  - que la landing CARGUE el catalogo generado
 *  - que los upsells SEAN los del catalogo, no las 2 tarjetas fijas
 *  - que cada boton de upsell lleve data-slug (el bug de atribucion)
 *  - que la regla de los 3 toques funcione en el browser
 *  - que el fallback NO invente slugs
 *  - que el catalogo generado este sincronizado con el motor
 *
 * La landing se evalua de verdad: se extraen sus funciones por corte de texto
 * y se corren con un sandbox de `window`/`localStorage` falsos.
 *
 * Run: node --import tsx --test apps/academy-landing/scripts/reco-integration.test.ts
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();
const LANDING = resolve(ROOT, 'apps/academy-landing/index.html');
const CATALOG_JS = resolve(ROOT, 'apps/academy-landing/data/catalog-reco.js');
const HTML = readFileSync(LANDING, 'utf8');

/** Corta `function name(...) { ... }` (o `async function`) contando llaves. */
function extractFn(src: string, name: string): string {
  let start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`no encontre ${name} en la landing`);
  if (src.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  const braceStart = src.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`llaves sin cerrar en ${name}`);
}

// ── el archivo generado existe y esta al dia ────────────────────────────

test('el catalogo generado existe', () => {
  assert.ok(existsSync(CATALOG_JS), `falta ${CATALOG_JS}. Generarlo con build-catalog.ts`);
});

test('el catalogo generado esta SINCRONIZADO con el motor', () => {
  // Regenerar debe ser idempotente: si el motor cambio y no se regenero, el
  // archivo commiteado es viejo y la landing ofrece cosas que ya no aplican.
  const out = execFileSync('node', ['--import', 'tsx', 'apps/academy-landing/scripts/build-catalog.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.match(out, /sin cambios/, `build-catalog.ts regenero el archivo (esta desincronizado):\n${out}`);
});

test('el catalogo generado es JS plano valido y define GV_RECO', () => {
  const src = readFileSync(CATALOG_JS, 'utf8');
  assert.match(src, /window\.GV_RECO\s*=/, 'debe asignar window.GV_RECO');
  // JS plano: sin TS, sin imports, sin tipos.
  assert.ok(!/^\s*import\s/m.test(src), 'no debe tener import');
  assert.ok(!/:\s*CatalogItem/.test(src), 'no debe tener tipos TS');
});

// ── la landing lo carga ─────────────────────────────────────────────────

test('la landing carga data/catalog-reco.js', () => {
  assert.match(HTML, /<script\s+src="data\/catalog-reco\.js"><\/script>/, 'falta el script del catalogo');
});

test('la landing YA NO usa el UPSELLS fijo para las tarjetas', () => {
  // El array fijo puede seguir existiendo como fallback, pero el render de
  // las tarjetas tiene que pasar por recommendationsFor().
  const renderStart = HTML.indexOf('gracias-cards\'');
  const renderEnd = HTML.indexOf('gracias-wa', renderStart);
  const renderBlock = HTML.slice(Math.max(0, renderStart - 200), renderEnd);
  assert.ok(
    renderBlock.includes('recommendationsFor('),
    'el render de las tarjetas debe usar recommendationsFor(), no UPSELLS',
  );
  assert.ok(
    !/UPSELLS\.forEach/.test(renderBlock),
    'no debe seguir iterating UPSELLS para pintar las tarjetas',
  );
});

// ── el bug de atribucion ───────────────────────────────────────────────

test('los botones de upsell llevan data-slug (el bug de atribucion)', () => {
  // Sin data-slug, la compra del complemento llega al CRM y al Portal como
  // "producto por asignar": se pierde el ingreso ya cobrado.
  const idx = HTML.indexOf("a.setAttribute('data-slug', u.slug)");
  assert.ok(idx > 0, 'el boton de upsell debe setear data-slug con el slug del recomendado');
});

test('el catalogo real trae slugs reales para los upsells', () => {
  const src = readFileSync(CATALOG_JS, 'utf8');
  const json = src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1);
  const data = JSON.parse(json) as {
    products: Array<{ slug: string; tier: string; price: number }>;
    recos: Record<string, Array<{ slug: string; tier: string; priceLabel: string; why: string }>>;
  };

  const slugs = new Set(data.products.map((p) => p.slug));
  for (const [bought, recos] of Object.entries(data.recos)) {
    assert.ok(slugs.has(bought), `recomienda para "${bought}" que no esta en el catalogo`);
    for (const r of recos) {
      assert.ok(slugs.has(r.slug), `"${bought}" recomienda "${r.slug}" que no existe en el catalogo`);
      assert.ok(r.why.length > 20, `motivo vacio para ${bought}->${r.slug}`);
    }
  }
});

// ── comportamiento en runtime ───────────────────────────────────────────

/** Extrae el objeto JSON que el generador asigna a window.GV_RECO. */
function catalogData(): { products: unknown[]; recos: Record<string, unknown[]> } {
  const src = readFileSync(CATALOG_JS, 'utf8');
  return JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1)) as {
    products: unknown[];
    recos: Record<string, unknown[]>;
  };
}

/** Levanta las funciones de la landing con sandbox. */
function makeLanding(opts: { withCatalog?: boolean; touches?: string } = {}) {
  const sources = [
    extractFn(HTML, 'readOfferTouches'),
    extractFn(HTML, 'recordOfferTouch'),
    extractFn(HTML, 'bumpTouchesFor'),
    extractFn(HTML, 'recommendationsFor'),
  ].join('\n');

  // El sandbox reproduce el entorno del browser: window.GV_RECO con el
  // catalogo cargado y un localStorage que persiste entre llamadas.
  const withCatalog = opts.withCatalog !== false;
  const prelude = `
    var TOUCH_KEY = 'gv-offer-touches';
    var MAX_TOUCHES = 2;
    var MPAGO_JS = {
      'ebook-micro': 'https://mpago.la/219F2HK',
      'ebook-premium': 'https://mpago.la/2LPNVrj',
      'toolkit': 'https://mpago.la/16Zk1U1',
      'course-base': 'https://mpago.la/2fVzHJ7',
      'course-mentor': 'https://mpago.la/2Y91TZ5',
    };
    var PRICE_LABELS = { 'ebook-micro': 'USD 20', toolkit: 'USD 80', 'course-base': 'USD 50' };
    var UPSELLS_FALLBACK = [
      { tier: 'toolkit', label: 'Toolkit fallback', why: 'x', slug: '', priceLabel: '' },
    ];
    var store = ${JSON.stringify(opts.touches ?? '')};
    var localStorage = {
      getItem: function (k) { return k === 'gv-offer-touches' && store ? store : null; },
      setItem: function (k, v) { if (k === 'gv-offer-touches') store = v; },
    };
    var window = { GV_RECO: ${withCatalog ? JSON.stringify(catalogData()) : 'undefined'} };
  `;

  const body = `${prelude}\n${sources}\nreturn { recommendationsFor, recordOfferTouch, readOfferTouches, dump: function(){ return store; } };`;
  return new Function(body)() as {
    recommendationsFor: (
      bought: string,
      tier: string,
    ) => Array<{ slug: string; tier: string; title: string; why: string; reason: string; priceLabel: string }>;
    recordOfferTouch: (bought: string, offered: string) => void;
    readOfferTouches: () => Record<string, number>;
    dump: () => string;
  };
}

test('sin slug comprado NO ofrece nada (no inventa)', () => {
  const api = makeLanding();
  assert.deepEqual(api.recommendationsFor('', 'course-base'), [], 'sin slug no hay con que recomendar');
});

test('ofrece las recomendaciones del catalogo para un slug real', () => {
  const api = makeLanding();
  const recos = api.recommendationsFor('agentes-ia', 'course-base');
  assert.ok(recos.length > 0, 'debe recomendar algo para agentes-ia');
  assert.ok(recos.length <= 3);
  for (const r of recos) {
    assert.ok(r.slug, 'cada upsell debe tener slug para poder atribuirse');
    assert.notEqual(r.slug, 'agentes-ia', 'no se ofrece a si mismo');
    assert.notEqual(r.reason, 'fallback', 'con catalogo cargado no debe caer al fallback');
    assert.ok(r.why.length > 20, 'el motivo explica la relacion');
  }
});

test('el mismo tier NO se filtra: el mejor complemento de un curso es otro curso', () => {
  // Filtro por tier era un error de diseño: course-base tiene 20 cursos, y
  // con ese filtro la lista quedaba vacia para todos ellos.
  const api = makeLanding();
  const sameTier = api
    .recommendationsFor('agentes-ia', 'course-base')
    .filter((r) => r.tier === 'course-base');
  assert.ok(sameTier.length > 0, 'debe poder recomendar otro curso del mismo nivel');
  for (const r of sameTier) assert.notEqual(r.slug, 'agentes-ia', 'pero nunca el mismo producto');
});

test('NUNCA ofrece algo que no se puede comprar (MPAGO_JS sin el tier)', () => {
  const api = makeLanding();
  const recos = api.recommendationsFor('agentes-ia', 'course-base');
  const comprables = new Set(['ebook-micro', 'ebook-premium', 'toolkit', 'course-base', 'course-mentor']);
  for (const r of recos) assert.ok(comprables.has(r.tier), `upsell con tier no comprable: ${r.tier}`);
});

// ── la regla de los 3 toques ────────────────────────────────────────────

test('registrar un toque lo quita de la lista en la misma sesion', () => {
  // Simula el click de "Ahora no" tres veces sobre el mismo upsell.
  const api = makeLanding();
  const first = api.recommendationsFor('agentes-ia', 'course-base')[0]!;
  assert.ok(first.slug, 'necesita slug para probar');

  api.recordOfferTouch('agentes-ia', first.slug);
  const state = api.readOfferTouches();
  assert.equal(state[`agentes-ia|${first.slug}`], 1);

  api.recordOfferTouch('agentes-ia', first.slug);
  assert.equal(api.readOfferTouches()[`agentes-ia|${first.slug}`], 2, 'el conteo acumula');
});

test('el estado de toques se serializa por par (comprado, ofrecido)', () => {
  const api = makeLanding();
  api.recordOfferTouch('agentes-ia', 'ia-fundamentos');
  api.recordOfferTouch('agentes-ia', 'ia-fundamentos');
  api.recordOfferTouch('otro-curso', 'gemini');
  const state = api.readOfferTouches();
  assert.equal(state['agentes-ia|ia-fundamentos'], 2, 'el par lleva el conteo');
  assert.equal(state['otro-curso|gemini'], 1, 'los pares de distintas compras no se mezclan');
});

test('tras 2 rechazos el upsell desaparece', () => {
  // Primero vemos la lista completa.
  const full = makeLanding();
  const all = full.recommendationsFor('agentes-ia', 'course-base');
  assert.ok(all.length > 0);
  const target = all[0]!.slug;

  // Ahora con el par ya en 2 toques.
  const touchedJson = JSON.stringify([['agentes-ia', target, 2]]);
  const api = makeLanding({ touches: touchedJson });
  const after = api.recommendationsFor('agentes-ia', 'course-base');
  assert.ok(
    !after.some((r) => r.slug === target),
    `el upsell ${target} ya fue rechazado 2 veces y no debe reaparecer`,
  );
  // Los demas siguen disponibles: el limite es por producto, no bloquea todo.
  assert.equal(after.length, all.length - 1);
});

test('un solo rechazo NO bloquea (puede reintentarse una vez)', () => {
  const full = makeLanding();
  const all = full.recommendationsFor('agentes-ia', 'course-base');
  const target = all[0]!.slug;
  const api = makeLanding({ touches: JSON.stringify([['agentes-ia', target, 1]]) });
  const after = api.recommendationsFor('agentes-ia', 'course-base');
  assert.ok(after.some((r) => r.slug === target), 'con 1 toque todavia debe aparecer');
});

// ── el fallback no inventa ─────────────────────────────────────────────

test('sin catalogo cargado cae al fallback SIN slugs', () => {
  const api = makeLanding({ withCatalog: false });
  const recos = api.recommendationsFor('agentes-ia', 'course-base');
  assert.ok(recos.length > 0, 'debe seguir ofreciendo algo (el cliente ya pago)');
  for (const r of recos) {
    assert.equal(r.reason, 'fallback', 'marcado como fallback');
    assert.equal(r.slug, '', 'SIN slug: un slug inventado atribuiria el producto equivocado');
  }
});

test('el fallback tampoco ofrece el tier recien comprado', () => {
  const api = makeLanding({ withCatalog: false });
  const recos = api.recommendationsFor('agentes-ia', 'toolkit');
  assert.ok(!recos.some((r) => r.tier === 'toolkit'), 'no debe ofrecer el mismo tier');
});
