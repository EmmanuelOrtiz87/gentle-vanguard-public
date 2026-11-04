#!/usr/bin/env node

/**
 * glossary-export.ts — Exporta el glosario del sitio a un documento portable.
 *
 * POR QUE EXISTE (2026-11-03)
 * El glosario del stack vivia DENTRO del sitio: `docs/presentations/glossary.html`
 * (cards con termino, categoria, definicion y donde vive en el repo). Para
 * preparar una presentacion fuera del navegador (notas, reunion, email,
 *chet, impreso) no habia nada que consultar: habia que abrir el sitio.
 *
 * Ademas, duplicar el glosario en un .md seria una fuente mas que envejeceria
 * sin que nadie lo notara. Este exportador deriva el documento del HTML, que
 * es la fuente unica, y el gate de drift verifica que esten al dia.
 *
 * QUE PRODUCE
 *   `docs/presentations/NOMENCLATURA.md` — glosario en Markdown, agrupado por
 *   categoria y ordenado alfabeticamente dentro de cada grupo.
 *
 * USO
 *   node --import tsx src/tools/glossary-export.ts            # escribe el MD
 *   node --import tsx src/tools/glossary-export.ts --check    # verifica drift
 *   node --import tsx src/tools/glossary-export.ts --json
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface GlossaryEntry {
  term: string;
  category: string;
  definition: string;
  where: string;
  id: string;
}

/** Normaliza espacios (incluye newlines) de un bloque de texto. */
function squish(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Quita etiquetas HTML y entities comunes de un valor extraido.
 *
 * El HTML del glosario parte tags en varias lineas (`</span\n >`), asi que un
 * regex ingenuo deja markup pegado al texto ("Command Center</span ><span
 * class=...>"). Aqui se limpia el residuo.
 */
export function stripTags(text: string): string {
  return squish(
    text
      .replace(/<[^>]*>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' '),
  );
}

/** Escapa el pipe para que no rompa la tabla Markdown. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

/**
 * Parsea las cards de `glossary.html`.
 *
 * Estructura esperada por card:
 *   <div class="gloss-card" id="term-xxx">
 *     <span class="gloss-term mono">TERMINO</span>
 *     <span class="gloss-cat" ...>CATEGORIA</span>
 *     <p class="gloss-def">DEFINICION</p>
 *     <div class="gloss-where mono">DONDE</div>
 */
export function parseGlossary(html: string): GlossaryEntry[] {
  const entries: GlossaryEntry[] = [];

  // El HTML parte los tags en varias lineas (`</span\n >`), asi que los
  // cierres se aceptan con `</tag\s*>`. Y el bloque de cada card se toma
  // partiendo por el inicio de la siguiente, en vez de un lookahead fragile.
  const chunks = html.split(/<div class="gloss-card" id="term-/).slice(1);

  for (const chunk of chunks) {
    const id = (/^([^"]+)"/.exec(chunk)?.[1] ?? '').trim();
    const body = chunk;

    const term = stripTags(
      /<span class="gloss-term[^"]*"[^>]*>([\s\S]*?)<\/span\s*>/.exec(body)?.[1] ?? '',
    );
    const category = stripTags(
      /<span class="gloss-cat"[^>]*>([\s\S]*?)<\/span\s*>/.exec(body)?.[1] ?? '',
    );
    const definition = stripTags(
      /<p class="gloss-def"[^>]*>([\s\S]*?)<\/p\s*>/.exec(body)?.[1] ?? '',
    );
    const where = stripTags(
      /<div class="gloss-where[^"]*"[^>]*>([\s\S]*?)<\/div\s*>/.exec(body)?.[1] ?? '',
    );

    if (!term) continue;
    entries.push({ term, category, definition, where, id });
  }

  return entries;
}

/** Normaliza la categoria para agrupar (la categoria viene en español). */
function categoryKey(category: string): string {
  const c = category.toLowerCase();
  if (c.includes('comando')) return 'comandos';
  if (c.includes('concepto')) return 'conceptos';
  if (c.includes('agente')) return 'agentes';
  if (c.includes('skill')) return 'skills';
  if (c.includes('dato')) return 'datos';
  if (c.includes('proceso')) return 'procesos';
  if (c.includes('herramienta') || c.includes('tool')) return 'herramientas';
  return c || 'otros';
}

/** Renderiza el glosario a Markdown. */
export function renderMarkdown(entries: GlossaryEntry[]): string {
  const groups = new Map<string, GlossaryEntry[]>();
  for (const entry of entries) {
    const key = categoryKey(entry.category);
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }

  const lines: string[] = [];
  lines.push('# Nomenclatura — GentleVanguard');
  lines.push('');
  lines.push(
    '> **Generado automáticamente** desde `docs/presentations/glossary.html` (la fuente unica).',
  );
  lines.push(
    '> No editar a mano: `npm run docs:glossary` regenera el documento y el gate de drift',
  );
  lines.push('> (`npm run docs:glossary:check`) falla si queda desactualizado.');
  lines.push('');
  lines.push(
    `> ${entries.length} términos. Para el guion de cada deck, ver \`decks/speech/\`; para las`,
  );
  lines.push('> preguntas que van a hacer, ver `docs/presentations/FAQ.md`.');
  lines.push('');
  lines.push('---');
  lines.push('');

  const order = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'es'));
  for (const key of order) {
    const list = (groups.get(key) ?? []).sort((a, b) =>
      a.term.localeCompare(b.term, 'es', { sensitivity: 'base' }),
    );
    lines.push(`## ${key.charAt(0).toUpperCase()}${key.slice(1)}`);
    lines.push('');
    lines.push('| Término | Definición | En el repo |');
    lines.push('| --- | --- | --- |');
    for (const entry of list) {
      lines.push(
        `| **${cell(entry.term)}** | ${cell(entry.definition)} | ${cell(entry.where)} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function defaultRoot(): string {
  return join(import.meta.dirname ?? '.', '..', '..');
}

export interface GlossaryExportResult {
  ok: boolean;
  count: number;
  path: string;
  drift: boolean;
}

export function exportGlossary(root: string, check: boolean): GlossaryExportResult {
  const htmlPath = join(root, 'docs', 'presentations', 'glossary.html');
  const outPath = join(root, 'docs', 'presentations', 'NOMENCLATURA.md');

  if (!existsSync(htmlPath)) {
    return { ok: false, count: 0, path: outPath, drift: false };
  }

  const entries = parseGlossary(readFileSync(htmlPath, 'utf8'));
  const markdown = renderMarkdown(entries);

  if (check) {
    const current = existsSync(outPath) ? readFileSync(outPath, 'utf-8') : '';
    return {
      ok: current.trim() === markdown.trim(),
      count: entries.length,
      path: outPath,
      drift: current.trim() !== markdown.trim(),
    };
  }

  writeFileSync(outPath, markdown, 'utf8');
  return { ok: true, count: entries.length, path: outPath, drift: false };
}

function main(): void {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const asJson = argv.includes('--json');
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 && argv[rootIdx + 1] ? argv[rootIdx + 1] : defaultRoot();

  const result = exportGlossary(root, check);

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (check) {
    if (result.drift) {
      console.error(
        `glossary-export -> DRIFT: ${result.path} esta desactualizado ` +
          `(${result.count} terminos en el HTML). Corre: npm run docs:glossary`,
      );
      process.exit(1);
    }
    console.log(`glossary-export -> al dia (${result.count} terminos)`);
  } else {
    console.log(
      `glossary-export -> ${result.path} escrito (${result.count} terminos, ${result.drift ? 'con drift' : 'ok'})`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
