#!/usr/bin/env node
/**
 * Genera `apps/academy-landing/data/catalog-reco.js` para el browser.
 *
 * POR QUE HACE FALTA
 * ------------------
 * `recommend.ts` es TypeScript puro con tipos que el browser no puede cargar
 * (types, interfaces, imports .ts). La landing ademas es un HTML estatico
 * desplegado en GitHub Pages: no hay paso de build ni bundler.
 *
 * Este script es el puente: corre en Node, usa el MISMO motor que los tests
 * (importa recommend.ts), y emite un JS plano que la landing carga por
 * `<script>`. Si el motor cambia, el archivo regenerado cambia con el — no hay
 * dos implementaciones que puedan divergir.
 *
 * NO se genera a mano. Para regenerar:
 *   node --import tsx apps/academy-landing/scripts/build-catalog.ts
 *
 * Idempotente: si el contenido no cambio, no toca el archivo (mtime estable).
 *
 * El `localStorage` de toques NO va aqui: es del cliente, no se precarga.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildRecommendations, loadCatalog, type CatalogItem, type Recommendation } from './recommend.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'data', 'catalog-reco.js');
const REPO = resolve(HERE, '..', '..', '..');

interface SlimProduct {
  slug: string;
  kind: string;
  tier: string;
  title: string;
  price: number;
  tags: string[];
  categories: string[];
}

interface SlimReco {
  slug: string;
  kind: string;
  tier: string;
  title: string;
  price: number;
  priceLabel: string;
  why: string;
  score: number;
  reason: string;
}

const catalog: CatalogItem[] = loadCatalog(REPO);
if (catalog.length === 0) {
  console.error('[FATAL] catalogo vacio: no se puede generar. Correr desde la raiz del repo.');
  process.exit(2);
}

/**
 * precio por slug -> tier, para que la landing sepa que precio poner al
 * boton de compra de un upsell. La landing ya tiene PRICE_LABELS por tier, asi
 * que basta con el tier; pero el precio real viaja en el objeto para que el
 * browser no dependa de esa tabla.
 */
const products: SlimProduct[] = catalog.map((c) => ({
  slug: c.slug,
  kind: c.kind,
  tier: c.tier,
  title: c.title,
  price: c.price,
  tags: c.tags,
  categories: c.categories,
}));

// Precomputa recomendaciones para TODOS los productos. Asi el browser no
// necesita el motor: solo lee un objeto. Es el mismo dato que produce
// buildRecommendations(), verificado por recommend.test.ts.
const recos: Record<string, SlimReco[]> = {};
for (const item of catalog) {
  recos[item.slug] = buildRecommendations(item, catalog, 3).map((r: Recommendation) => ({
    slug: r.slug,
    kind: r.kind,
    tier: r.tier,
    title: r.title,
    price: r.price,
    priceLabel: r.priceLabel,
    why: r.why,
    score: r.score,
    reason: r.reason,
  }));
}

const body = `/* GENERADO AUTOMATICAMENTE — no editar a mano.
 * Fuente: apps/academy-landing/scripts/build-catalog.ts
 * Regenerar: node --import tsx apps/academy-landing/scripts/build-catalog.ts
 *
 * Datos de recomendacion derivados del catalogo real (apps/academy-web/data).
 * El motor con tests es recommend.ts; este archivo es su salida para el
 * browser, para que la landing (HTML estatico, sin build) pueda ofrecer
 * upsells con motivo trazable en vez de tarjetas fijas.
 */
window.GV_RECO = ${JSON.stringify({ products, recos, generatedFrom: 'apps/academy-web/data' }, null, 0)};
`;

if (existsSync(OUT)) {
  const before = readFileSync(OUT, 'utf8');
  if (before === body) {
    console.log(`[OK] sin cambios: ${OUT} ya esta al dia (${products.length} productos)`);
    process.exit(0);
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, body, 'utf8');
const withRecos = Object.values(recos).filter((r) => r.length > 0).length;
console.log(`[OK] escrito: ${OUT}`);
console.log(`     ${products.length} productos · ${withRecos}/${products.length} con recomendacion`);
