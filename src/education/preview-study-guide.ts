#!/usr/bin/env node --import tsx
/**
 * preview-study-guide.ts — Verificación visual y de maquetación de una guía de
 * estudio antes de entregar el PDF.
 *
 * Qué hace (dos checks que se complementan):
 *   1. OVERFLOW: mide cada hoja `.sheet` en media de impresión y compara con la
 *      altura útil de una A4 (297mm - márgenes de @page). Si una hoja excede, el
 *      contenido se va a cortar o a generar una página extra con un huérfano.
 *      Esto es el bug más común y más invisible de un HTML→PDF.
 *   2. SCREENSHOT: captura cada hoja a PNG para poder mirarla con los ojos.
 *
 * Por qué existe: `render-study-guide.ts` genera el PDF bien o mal según cómo
 * quede el layout. Nada en el pipeline detecta una tabla partida o una caja
 * huérfana. Este script es el gate.
 *
 * Uso:
 *   node --import tsx src/education/preview-study-guide.ts
 *   node --import tsx src/education/preview-study-guide.ts --guide tecnologia-1-secundaria --no-shots
 *   node --import tsx src/education/preview-study-guide.ts --only 3,7   # sólo esas hojas
 *
 * Salida:
 *   docs/educacion/<guide>/build/preview-<NN>.png
 *   exit 1 si hay overflow (para usarlo como gate en CI o lefthook)
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const guidesRoot = join(repoRoot, 'docs', 'educacion');

/** A4 menos los márgenes declarados en style.css (@page margin: 16mm 14mm 14mm 14mm). */
const A4_HEIGHT_MM = 297;
const PAGE_MARGIN_TOP_MM = 16;
const PAGE_MARGIN_BOTTOM_MM = 14;
const PAGE_MARGIN_SIDE_MM = 14;
const USABLE_HEIGHT_MM = A4_HEIGHT_MM - PAGE_MARGIN_TOP_MM - PAGE_MARGIN_BOTTOM_MM;
/** El viewport debe medir el ANCHO IMPRIMIBLE, no el de la hoja: si no, el texto
 *  se mide con más espacio del que tiene en el PDF y las alturas salen chicas. */
const USABLE_WIDTH_MM = 210 - PAGE_MARGIN_SIDE_MM * 2;
const MM_TO_PX = 96 / 25.4;

interface Args {
  guide: string;
  shots: boolean;
  only: Set<number> | null;
}

function parseArgs(argv: string[]): Args {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const guideIdx = argv.indexOf('--guide');
  const onlyIdx = argv.indexOf('--only');
  const onlyRaw = onlyIdx >= 0 ? argv[onlyIdx + 1] : '';
  return {
    guide: guideIdx >= 0 ? argv[guideIdx + 1] : 'tecnologia-1-secundaria',
    shots: !flags.has('--no-shots'),
    only: onlyRaw ? new Set(onlyRaw.split(',').map((n) => Number(n.trim()))) : null,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const guideDir = join(guidesRoot, args.guide);
  const name = args.guide.split(/[\\/]/).filter(Boolean).pop() ?? args.guide;
  const htmlPath = join(guideDir, `${name}.html`);
  if (!existsSync(htmlPath)) {
    throw new Error(
      `No existe ${htmlPath}. Generalo primero:\n  node --import tsx src/education/render-study-guide.ts --guide ${args.guide}`,
    );
  }
  const buildDir = join(guideDir, 'build');
  mkdirSync(buildDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: Math.round(USABLE_WIDTH_MM * MM_TO_PX), height: Math.round(A4_HEIGHT_MM * MM_TO_PX) },
    deviceScaleFactor: 1.5,
  });
  await page.emulateMedia({ media: 'print' });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });

  const report = await page.evaluate((limitMm) => {
    const MM = 96 / 25.4;
    const sheets = Array.from(document.querySelectorAll<HTMLElement>('.sheet'));
    return sheets.map((el, i) => {
      const heightMm = el.getBoundingClientRect().height / MM;
      // Primer heading visible de la hoja, para poder identificarla en el reporte.
      const head = el.querySelector('h1.chapter, h2, h3');
      return {
        index: i + 1,
        title: (head?.textContent ?? '(sin título)').replace(/\s+/g, ' ').trim().slice(0, 62),
        heightMm: Math.round(heightMm * 10) / 10,
        overflowMm: Math.round((heightMm - limitMm) * 10) / 10,
        overflows: heightMm > limitMm + 2, // 2mm de tolerancia por redondeo de subpíxeles
      };
    });
  }, USABLE_HEIGHT_MM);

  const overflowing = report.filter((r) => r.overflows);
  console.log(`\nGuía: ${args.guide}`);
  console.log(`Hojas: ${report.length} · alto útil A4: ${USABLE_HEIGHT_MM} mm · ancho útil: ${USABLE_WIDTH_MM} mm\n`);
  console.log('  #  alto(mm)  desv(mm)  hoja');
  for (const r of report) {
    const flag = r.overflows ? '  DESBORDA' : '';
    console.log(
      `  ${String(r.index).padStart(2)}  ${String(r.heightMm).padStart(7)}  ${String(r.overflowMm).padStart(7)}  ${r.title}${flag}`,
    );
  }

  if (args.shots) {
    const els = await page.locator('.sheet').all();
    for (let i = 0; i < els.length; i++) {
      const n = i + 1;
      if (args.only && !args.only.has(n)) continue;
      const out = join(buildDir, `preview-${String(n).padStart(2, '0')}.png`);
      await els[i].screenshot({ path: out });
      console.log(`  shot → ${out} (${(statSync(out).size / 1024).toFixed(0)} KB)`);
    }
  }

  await browser.close();

  console.log('');
  if (overflowing.length > 0) {
    console.log(`✖ ${overflowing.length} hoja(s) desbordan una página: ${overflowing.map((r) => `#${r.index}`).join(', ')}`);
    console.log('  Fix: partir el contenido en otra hoja .sheet, o achicar la tabla/caja que crece.');
    console.log(`  (build/ tiene ${readdirSync(buildDir).length} archivo(s))`);
    process.exitCode = 1;
  } else {
    console.log('✔ Ninguna hoja desborda. Layout sano.');
  }
}

main().catch((err: unknown) => {
  console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
