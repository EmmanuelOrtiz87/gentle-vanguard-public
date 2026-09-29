#!/usr/bin/env node --import tsx
/**
 * render-study-guide.ts — Genera el PDF imprimible de una guía de estudio a partir
 * de sus partes HTML + CSS.
 *
 * Por qué existe: el stack ya genera PDFs con el Edge que viene con Windows
 * (`--headless=new --print-to-pdf`), sin instalar dependencias nativas. Ver
 * `apps/academy-web/scripts/render-ebook-pdf.mjs` para el precedente.
 *
 * Por qué es TS y no .mjs: NORM-TS-001 (la lógica del stack va en TypeScript).
 *
 * Uso:
 *   node --import tsx src/education/render-study-guide.ts
 *   node --import tsx src/education/render-study-guide.ts --guide tecnologia-1-secundaria --open
 *
 * Salida:
 *   docs/educacion/<guide>/<guide>.html   (HTML assembled, kept as artifact)
 *   docs/educacion/<guide>/<guide>.pdf   (deliverable)
 *
 * Idempotente: se puede volver a correr tras editar cualquier parte.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const guidesRoot = join(repoRoot, 'docs', 'educacion');

interface Args {
  guide: string;
  open: boolean;
  edgeOverride: string | null;
}

function parseArgs(argv: string[]): Args {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const guideIdx = argv.findIndex((a) => a === '--guide');
  const edgeIdx = argv.findIndex((a) => a === '--edge');
  return {
    guide: guideIdx >= 0 ? argv[guideIdx + 1] : 'tecnologia-1-secundaria',
    open: flags.has('--open'),
    edgeOverride: edgeIdx >= 0 ? argv[edgeIdx + 1] : null,
  };
}

/** Resuelve msedge.exe. Requiere el flag --headless=new para --print-to-pdf. */
function findEdge(override: string | null): string {
  if (override) {
    if (!existsSync(override)) throw new Error(`--edge no apunta a un archivo existente: ${override}`);
    return override;
  }
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  try {
    const out = spawnSync('where.exe', ['msedge'], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const hit = (out.stdout || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.toLowerCase().endsWith('msedge.exe'));
    if (hit) return hit;
  } catch {
    /* best effort */
  }
  throw new Error(
    'No se encontró msedge.exe. Pasá la ruta con --edge "C:\\ruta\\msedge.exe"',
  );
}

/**
 * Concatena las partes en orden lexicográfico. El orden numérico del prefijo
 * (10-, 11-, 20-…) es el orden de lectura de la guía.
 *
 * El CSS se INLINEA y el documento completo lo arma ESTE archivo, no las partes.
 * Motivo: un `<link href="style.css">` relativo no resolvería (el HTML ensamblado
 * vive un nivel arriba que `src/`) y el PDF saldría SIN ESTILOS, en silencio,
 * porque el navegador no falla: simplemente ignora la hoja. Peor aún, si las
 * partes no traen `<head>`, un enfoque que dependa de él también falla en
 * silencio. Por eso el shell se construye acá y se valida al final.
 */
function assembleHtml(srcDir: string): string {
  const parts = readdirSync(srcDir)
    .filter((f) => f.endsWith('.html'))
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  if (parts.length === 0) throw new Error(`No hay partes .html en ${srcDir}`);

  // El CSS puede vivir en src/, en la carpeta del documento o en la raíz de la
  // guía (compartido entre documentos, p. ej. la guía y el cuaderno de prácticas).
  const cssCandidates = [
    join(srcDir, 'style.css'),
    join(dirname(srcDir), 'style.css'),
    join(dirname(dirname(srcDir)), 'style.css'),
  ];
  const cssPath = cssCandidates.find((p) => existsSync(p));
  if (!cssPath) {
    throw new Error(`No se encontró style.css. Busqué en:\n  ${cssCandidates.join('\n  ')}`);
  }
  const css = readFileSync(cssPath, 'utf8');
  const styleTag = `<style>\n${css}\n</style>`;

  // Cualquier link a hoja externa se descarta: el CSS va inlineado.
  const body = parts
    .map((p) => readFileSync(join(srcDir, p), 'utf8'))
    .join('\n\n')
    .replace(/<link[^>]+stylesheet[^>]*>\s*/gi, '');

  let html: string;
  if (/<!doctype\s+html|<html[\s>]/i.test(body)) {
    // Las partes ya traen un shell: se le inyecta el estilo en el <head>.
    html = /<head>/i.test(body)
      ? body.replace(/<head>/i, `<head>\n${styleTag}`)
      : body.replace(/<html[^>]*>/i, (m) => `${m}\n<head>\n${styleTag}\n</head>`);
  } else {
    // Las partes son sólo fragmentos: el shell lo arma este archivo.
    html = `<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n${styleTag}\n</head>\n<body>\n\n${body}\n\n</body>\n</html>\n`;
  }

  // Validaciones duras: el fallo por CSS ausente es invisible si no se chequea.
  if (/<link[^>]+stylesheet/i.test(html)) {
    throw new Error('Queda un <link rel="stylesheet"> sin resolver: el CSS no se aplicaría.');
  }
  if (!html.includes(styleTag)) {
    throw new Error('El CSS inlineado no quedó en el documento: el PDF saldría sin estilos.');
  }
  return html;
}

function htmlToPdf(edge: string, htmlPath: string, pdfPath: string): number {
  const url = 'file:///' + htmlPath.replace(/\\/g, '/');
  const out = spawnSync(
    edge,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-pdf-header-footer',
      '--virtual-time-budget=15000',
      `--print-to-pdf=${pdfPath}`,
      url,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 180_000 },
  );
  if (out.status !== 0) {
    const msg = (out.stderr || out.stdout || '').slice(-2000);
    throw new Error(`Edge falló (status ${out.status}): ${msg}`);
  }
  if (!existsSync(pdfPath)) throw new Error(`PDF no generado en ${pdfPath}`);
  const size = statSync(pdfPath).size;
  if (size < 4096) throw new Error(`PDF sospechosamente chico: ${size} bytes`);
  return size;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const guideDir = join(guidesRoot, args.guide);
  const srcDir = join(guideDir, 'src');
  if (!existsSync(srcDir)) {
    throw new Error(`No existe ${srcDir}. Guías disponibles: ${readdirSync(guidesRoot).join(', ')}`);
  }
  mkdirSync(guideDir, { recursive: true });

  // `--guide` puede ser un path relativo con subcarpeta (p. ej.
  // `tecnologia-1-secundaria/guia-estudio`); el nombre del archivo de salida es
  // sólo el último segmento, para no crear directorios ni rutas con separadores.
  const name = args.guide.split(/[\\/]/).filter(Boolean).pop() ?? args.guide;

  const html = assembleHtml(srcDir);
  const htmlPath = join(guideDir, `${name}.html`);
  writeFileSync(htmlPath, html, 'utf8');
  console.log(`→ HTML ensamblado: ${htmlPath} (${statSync(htmlPath).size} bytes)`);

  const pdfPath = join(guideDir, `${name}.pdf`);
  const edge = findEdge(args.edgeOverride);
  const size = htmlToPdf(edge, htmlPath, pdfPath);
  console.log(`✔ PDF: ${pdfPath} (${(size / 1024).toFixed(0)} KB) con ${edge}`);

  if (args.open) {
    spawnSync('cmd', ['/c', 'start', '', pdfPath], { windowsHide: true, stdio: 'ignore' });
  }
}

main();
