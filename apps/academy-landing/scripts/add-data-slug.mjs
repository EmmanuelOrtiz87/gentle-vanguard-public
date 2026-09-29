#!/usr/bin/env node
/**
 * Genera `data-slug` en los botones de compra de la landing.
 *
 * POR QUE HACE FALTA
 * ------------------
 * `externalReference` es la unica pista del producto que viaja del pago al
 * portal. Sin slug solo llega el TIER, y con el tier no se puede saber QUE
 * curso/ebook compro la persona (el webhook del CRM terminaba grabando
 * `product_type: 'other'`). Este script agrega el slug a los 95 botones.
 *
 * COMO RESUELVE EL matching
 * -------------------------
 * Los botones tienen `data-product` con el TITULO ("Excel + IA") y el catalogo
 * tiene directorios con el SLUG ("excel-ia"). Matchea por slug exacto, luego
 * por slug contra el titulo normalizado, y al final por titulo contra el
 * `title` del manifest. Cada coincidencia se IMPORTA a mano: no se adivina.
 *
 * Los que no pueden mapearse quedan SIN slug y el script los reporta, para no
 * emitir un slug equivocado (peor que no tener slug: atribuía el producto
 * incorrecto al cliente).
 *
 * Run: node apps/academy-landing/scripts/add-data-slug.mjs [--check]
 *   --check  solo reporta, no escribe (para CI)
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LANDING = resolve(HERE, '..', 'index.html');
const DATA = resolve(HERE, '..', '..', 'academy-web', 'data');
const CHECK_ONLY = process.argv.includes('--check');

/** Normaliza para comparar: sin acentos, minúsculas, solo alfanuméricos. */
function norm(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Carga el catalogo: slug -> { title, kind, tier }. */
function loadCatalog() {
  const out = new Map();
  const kinds = [
    ['courses', 'course.json', 'course'],
    ['ebooks', 'ebook.json', 'ebook'],
    ['toolkits', 'toolkit.json', 'toolkit'],
  ];
  for (const [dir, file, kind] of kinds) {
    const full = join(DATA, dir);
    if (!existsSync(full)) continue;
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = join(full, entry.name, file);
      if (!existsSync(manifest)) continue;
      try {
        const raw = JSON.parse(readFileSync(manifest, 'utf8'));
        const slug = typeof raw.id === 'string' && raw.id ? raw.id : entry.name;
        out.set(slug, { slug, title: raw.title ?? slug, kind, tier: raw.priceTier ?? null });
      } catch {
        /* manifest roto: se ignora, el catalogo real lo reporta catalog.ts */
      }
    }
  }
  return out;
}

const catalog = loadCatalog();
const html = readFileSync(LANDING, 'utf8');

// Indices de busqueda, en orden de preferencia.
const bySlug = new Map();
const byNormalizedTitle = new Map();
const bySlugInTitle = new Map();
for (const entry of catalog.values()) {
  bySlug.set(entry.slug, entry);
  byNormalizedTitle.set(norm(entry.title), entry);
  for (const token of entry.slug.split('-')) {
    if (token.length >= 4 && !bySlugInTitle.has(token)) bySlugInTitle.set(token, entry);
  }
}

/**
 * Prefijos de etiqueta comercial que la landing antepone al titulo real.
 * "Curso: Introducción a Linux" es el mismo producto que "Introducción a Linux"
 * — el prefijo NO cambia el producto, solo la forma de presentarlo.
 * Se quitan ANTES de comparar, pero el resultado conserva el kind del catalogo
 * (no el del prefijo): un "Curso: ..." es un curso igual.
 */
const LABEL_PREFIXES = [
  'Curso + Acompañamiento',
  'Curso + Mentoría',
  'Curso',
  'eBook Micro',
  'eBook Premium',
  'Toolkit',
  'Programa',
];

/** Cada prefijo se compara en su forma literal y en su forma normalizada. */
function prefixVariants(prefix) {
  return [...new Set([prefix, norm(prefix)])];
}

/** Quita el prefijo de etiqueta si el resto matchea un producto del catalogo. */
function stripLabel(title) {
  const n = norm(title);
  for (const prefix of LABEL_PREFIXES) {
    for (const variant of prefixVariants(prefix)) {
      if (n === variant) continue;
      if (n.startsWith(`${variant}-`)) {
        const rest = n.slice(variant.length + 1);
        if (bySlug.has(rest) || byNormalizedTitle.has(rest)) {
          return bySlug.get(rest) ?? byNormalizedTitle.get(rest);
        }
      }
    }
  }
  return null;
}

/** Resuelve el slug de un boton, o null si no hay coincidencia confiable. */
function resolveSlug(title) {
  const t = String(title ?? '').trim();
  if (!t) return null;

  // 0) Prefijo comercial ("Curso: ...") → el producto de adentro.
  const stripped = stripLabel(t);
  if (stripped) return stripped.slug;

  // 1) El titulo ES el slug.
  if (bySlug.has(t)) return t;

  const n = norm(t);
  // 2) Titulo normalizado == slug normalizado.
  if (bySlug.has(n)) return n;
  // 3) Titulo normalizado == title del manifest normalizado.
  if (byNormalizedTitle.has(n)) return byNormalizedTitle.get(n).slug;
  // 4) El titulo contiene un slug completo.
  for (const slug of bySlug.keys()) {
    if (new RegExp(`(^|-)${slug}(-|$)`).test(n)) return slug;
  }
  return null;
}

// Reescribe cada <a class="... btn-checkout" ...> agregando data-slug.
const anchor = /<a\b[^>]*\bclass="[^"]*\bbtn-checkout\b[^"]*"[^>]*>/g;
let matched = 0;
let alreadyHad = 0;
const unmapped = [];

const output = html.replace(anchor, (tag) => {
  matched += 1;
  if (/\bdata-slug=/.test(tag)) {
    alreadyHad += 1;
    return tag;
  }
  const title = /\bdata-product="([^"]*)"/.exec(tag)?.[1] ?? '';
  const tier = /\bdata-tier="([^"]*)"/.exec(tag)?.[1] ?? '';
  const slug = resolveSlug(title, tier);
  if (!slug) {
    unmapped.push({ title, tier });
    return tag;
  }
  return tag.replace(/<a\b/, `<a data-slug="${slug}"`);
});

console.log(`botones de compra: ${matched}`);
console.log(`  con data-slug previo: ${alreadyHad}`);
console.log(`  mapeados ahora: ${matched - alreadyHad - unmapped.length}`);
console.log(`  SIN slug (revisar a mano): ${unmapped.length}`);
if (unmapped.length) {
  console.log('\nSin slug:');
  for (const u of unmapped) console.log(`  [${u.tier || '?'}] ${u.title}`);
}

if (CHECK_ONLY) {
  process.exit(unmapped.length > 0 ? 1 : 0);
}
if (output !== html) {
  writeFileSync(LANDING, output, 'utf8');
  console.log(`\nescrito: ${LANDING}`);
}
