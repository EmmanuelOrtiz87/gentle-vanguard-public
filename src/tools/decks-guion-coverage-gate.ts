#!/usr/bin/env node

/**
 * decks-guion-coverage-gate.ts — Ningún deck se presenta sin guion.
 *
 * POR QUE EXISTE (2026-11-03)
 * Los decks dicen QUÉ va en cada slide, pero no CÓMO se dice. En un evento
 * (conferencia, demo a dirección, pitch a cliente) sin guion, la presentacion
 * se improvisa: se pierde la estructura, se repiten cosas y, peor, se rellena
 * con numeros o afirmaciones que el stack no respalda.
 *
 * El guion por deck es el soporte real de presentacion: texto hablable por
 * slide, tiempo, transicion, las preguntas que seguro van a hacer y lo que
 * NO hay que decir. Sin el, "estamos listos para cualquier evento" es una
 * illusion.
 *
 * QUE CHEQUEA
 *   Para cada deck en `docs/presentations/decks/content/*.js`:
 *     - existe `docs/presentations/decks/speech/<id>.md` (el `id` del deck);
 *     - el guion tiene una seccion por cada slide, en orden, numeradas 1..N;
 *     - cada seccion trae las cuatro claves del contrato:
 *       tiempo, que decir, preguntas esperadas y que no decir.
 *
 * USO
 *   node --import tsx src/tools/decks-guion-coverage-gate.ts
 *   node --import tsx src/tools/decks-guion-coverage-gate.ts --json
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export type Severity = 'error' | 'warn';

export interface GuionFinding {
  rule: string;
  severity: Severity;
  deck: string;
  message: string;
  fix: string;
}

export interface GuionReport {
  ok: boolean;
  errors: number;
  warnings: number;
  decks: number;
  slides: number;
  findings: GuionFinding[];
}

/**
 * Claves que cada seccion de slide del guion debe traer.
 *
 * CADA CLAVE ACEPTA SU VARIANTE EN INGLES (2026-11-03). El gate exige las
 * cuatro claves, pero un guion EN tiene que usar las etiquetas inglesas:
 * exigirle la etiqueta espanola obligaba al guion EN a llevar las dos
 * (`**Time:** 0:45 (**Tiempo:**)`), que es un truco feo que contamina el
 * documento. Se acepta cualquiera de las variantes: lo que importa es que
 * la informacion este, no como se rotula.
 */
export interface SectionKey {
  /** Etiqueta en espanol. */
  readonly es: string;
  /** Etiqueta en ingles (puede haber mas de una variante). */
  readonly en: readonly string[];
  /** Nombre legible, para el mensaje de error. */
  readonly label: string;
}

export const REQUIRED_SECTION_KEYS: readonly SectionKey[] = [
  { es: '**Tiempo:**', en: ['**Time:**'], label: 'Tiempo' },
  { es: '**Qué decir:**', en: ['**What to say:**'], label: 'Qué decir' },
  {
    es: '**Transicion:**',
    en: ['**Transición:**', '**Transition:**'],
    label: 'Transicion',
  },
  {
    es: '**Preguntas esperadas:**',
    en: ['**Expected questions:**'],
    label: 'Preguntas esperadas',
  },
  { es: '**No decir:**', en: ['**Do not say:**'], label: 'No decir' },
];

/** Variantes aceptadas para una clave (espanol + ingles). */
function keyVariants(key: SectionKey): string[] {
  return [key.es, ...key.en];
}

/** Patron de una seccion de slide: `## Slide 7 — Titulo` (o `## Slide 7: Titulo`). */
const SLIDE_HEADING = /^##\s+Slide\s+(\d+)\s*[—:-]\s*(.+)$/;

interface DeckInfo {
  id: string;
  file: string;
  slides: number;
}

/** Extrae el `id` y la cantidad de slides de un content file. */
export function readDeck(contentPath: string): DeckInfo | null {
  const source = readFileSync(contentPath, 'utf8');
  const id = /id:\s*'([^']+)'/.exec(source)?.[1];
  if (!id) return null;
  // Cuenta los `layout:` de primer nivel dentro de `slides: [...]`.
  const slides = (source.match(/^\s{4,}layout:\s*'/gm) ?? []).length;
  return { id, file: contentPath, slides };
}

export interface ParsedGuion {
  sections: Map<number, string>;
  order: number[];
}

/** Parsea las secciones `## Slide N — Titulo` de un guion. */
export function parseGuion(markdown: string): ParsedGuion {
  const sections = new Map<number, string>();
  const order: number[] = [];
  const lines = markdown.split(/\r?\n/);
  let current: number | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    if (current !== null) {
      sections.set(current, buffer.join('\n'));
      order.push(current);
    }
    buffer = [];
  };

  for (const line of lines) {
    const match = SLIDE_HEADING.exec(line);
    if (match) {
      flush();
      current = Number(match[1]);
      continue;
    }
    if (current !== null) buffer.push(line);
  }
  flush();
  return { sections, order };
}

export function defaultRoot(): string {
  return join(import.meta.dirname ?? '.', '..', '..');
}

/** Corre el gate sobre una raiz del repo. */
export function checkGuionCoverage(root: string): GuionReport {
  const findings: GuionFinding[] = [];
  const contentDir = join(root, 'docs', 'presentations', 'decks', 'content');
  const speechDir = join(root, 'docs', 'presentations', 'decks', 'speech');

  let files: string[] = [];
  try {
    files = readdirSync(contentDir)
      .filter((f) => f.endsWith('.js'))
      .sort();
  } catch {
    return { ok: true, errors: 0, warnings: 0, decks: 0, slides: 0, findings };
  }

  let totalSlides = 0;
  const decks: DeckInfo[] = [];
  for (const file of files) {
    const deck = readDeck(join(contentDir, file));
    if (!deck) continue;
    decks.push(deck);
    totalSlides += deck.slides;
  }

  for (const deck of decks) {
    const guionPath = join(speechDir, `${deck.id}.md`);

    if (!existsSync(guionPath)) {
      findings.push({
        rule: 'guion/missing',
        severity: 'error',
        deck: deck.id,
        message:
          `el deck "${deck.id}" (${deck.slides} slides) no tiene guion: ` +
          `falta docs/presentations/decks/speech/${deck.id}.md`,
        fix: `escribir el guion del deck (ver speech/README.md para el contrato)`,
      });
      continue;
    }

    const { sections, order } = parseGuion(readFileSync(guionPath, 'utf8'));

    // 1) Cobertura: una seccion por slide, numeradas 1..N.
    for (let n = 1; n <= deck.slides; n++) {
      if (!sections.has(n)) {
        findings.push({
          rule: 'guion/missing-slide',
          severity: 'error',
          deck: deck.id,
          message: `el guion de "${deck.id}" no tiene la seccion "## Slide ${n}" (el deck tiene ${deck.slides} slides)`,
          fix: `agregar la seccion "## Slide ${n} — <titulo>" al guion`,
        });
      }
    }

    // 2) Secciones de mas: el guion no debe inventar slides.
    for (const n of order) {
      if (n > deck.slides) {
        findings.push({
          rule: 'guion/extra-slide',
          severity: 'error',
          deck: deck.id,
          message: `el guion de "${deck.id}" tiene "## Slide ${n}" pero el deck solo tiene ${deck.slides} slides`,
          fix: 'borrar la seccion o corregir la numeracion',
        });
      }
    }

    // 3) Orden: las secciones van en orden.
    const sorted = [...order].sort((a, b) => a - b);
    if (order.join(',') !== sorted.join(',')) {
      findings.push({
        rule: 'guion/out-of-order',
        severity: 'error',
        deck: deck.id,
        message: `las secciones del guion de "${deck.id}" no estan en orden`,
        fix: 'numerar las secciones en orden ascendente',
      });
    }

    // 4) Cada seccion trae las cuatro claves del contrato (es o en).
    for (const [n, body] of sections) {
      for (const key of REQUIRED_SECTION_KEYS) {
        const variants = keyVariants(key);
        if (!variants.some((v) => body.includes(v))) {
          findings.push({
            rule: 'guion/missing-key',
            severity: 'error',
            deck: deck.id,
            message: `la seccion "## Slide ${n}" del guion de "${deck.id}" no tiene "${key.label}" (${variants.join(' | ')})`,
            fix: `agregar "${key.es}" (o su variante en ingles) a la seccion`,
          });
        }
      }
    }
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warn').length;
  return { ok: errors === 0, errors, warnings, decks: decks.length, slides: totalSlides, findings };
}

function main(): void {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 && argv[rootIdx + 1] ? argv[rootIdx + 1] : defaultRoot();

  const report = checkGuionCoverage(root);

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `decks-guion-coverage-gate -> ${report.decks} decks, ${report.slides} slides, ` +
        `${report.errors} errores, ${report.warnings} avisos`,
    );
    for (const f of report.findings) {
      console.log(`  ${f.severity === 'error' ? 'ERR ' : 'WARN'} ${f.rule} ${f.deck}: ${f.message}`);
      console.log(`       fix: ${f.fix}`);
    }
    if (report.ok) console.log('  OK: cada deck tiene guion con cobertura completa');
  }

  if (!report.ok) {
    console.error(
      'decks-guion-coverage-gate -> FAIL: hay decks sin guion completo. ' +
        'Un deck sin guion se improvisa, y lo que se improvisa se inventa.',
    );
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
