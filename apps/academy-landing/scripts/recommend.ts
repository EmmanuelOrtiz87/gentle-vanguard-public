/**
 * Motor de recomendacion y upsell — Academy Landing.
 *
 * QUE NECESITA Y POR QUE NO SE RESUELVE CON UNA TABLA
 * ----------------------------------------------------
 * Los `BUMP_OFFERS`/`UPSELLS` de la landing son 2 y 2 tarjetas fijas: el mismo
 * "Toolkit de IA" se ofrece igual a quien compra "Introducción a Linux" que a
 * quien compra "Agentes de IA". Eso no es upsell, es抽奖 — regalar la
 * probabilidad de que toque.
 *
 * Para que la oferta tenga sentido hace falta VERDAD sobre dos cosas:
 *  1. Que los productos realmente se relacionen (tema compartido, tags, o uno
 *     declarado como complemento del otro).
 *  2. Que el precio tenga sentido: ofrecer algo de 250 USD a quien compró algo
 *     de 20 USD no es complemento, es 导致 abandono.
 *
 * TODO se deriva del catálogo real (los manifests de academy-web/data), sin
 * inventar datos: si no hay evidencia de relación, no hay oferta.
 *
 * SEÑAL DE INTENCIÓN
 * -----------------
 * La landing ya distingue: botón de compra directo (intención alta) vs
 * checkout abierto y cancelado (intención media, se quedó pensando). Eso es
 * una señal VERIFICABLE y que ya existe, sin necesidad de metre el pedido
 * dentro del analytics. Se usa para no ofrecer lo mismo dos veces a la misma
 * persona (regla de los 3 toques) — no para medir conversiones.
 *
 * Puro: sin I/O, sin DOM. `buildRecommendations` es la función que la landing
 * invoca; los tests fijan el contrato.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type ProductKind = 'course' | 'ebook' | 'toolkit';
export type Tier = 'ebook-micro' | 'ebook-premium' | 'toolkit' | 'course-base' | 'course-mentor' | 'program-custom' | 'mentor-individual';

export interface CatalogItem {
  slug: string;
  kind: ProductKind;
  tier: Tier;
  title: string;
  subtitle?: string;
  description?: string;
  categories: string[];
  tags: string[];
  price: number;
}

export interface Recommendation {
  slug: string;
  kind: ProductKind;
  tier: Tier;
  title: string;
  price: number;
  priceLabel: string;
  /** El motivo REAL por el que se recomienda ( trazable al catálogo). */
  why: string;
  /** 0-1. Qué tan fuerte es la relación. */
  score: number;
  reason: RelationKind;
}

export type RelationKind =
  | 'complement'   // declarado como complemento
  | 'same-topic'   // comparte tema/tags con el producto comprado
  | 'bundle'       // el toolkit contiene este producto
  | 'next-level';  // version superior declarada

export interface ShopperSignal {
  slug: string;
  kind: ProductKind;
  tier: Tier;
  /** true = click directo en "Comprar". false = abrió y cerró el checkout. */
  highIntent: boolean;
}

/** Relaciones declaradas a mano. Deben justificarse: no son "similitud". */
const DECLARED_COMPLEMENTS: Record<string, Array<{ slug: string; why: string }>> = {
  'agentes-ia': [
    { slug: 'ia-fundamentos', why: 'Los agentes asumen que ya sabes prompting: este curso cubre los fundamentos.' },
    { slug: 'gemini', why: 'Gemini es el modelo que más usás si ya trabajás con agentes.' },
    { slug: 'checklist-semana-1', why: 'La lista de checkpoints para arrancar a aplicar sin overwhelmed.' },
  ],
  'excel-ia': [
    { slug: 'ia-fundamentos', why: 'Los prompts funcionan mejor cuando entendés qué hace el modelo.' },
  ],
  'git-github': [
    { slug: 'linux-intro', why: 'La terminal es donde Git se usa de verdad.' },
    { slug: 'ia-fundamentos', why: 'Versioná lo que aprendés de IA mientras practicás.' },
  ],
};

/**
 * "Siguiente nivel" declarado. NO se infiere del nombre: un nombre parecido
 * ("python-inicial" / "python-avanzado") NO implica que uno sea el siguiente paso
 * del otro: hay que declararlo.
 */
const NEXT_LEVEL: Record<string, string> = {
  'python-inicial': 'python-intermedio',
  'python-intermedio': 'python-avanzado',
  'ia-fundamentos': 'ia-intermedio',
  'ia-intermedio': 'ia-avanzado',
  'excel-ia': 'ia-marketing',
  'manual-ia-estudiantes': 'ia-estudiantes-pro',
  'manual-ia-docentes': 'ia-docentes-pro',
  'manual-ia-administracion': 'ia-administracion-pro',
  'manual-ia-finanzas': 'ia-finanzas-pro',
  'manual-ia-legal': 'ia-legal-pro',
  'manual-ia-marketing': 'ia-marketing-pro',
  'manual-ia-ventas': 'ia-ventas-pro',
  'ia-ventas': 'ia-ventas-pro',
};

/** Toolkits que ya contienen estos productos (evita ofrecer lo que ya tiene). */
const BUNDLES: Record<string, string[]> = {};

/** Un toolkit cuyo slug contiene TODOS estos tokens ya incluye el producto. */
const BUNDLE_INCLUDES: Record<string, string[]> = {
  'agentes-ia': ['agentes'],
  'ia-fundamentos': ['fundamentos'],
  'python-inicial': ['python'],
  'git-github': ['git'],
  'sql': ['sql'],
  'linux-intro': ['linux'],
  'web-inicial': ['web-inicial'],
  'marketing-ia': ['marketing'],
};

/** Rango de precio aceptable como complemento, segun lo que ya compró. */
const UPSELL_MAX_RATIO = 2.5;   // hasta 2,5x el precio de lo comprado
const UPSELL_MIN_RATIO = 0.4;   // no tan barato que parezca un reembolso

/** Carga el catálogo real desde los manifests de academy-web. */
export function loadCatalog(repoRoot: string = process.cwd()): CatalogItem[] {
  const data = join(resolve(repoRoot), 'apps', 'academy-web', 'data');
  const out: CatalogItem[] = [];
  const prices = loadPrices(join(data, 'store', 'pricing.json'));
  const kinds: Array<[string, ProductKind, string]> = [
    ['courses', 'course', 'course.json'],
    ['ebooks', 'ebook', 'ebook.json'],
    ['toolkits', 'toolkit', 'toolkit.json'],
  ];
  for (const [sub, kind, file] of kinds) {
    const dir = join(data, sub);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(dir, entry.name, file);
      if (!existsSync(path)) continue;
      try {
        const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
        const slug = typeof raw.id === 'string' && raw.id ? raw.id : entry.name;
        const tier = raw.priceTier as Tier | undefined;
        if (!tier || !(tier in prices)) continue;
        out.push({
          slug,
          kind,
          tier,
          title: typeof raw.title === 'string' ? raw.title : slug,
          subtitle: typeof raw.subtitle === 'string' ? raw.subtitle : undefined,
          description: typeof raw.description === 'string' ? raw.description : undefined,
          categories: Array.isArray(raw.categories) ? (raw.categories as string[]) : [],
          tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
          price: prices[tier] ?? 0,
        });
      } catch {
        /* manifest roto: catalog.ts ya lo reporta; acá se ignora */
      }
    }
  }
  return out;
}

function loadPrices(path: string): Record<string, number> {
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      products?: Record<string, { price?: number | string }>;
    };
    const out: Record<string, number> = {};
    for (const [tier, v] of Object.entries(raw.products ?? {})) {
      const n = typeof v?.price === 'number' ? v.price : Number.parseFloat(String(v?.price));
      if (Number.isFinite(n)) out[tier] = n;
    }
    return out;
  } catch {
    return {};
  }
}

/** Tokens de tema compartidos entre dos productos (tags + categorías). */
function sharedTokens(a: CatalogItem, b: CatalogItem): string[] {
  const setB = new Set([...b.tags, ...b.categories].map((t) => t.toLowerCase()));
  return [...new Set([...a.tags, ...a.categories].map((t) => t.toLowerCase()))].filter((t) => setB.has(t));
}

/** ¿Este toolkit ya incluye el producto comprado? */
function bundleIncludes(bundleSlug: string, productSlug: string): boolean {
  const tokens = BUNDLE_INCLUDES[productSlug];
  if (!tokens) return false;
  return tokens.every((tok) => bundleSlug.toLowerCase().includes(tok));
}

/**
 * Calcula las recomendaciones para un producto comprado.
 *
 * ORDEN DE PREFERENCIA (el mas fuerte primero, y gana si hay conflicto):
 *  1. complemento declarado  — máxima confianza, es un curacion humana
 *  2. bundle que lo contiene — solo tiene sentido si NO lo compra todavia
 *  3. siguiente nivel       — progression explicita
 *  4. mismo tema            — tags/categorias compartidos, con score por overlap
 *
 * Filtros duros (no negociables):
 *  - nunca el mismo producto
 *  - nunca algo que el bundle ya incluye
 *  - nunca un producto con precio fuera de [0,4x .. 2,5x] del comprado
 */
export function buildRecommendations(
  bought: CatalogItem,
  catalog: CatalogItem[],
  limit = 3,
): Recommendation[] {
  const bySlug = new Map(catalog.map((c) => [c.slug, c]));
  const out: Recommendation[] = [];
  const seen = new Set<string>([bought.slug]);

  const push = (item: CatalogItem | undefined, why: string, score: number, reason: RelationKind) => {
    if (!item || seen.has(item.slug)) return;
    if (!priceMakesSense(bought.price, item.price)) return;
    seen.add(item.slug);
    out.push({
      slug: item.slug,
      kind: item.kind,
      tier: item.tier,
      title: item.title,
      price: item.price,
      priceLabel: formatPrice(item.price),
      why,
      score: Number(score.toFixed(3)),
      reason,
    });
  };

  // 1) Complementos declarados.
  for (const c of DECLARED_COMPLEMENTS[bought.slug] ?? []) {
    push(bySlug.get(c.slug), c.why, 1, 'complement');
  }

  // 2) Bundles que contienen lo comprado (sube al pack completo).
  for (const item of catalog) {
    if (item.kind !== 'toolkit') continue;
    if (bundleIncludes(item.slug, bought.slug) && !seen.has(item.slug)) {
      const why = 'Trae el material del curso más plantillas, prompts y casos reales.';
      push(item, why, 0.9, 'bundle');
    }
  }

  // 3) Siguiente nivel declarado.
  const nextSlug = NEXT_LEVEL[bought.slug];
  if (nextSlug) {
    const next = bySlug.get(nextSlug);
    if (next) {
      const why = `El siguiente paso: ${next.title}.`;
      push(next, why, 0.8, 'next-level');
    }
  }

  // 4) Mismo tema por tags/categorías compartidos.
  for (const item of catalog) {
    if (seen.has(item.slug)) continue;
    const shared = sharedTokens(bought, item);
    if (shared.length < 1) continue;
    const score = 0.3 + Math.min(shared.length * 0.1, 0.35);
    const label = shared.slice(0, 2).join(' + ');
    const why = `Cubre ${label}, que también aparece en lo que compraste.`;
    push(item, why, score, 'same-topic');
  }

  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** El precio del complemento tiene que ser razonable frente a lo comprado. */
export function priceMakesSense(boughtPrice: number, offerPrice: number): boolean {
  if (!(boughtPrice > 0) || !(offerPrice > 0)) return false;
  const ratio = offerPrice / boughtPrice;
  return ratio >= UPSELL_MIN_RATIO && ratio <= UPSELL_MAX_RATIO;
}

/**
 * Aplica la regla de los 3 toques: no ofrecer más de `maxTouches` veces lo
 * mismo a la misma persona.
 *
 * `alreadyOffered` puede ser un Set (cada elemento cuenta 1 toque) o un Map
 * con el conteo real. El Map importa: con un Set, "lo Offerció una vez" y "lo
 * ofrecio dos veces" serían indistinguibles, y un solo rechazo bloquearía la
 * segunda oportunidad, que es justamente lo que la regla NO quiere.
 *
 * No es métrica: es respeto. Si alguien rechazó "Python avanzado" dos veces,
 * insistir es molestarlo, no vender.
 */
export function applyTouchLimit(
  candidates: Recommendation[],
  alreadyOffered: ReadonlySet<string> | ReadonlyMap<string, number>,
  maxTouches = 2,
): { visible: Recommendation[]; exhausted: string[] } {
  const counts = new Map<string, number>();
  if (alreadyOffered instanceof Map) {
    for (const [slug, count] of alreadyOffered) counts.set(slug, Math.max(0, count));
  } else {
    for (const slug of alreadyOffered) counts.set(slug, 1);
  }

  const visible: Recommendation[] = [];
  const exhausted: string[] = [];
  for (const c of candidates) {
    const seen = counts.get(c.slug) ?? 0;
    if (seen >= maxTouches) {
      exhausted.push(c.slug);
      continue;
    }
    counts.set(c.slug, seen + 1);
    visible.push(c);
  }
  return { visible, exhausted };
}

/** Registra un toque más sobre un Map de conteos. Puro: devuelve uno nuevo. */
export function touchOffered(counts: ReadonlyMap<string, number>, slug: string): Map<string, number> {
  const next = new Map(counts);
  next.set(slug, (next.get(slug) ?? 0) + 1);
  return next;
}

/**
 * Persiste el rechazo para no reofrecer. Best-effort.
 *
 * Guarda un MAP de conteos, no un Set: si solo guardamos los slugs, no
 * podemos distinguir "lo rechazé una vez" de "lo rechazé dos", y la regla de
 * los 3 toques dejaría de funcionar al segundo rechazo.
 */
export function recordOfferTouch(storage: Storage | null, slug: string): Map<string, number> {
  const empty = new Map<string, number>();
  if (!storage) return empty;
  let next = empty;
  try {
    const raw = storage.getItem(TOUCH_KEY);
    next = parseTouchMap(raw);
  } catch {
    /* best-effort */
  }
  const withTouch = touchOffered(next, slug);
  try {
    storage.setItem(TOUCH_KEY, JSON.stringify([...withTouch]));
  } catch {
    /* best-effort */
  }
  return withTouch;
}

/** Lee los conteos de toques guardados. Devuelve Map vacío si no hay o está roto. */
export function readOfferTouches(storage: Storage | null): Map<string, number> {
  if (!storage) return new Map();
  try {
    return parseTouchMap(storage.getItem(TOUCH_KEY));
  } catch {
    return new Map();
  }
}

const TOUCH_KEY = 'gv-offer-touches';

/** Acepta el formato Map serializado y tolera el Set legado. */
function parseTouchMap(raw: string | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item === 'string') out.set(item, 1);
        else if (Array.isArray(item) && item.length === 2) {
          const [slug, n] = item as [string, number];
          if (typeof slug === 'string' && Number.isFinite(n)) out.set(slug, n);
        }
      }
    } else if (parsed && typeof parsed === 'object') {
      for (const [slug, n] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof n === 'number' && Number.isFinite(n)) out.set(slug, n);
      }
    }
  } catch {
    return new Map();
  }
  return out;
}

export function formatPrice(usd: number): string {
  return `USD ${Number.isInteger(usd) ? usd : usd.toFixed(2)}`;
}

/** Debug: qué se le ofrece a cada producto del catálogo. */
export function auditCatalog(catalog: CatalogItem[]): Array<{ slug: string; recs: string[] }> {
  return catalog.map((item) => ({
    slug: item.slug,
    recs: buildRecommendations(item, catalog, 3).map((r) => `${r.slug}:${r.reason}`),
  }));
}

