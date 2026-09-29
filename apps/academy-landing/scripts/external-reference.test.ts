/**
 * Verifica que la landing emita `externalReference` en formato v2 con el slug,
 * y que el parser del Portal lo entienda.
 *
 * POR QUE UN TEST Y NO UN SMOKE MANUAL
 * ------------------------------------
 * La landing es un archivo estatico desplegado en GitHub Pages: si el formato
 * del reference sale mal, el error aparece en produccion, en la venta, y nadie
 * lo ve hasta que un cliente complainte. Este test lo sube a `node --test`.
 *
 * El script de la landing necesita DOM, asi que en vez de cargarlo entero se
 * extraen SOLO las dos funciones que interesan (`normalizeSlugForRef` y
 * `bridgePreference`) por conteo de llaves y se evalúan en un sandbox con
 * `fetch`/`location` falsos. Lo que se evalua es el codigo real del repo: si
 * alguien edita la landing, este test se entera.
 *
 * Run: node --import tsx --test apps/academy-landing/scripts/external-reference.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  indexCatalog,
  normalizeSale,
  parseExternalReference,
  type CatalogProduct,
} from '../../academy-portal/server/purchases.ts';

const LANDING = resolve(process.cwd(), 'apps/academy-landing/index.html');
const HTML = readFileSync(LANDING, 'utf8');

/** Corta `function name(...) { ... }` (o `async function`) contando llaves. */
function extractFn(src: string, name: string): string {
  let start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`no encontre ${name} en la landing`);
  // El `async` va antes del `function`: sin incluirlo, su `await` no compila.
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

interface LandingApi {
  bridgePreference(tier: string, title: string, price: string, slug?: string): Promise<{ preferenceId: string }>;
  normalizeSlugForRef(slug: string): string;
}

/** Evalua las funciones reales de la landing con fetch que captura el body. */
async function makeLanding(): Promise<{ api: LandingApi; lastBody: () => Record<string, unknown> }> {
  const source = `${extractFn(HTML, 'normalizeSlugForRef')}\n${extractFn(HTML, 'bridgePreference')}`;
  let captured: Record<string, unknown> = {};

  const fetchImpl = async (_url: string, init: { body: string }) => {
    captured = JSON.parse(init.body) as Record<string, unknown>;
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, preferenceId: 'pref-test' }),
    };
  };

  const asyncBody = new Function(
    'fetch',
    'location',
    'MP_BRIDGE_URL',
    'parsePriceUSD',
    `return (async () => { ${source}\nreturn { bridgePreference, normalizeSlugForRef }; })();`,
  );

  const api = (await asyncBody(
    fetchImpl,
    { origin: 'https://landing.test' },
    'https://bridge.test',
    (label: string) => Number.parseFloat(String(label).replace(/[^\d.]/g, '')) || 50,
  )) as LandingApi;

  return { api, lastBody: () => captured };
}

const CATALOG = indexCatalog([
  { kind: 'course', slug: 'agentes-ia', title: 'Agentes de IA', tier: 'course-base', path: 'x' },
  { kind: 'course', slug: 'git-github', title: 'Git y GitHub', tier: 'course-base', path: 'x' },
  { kind: 'ebook', slug: 'excel-ia', title: 'Excel + IA', tier: 'ebook-micro', path: 'x' },
] as CatalogProduct[]);

// ── la landing emite v2 ─────────────────────────────────────────────────

test('la landing emite externalReference en formato v2 con el slug', async () => {
  const { api, lastBody } = await makeLanding();
  await api.bridgePreference('course-base', 'Agentes de IA en tu día a día', 'USD 50', 'agentes-ia');
  const ref = String(lastBody().externalReference);
  const parts = ref.split('_');

  assert.equal(parts[0], 'gv', 'prefijo gv');
  assert.equal(parts.length, 5, `se esperaban 5 segmentos en ${ref}`);
  assert.equal(parts[1], 'course-base', 'tier en el segmento 2');
  assert.equal(parts[2], 'agentes-ia', 'slug en el segmento 3');
  assert.match(parts[3]!, /^\d{13}$/, 'epochMs con 13 digitos');
  assert.ok(parts[4]!.length >= 1, 'sufijo aleatorio');
});

test('sin slug NO rompe: emite sinslug (queda trazable, se marca para revision)', async () => {
  const { api, lastBody } = await makeLanding();
  await api.bridgePreference('course-base', 'Producto sin data-slug', 'USD 50', undefined);
  const ref = String(lastBody().externalReference);
  const parts = ref.split('_');
  assert.equal(parts.length, 5);
  assert.equal(parts[2], 'sinslug', 'sin slug explícito, no inventado');
  assert.equal(parts[1], 'course-base', 'el tier sigue viajando');
});

test('slug vacío (data-slug="") equivale a sin slug', async () => {
  const { api, lastBody } = await makeLanding();
  await api.bridgePreference('ebook-micro', 'Excel + IA', 'USD 20', '');
  assert.equal(String(lastBody().externalReference).split('_')[2], 'sinslug');
});

test('normalizeSlugForRef sanea: nunca emite "_" (romperia el split)', async () => {
  const { api } = await makeLanding();
  for (const dirty of ['sl_ug Con ESPACIOS', 'Con-Underscore_Real', '  espacios  ', 'MAYUSCULAS', 'acentúa-do']) {
    const clean = api.normalizeSlugForRef(dirty);
    assert.ok(!clean.includes('_'), `"${dirty}" -> "${clean}" todavia tiene _`);
    assert.ok(!/[A-Z]/.test(clean), `"${clean}" quedo con mayusculas`);
  }
});

test('tier ausente no rompe la referencia', async () => {
  const { api, lastBody } = await makeLanding();
  await api.bridgePreference('', 'X', 'USD 50', 'algo');
  const parts = String(lastBody().externalReference).split('_');
  assert.equal(parts.length, 5);
  assert.equal(parts[1], 'x', 'fallback a "x" como antes');
});

// ── contrato con el Portal ───────────────────────────────────────────────

test('el parser del Portal entiende lo que emite la landing (v2 exacto)', async () => {
  const { api, lastBody } = await makeLanding();
  await api.bridgePreference('course-base', 'Agentes de IA', 'USD 50', 'agentes-ia');
  const parsed = parseExternalReference(String(lastBody().externalReference));

  assert.equal(parsed.ok, true);
  assert.equal(parsed.attribution, 'exact');
  assert.equal(parsed.tier, 'course-base');
  assert.equal(parsed.slug, 'agentes-ia', 'el Portal recupera el slug exacto');
});

test('y con eso la venta queda atribuida al producto, sin revision manual', async () => {
  const { api, lastBody } = await makeLanding();
  await api.bridgePreference('course-base', 'Agentes de IA', 'USD 50', 'agentes-ia');
  const sale = normalizeSale(
    { paymentId: '1', externalReference: String(lastBody().externalReference), payerEmail: 'a@b.com', status: 'approved' },
    CATALOG,
  );
  assert.equal(sale.slug, 'agentes-ia');
  assert.equal(sale.productTitle, 'Agentes de IA');
  assert.equal(sale.needsReview, false, 'no cae en "producto por asignar"');
});

test('el parser SIGUE entendiendo el formato legacy (ventas ya hechas)', async () => {
  // Compatibilidad: el pago real de 2026-09-13 es legacy y no se puede
  // reetiquetar. Si esto rompe, esas ventas dejan de importar.
  const legacy = 'gv-course-base-1756400000000-a3f9';
  const parsed = parseExternalReference(legacy);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.tier, 'course-base');
  assert.equal(parsed.attribution, 'tier-only');
});

test('SANS_SLUG viaja pero queda para revision (no se inventa producto)', async () => {
  const { api, lastBody } = await makeLanding();
  await api.bridgePreference('course-base', 'X', 'USD 50', undefined);
  const sale = normalizeSale(
    { paymentId: '2', externalReference: String(lastBody().externalReference), payerEmail: 'a@b.com', status: 'approved' },
    CATALOG,
  );
  assert.equal(sale.slug, null, 'no se atribuye nada');
  assert.equal(sale.needsReview, true, 'queda visible para que el owner lo asigne');
});

test('referencias v2 y legacy conviven en la misma cola', async () => {
  // El fan-out de la cola no distingue formatos: llegan mezcladas.
  const { api, lastBody } = await makeLanding();
  await api.bridgePreference('course-base', 'Git y GitHub', 'USD 50', 'git-github');
  const refs = [String(lastBody().externalReference), 'gv-course-base-1756400000000-zz9'];
  const parsed = refs.map((r) => parseExternalReference(r));
  assert.equal(parsed[0]!.attribution, 'exact');
  assert.equal(parsed[1]!.attribution, 'tier-only');
  assert.equal(parsed[0]!.ok && parsed[1]!.ok, true, 'ambos se parsean');
});

test('el body enviado al bridge conserva tier, title y precio', async () => {
  const { api, lastBody } = await makeLanding();
  await api.bridgePreference('ebook-micro', 'Excel + IA', 'USD 20', 'excel-ia');
  const body = lastBody() as Record<string, unknown>;
  assert.equal(body.tier, 'ebook-micro');
  assert.equal(body.title, 'Excel + IA');
  assert.equal(body.unitPrice, 20);
  assert.equal(typeof body.externalReference, 'string');
});
