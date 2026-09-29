import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

/**
 * Invariante de arquitectura: todo HTML que se imprime a PDF en el stack debe
 * llevar su CSS INLINEADO, nunca linkeado.
 *
 * Por qué es invariante y no recomendación: un `<link rel="stylesheet">` que no
 * resuelve NO da error. El navegador ignora la hoja y el PDF sale sin estilos, en
 * silencio. Pasó dos veces en docs/educacion y costó dos sesiones de diagnóstico
 * cada vez: el síntoma era un PDF de 400 KB en vez de ~1,9 MB, y alturas de hoja
 * que no cambiaban al editar CSS.
 *
 * El riesgo es real para cualquier generador que escriba su HTML en un directorio
 * distinto al de sus assets: la ruta relativa deja de resolver.
 */

const CODE_EXT = new Set(['.ts', '.mjs', '.js', '.cjs']);
const SKIP = /node_modules|[\\/]dist[\\/]|[\\/]\.runtime[\\/]|[\\/]build[\\/]|[\\/]\.git[\\/]|[\\/]dist-[^\\/]*[\\/]/;
const PRINT_MARKER = /print-to-pdf|page\.pdf\(/;
const LINK_MARKER = /<link[^>]+stylesheet/i;
/**
 * Líneas donde un `<link rel="stylesheet">` NO es una violación: la propia guarda
 * que lo detecta o elimina (regex, `replace`, `throw`, `assert`, comentario).
 * Un generador que BORRA y valida el link es lo contrario de violar la invariante.
 */
const GUARD_CONTEXT = /throw |replace\(|RegExp|\.test\(|assert|^\s*(\/\/|\*|\/\*)/;

export interface Violation {
  file: string;
  line: number;
  text: string;
}

export interface GeneratorFinding {
  file: string;
  links: Violation[];
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (SKIP.test(full)) continue;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (CODE_EXT.has(extname(name))) out.push(full);
  }
  return out;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/** Analiza un archivo: ¿genera PDF? ¿puede emitir una hoja linkeada? */
export function analyzeFile(absPath: string, root: string): GeneratorFinding | null {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
  if (!PRINT_MARKER.test(text)) return null;

  const lines = text.split('\n');
  const links: Violation[] = [];
  const re = new RegExp(LINK_MARKER.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const line = lineOf(text, m.index);
    if (GUARD_CONTEXT.test(lines[line - 1] ?? '')) continue;
    links.push({ file: absPath, line, text: lines[line - 1].trim().slice(0, 120) });
  }
  return { file: relative(root, absPath), links };
}

/** Devuelve SÓLO los generadores con violaciones. */
export function detectPrintHtmlViolations(roots: string[], root = process.cwd()): GeneratorFinding[] {
  const files = roots.flatMap((d) => walk(d));
  const out: GeneratorFinding[] = [];
  for (const f of files) {
    const finding = analyzeFile(f, root);
    if (finding && finding.links.length > 0) out.push(finding);
  }
  return out;
}

/** Todos los generadores encontrados, con o sin violación. */
export function findPrintGenerators(roots: string[], root = process.cwd()): GeneratorFinding[] {
  const files = roots.flatMap((d) => walk(d));
  const out: GeneratorFinding[] = [];
  for (const f of files) {
    const finding = analyzeFile(f, root);
    if (finding) out.push(finding);
  }
  return out;
}
