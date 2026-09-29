/**
 * DETECTA CONTENIDO DUPLICADO O SOLAPADO EN EL CATÁLOGO.
 *
 * POR QUE EXISTE
 * --------------
 * Un cliente que paga 50 USD por un curso y descubre que es el mismo
 * contenido que otro que cuesta 40 pierde la confianza en todo el catálogo.
 * La regla de negocio: si dos productos tienen nombre similar, el contenido
 * tiene que ser DISTINTO — o tiene que ser un COMBO declarado (y ahí el mismo
 * contenido sí tiene sentido).
 *
 * Este módulo no juzga: mide. Calcula la huella de contenido de cada producto
 * y devuelve pares sospechosos con el motivo. La decisión es del owner.
 *
 * MÉTRICA
 * -------
 * Huella = conjunto de shingles (n-gramas de palabras) del texto propio del
 * producto, excluyendo el título y la descripción (que son los campos que
 * legítimamente se parecen entre productos relacionados).
 *
 * Jaccard = |A∩B| / |A∪B|. Dos productos con Jaccard > 0.8 son
 * essencialmente el mismo texto con otro nombre.
 *
 * Run: node --import tsx apps/academy-landing/scripts/audit-duplicates.ts
 *   --json    salida JSON (para CI)
 *   --min 0.8 umbral de similitud (default 0.8)
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = process.cwd();
const DATA = join(REPO, 'apps', 'academy-web', 'data');

export interface ProductFingerprint {
  slug: string;
  kind: 'course' | 'ebook' | 'toolkit';
  tier: string | null;
  title: string;
  /** Archivos de contenido que lo componen. */
  files: string[];
  /** Longitud del texto propio, en palabras. */
  words: number;
  /** Shingles de 5 palabras (Set de hashes). */
  shingles: Set<number>;
}

export interface DuplicatePair {
  a: string;
  b: string;
  kinds: string;
  titles: [string, string];
  tiers: [string | null, string | null];
  jaccard: number;
  /** Shingles compartidos: el tamaño real del bloque de texto en común. */
  sharedShingles: number;
  /** 0-1. Qué parte del producto más pequeño está contenida en el otro. */
  containment: number;
  reason: string;
}

const STOPWORDS = new Set(
  ('de la que el en y a los del se las por un para con no una su al lo como mas pero sus le ya este si porque esta entre cuando muy sin sobre tambien me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mi antes algunos que unos yo otro otras otra tanto esa estos mucho quienes nada muchos cual sea poco ella estar haber estas estaba estamos algunas algo nosotros',
  ).split(' '),
);

function normalize(text: string): string[] {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Hash de string a entero (FNV-1a de 32 bits) para shingles baratos. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Shingles de n palabras, como set de hashes. */
function shingle(words: string[], n = 5): Set<number> {
  const out = new Set<number>();
  if (words.length < n) {
    if (words.length) out.add(hash(words.join(' ')));
    return out;
  }
  for (let i = 0; i + n <= words.length; i += 1) out.add(hash(words.slice(i, i + n).join(' ')));
  return out;
}

function readMaybe(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** Extrae el texto legible de un content*.js: quita el envoltura de JS. */
function contentWords(js: string): string[] {
  // Los content*.js son `window.GV_CONTENT[...] = [...]` con strings y
  // marcado. Nos interesa el texto, no la estructura.
  const strings = [...js.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);
  return normalize(strings.join(' ').replace(/\\n/g, ' '));
}

/** Carga la huella de un producto (course/ebook/toolkit). */
export function fingerprint(dir: string, kind: ProductFingerprint['kind']): ProductFingerprint | null {
  const slug = dir.split(/[\\/]/).pop()!;
  const file = kind === 'course' ? 'course.json' : kind === 'ebook' ? 'ebook.json' : 'toolkit.json';
  const manifestRaw = readMaybe(join(dir, file));
  if (!manifestRaw) return null;

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
  } catch {
    return null;
  }

  // Reúne el contenido propio: tracks.js, content*.js, glossary.js.
  const words: string[] = [];
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!/\.(js|md|txt)$/i.test(name) || name === file || name === 'i18n.js') continue;
    if (!/^(content|tracks|glossary|index|lessons|intro)/i.test(name)) continue;
    const raw = readMaybe(join(dir, name));
    if (!raw) continue;
    files.push(name);
    words.push(...(name.endsWith('.json') ? normalize(raw) : contentWords(raw)));
  }

  return {
    slug,
    kind,
    tier: typeof manifest.priceTier === 'string' ? manifest.priceTier : null,
    title: typeof manifest.title === 'string' ? manifest.title : slug,
    files: files.sort(),
    words: words.length,
    shingles: shingle(words),
  };
}

/** Carga todas las huellas del catálogo. */
export function loadFingerprints(dataDir = DATA): ProductFingerprint[] {
  const out: ProductFingerprint[] = [];
  const kinds: Array<[string, ProductFingerprint['kind']]> = [
    ['courses', 'course'],
    ['ebooks', 'ebook'],
    ['toolkits', 'toolkit'],
  ];
  for (const [sub, kind] of kinds) {
    const full = join(dataDir, sub);
    if (!existsSync(full)) continue;
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const fp = fingerprint(join(full, entry.name), kind);
      if (fp) out.push(fp);
    }
  }
  return out;
}

function jaccard(a: Set<number>, b: Set<number>): number {
  if (!a.size || !b.size) return 0;
  const inter = intersection(a, b);
  return inter / (a.size + b.size - inter);
}

/** Tamaño de la intersección de dos conjuntos de shingles. */
function intersection(a: Set<number>, b: Set<number>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const v of small) if (large.has(v)) inter += 1;
  return inter;
}

function containment(a: Set<number>, b: Set<number>): number {
  if (!a.size || !b.size) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const v of small) if (large.has(v)) inter += 1;
  return inter / small.size;
}

/** Compara dos huellas y explica el veredicto si son sospechosas. */
export function compare(a: ProductFingerprint, b: ProductFingerprint, min = 0.8): DuplicatePair | null {
  const j = jaccard(a.shingles, b.shingles);
  const c = containment(a.shingles, b.shingles);
  if (j < min && c < min) return null;

  // El motivo compone TODOS los hechos aplicables, no solo el primero: un par
  // puede diferir en tipo Y en precio a la vez, y el owner necesita saberlo.
  const hechos: string[] = ['contenido casi identico'];
  if (a.kind !== b.kind) {
    hechos.push(`tipos distintos (${a.kind} vs ${b.kind})`);
  }
  if (a.tier !== null && b.tier !== null && a.tier !== b.tier) {
    hechos.push(`tier/precio DISTINTO (${a.tier} vs ${b.tier}) — cobrar distinto por el mismo texto`);
  } else if (a.tier === b.tier) {
    hechos.push(`mismo tier (${a.tier})`);
  }
  if (c >= 0.99 && j < 0.99) {
    hechos.push('uno esta casi totalmente contenido en el otro (version corta vs extendida)');
  }

  return {
    a: a.slug,
    b: b.slug,
    kinds: a.kind === b.kind ? a.kind : `${a.kind}/${b.kind}`,
    titles: [a.title, b.title],
    tiers: [a.tier, b.tier],
    jaccard: Number(j.toFixed(3)),
    /** Shingles compartidos: el tamaño real del bloque de texto en común. */
    sharedShingles: intersection(a.shingles, b.shingles),
    containment: Number(c.toFixed(3)),
    reason: hechos.join(' · '),
  };
}

/** Auditoría completa: todos los pares sospechosos. */
export function auditDuplicates(min = 0.8, dataDir = DATA): DuplicatePair[] {
  const prints = loadFingerprints(dataDir);
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < prints.length; i += 1) {
    for (let j = i + 1; j < prints.length; j += 1) {
      const hit = compare(prints[i]!, prints[j]!, min);
      if (hit) pairs.push(hit);
    }
  }
  return pairs.sort((x, y) => y.jaccard - x.jaccard);
}

// ── CLI ──────────────────────────────────────────────────────────────────

function isMain(): boolean {
  return process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() ?? '');
}

if (isMain()) {
  const asJson = process.argv.includes('--json');
  const minIdx = process.argv.indexOf('--min');
  const min = minIdx >= 0 ? Number(process.argv[minIdx + 1]) || 0.8 : 0.8;
  const prints = loadFingerprints();
  const pairs = auditDuplicates(min);

  if (asJson) {
    console.log(JSON.stringify({ min, products: prints.length, pairs }, null, 2));
  } else {
    console.log(`Catálogo: ${prints.length} productos (${prints.filter((p) => p.kind === 'course').length} cursos, ${prints.filter((p) => p.kind === 'ebook').length} ebooks, ${prints.filter((p) => p.kind === 'toolkit').length} toolkits)`);
    console.log(`Umbral: Jaccard >= ${min}\n`);
    if (!pairs.length) {
      console.log('Sin pares sospechosos: ningún producto duplica el contenido de otro.');
    } else {
      console.log(`${pairs.length} par(es) sospechoso(s):\n`);
      for (const p of pairs) {
        console.log(`  ${p.jaccard.toFixed(2)} Jaccard · ${p.containment.toFixed(2)} containment`);
        console.log(`    [${p.kinds}] ${p.titles[0]}  <->  ${p.titles[1]}`);
        console.log(`    ${p.a} <-> ${p.b}`);
        console.log(`    → ${p.reason}\n`);
      }
    }
    // Productos con poco contenido:Candidates a "contenido por completar".
    const thin = prints.filter((p) => p.words < 300);
    if (thin.length) {
      console.log(`\nProductos con poco texto propio (<300 palabras): ${thin.length}`);
      for (const p of thin) console.log(`  [${p.kind}] ${p.slug} — ${p.words} palabras, ${p.files.length} archivo(s)`);
    }
  }
  process.exit(0);
}
