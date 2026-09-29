#!/usr/bin/env node --import tsx
/**
 * qa-print-html.ts — Gate de calidad para HTML impreso → PDF.
 *
 * POR QUÉ EXISTE
 * Este agente no puede ver imágenes: no puede abrir un PDF ni mirar un PNG. Sin
 * esta herramienta, el layout de un documento impreso sólo se puede verificar de
 * dos maneras, y las dos fallan:
 *   1) Leyendo el código y suponiendo que está bien. Falla siempre.
 *   2) Mirando las alturas de cada bloque. Falla en todo lo que no sea alto.
 * Ese segundo hueco me costó dos sesiones enteras cuando un PDF salió SIN ESTILOS:
 * el navegador ignora en silencio una hoja de estilos que no resuelve, el PDF pesa
 * 400 KB en vez de 1,9 MB, y ni un alto de bloque se mueve. Este archivo convierte
 * esa clase de defecto invisible en un fallo de build.
 *
 * QUÉ CHEQUEA (todo numérico, sin imágenes)
 *   css       ¿Se aplicó la hoja de estilos? (el fallo silencioso por excelencia)
 *   vacia     Hojas de altura casi nula (típico de un split mal hecho)
 *   alto      Bloques que exceden el alto útil de la página → la página se corta
 *   ancho     Bloques que se salen del ancho imprimible → texto cortado lateral
 *   huerfano  Encabezado como último elemento de una hoja → queda Solo al pie
 *   contraste Texto bajo WCAG AA (4.5:1) → ilegible al imprimir
 *   tipografia Texto menor a 9pt → ilegible, sobre todo en material escolar
 *
 * USO
 *   node --import tsx src/tools/qa-print-html.ts --file <html> [--label "nombre"]
 *   node --import tsx src/tools/qa-print-html.ts --dir  <carpeta-con-html-y-pdf>
 *
 * Salida: exit 1 si hay algún defecto. Pensado para lefthook / CI.
 */
import { chromium } from 'playwright';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** A4 menos los márgenes de @page declarados en la hoja de estilo de la guía. */
const PAGE_MM = { width: 210, height: 297, marginTop: 16, marginBottom: 14, marginSide: 14 };
const USABLE_MM = {
  width: PAGE_MM.width - PAGE_MM.marginSide * 2,
  height: PAGE_MM.height - PAGE_MM.marginTop - PAGE_MM.marginBottom,
};
const MM_TO_PX = 96 / 25.4;
const MIN_FONT_PT = 9;
const MIN_CONTRAST = 4.5; // WCAG 2.2 AA para texto normal
const MIN_SHEET_MM = 12; // una hoja más chica que esto está vacía o es un remnant

type Severity = 'error' | 'warn';
interface Defect {
  check: string;
  severity: Severity;
  where: string;
  detail: string;
}

interface Args {
  file: string | null;
  dir: string | null;
  label: string | null;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
  };
  return { file: get('--file'), dir: get('--dir'), label: get('--label') };
}

/** Luminancia relativa WCAG 2.2. Devuelve el ratio de contraste, o null si no parsea. */
function contrastRatio(fg: string, bg: string): number | null {
  const parse = (c: string) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((v) => parseFloat(v));
    if (p.length < 3 || p.some(Number.isNaN)) return null;
    return { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a: p[3] ?? 1 };
  };
  const f = parse(fg);
  const b = parse(bg);
  if (!f || !b) return null;
  const white = { r: 1, g: 1, b: 1, a: 1 };
  const over = (t: { r: number; g: number; b: number; a: number }, u: typeof white) => ({
    r: t.r * t.a + u.r * (1 - t.a),
    g: t.g * t.a + u.g * (1 - t.a),
    b: t.b * t.a + u.b * (1 - t.a),
  });
  const top = f.a < 1 ? over(f, b) : f;
  const bot = b.a < 1 ? over(b, white) : b;
  const lum = (c: { r: number; g: number; b: number }) => {
    const ch = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  };
  const l1 = lum(top);
  const l2 = lum(bot);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Selector legible para el reporte. Tolera className de SVG (SVGAnimatedString). */
function sel(t: { tag: string; id?: string; cls?: unknown }): string {
  const raw = typeof t.cls === 'string' ? t.cls : '';
  const cls = raw.trim() ? `.${raw.trim().split(/\s+/).join('.')}` : '';
  return `${t.tag}${t.id ? `#${t.id}` : ''}${cls}`.slice(0, 70);
}
async function audit(htmlPath: string, label: string): Promise<Defect[]> {
  const defects: Defect[] = [];
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: Math.round(USABLE_MM.width * MM_TO_PX), height: Math.round(USABLE_MM.height * MM_TO_PX) },
  });
  await page.emulateMedia({ media: 'print' });
  const jsErrors: string[] = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
  await page.waitForTimeout(250);

  const report = await page.evaluate(
    ({ usableW }) => {
      const MM = 96 / 25.4;
      // Hojas: cualquier elemento que sea un contenedor de página.
      const sheets = Array.from(document.querySelectorAll<HTMLElement>('.sheet, .page'));
      const sheetsInfo = sheets.map((el, i) => {
        const r = el.getBoundingClientRect();
        return { index: i + 1, heightMm: r.height / MM, widthMm: r.width / MM, topMm: r.top / MM };
      });

      // Reglas de CSS realmente parseadas: si el HTML se assembla con el CSS
      // inlineado, debe haber cientos. Si no, el link no resolvió.
      let ruleCount = 0;
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          ruleCount += (sheet as CSSStyleSheet).cssRules.length;
        } catch {
          /* hoja cross-origin: no introspectable */
        }
      }
      const bodyFont = getComputedStyle(document.body).fontFamily;

      // ¿Algún grid con columnas declaradas que no se aplican?
      const brokenGrids = Array.from(document.querySelectorAll<HTMLElement>('.g2, .g3, .g4')).filter((el) => {
        const declared = el.classList.contains('g2') ? 2 : el.classList.contains('g3') ? 3 : 4;
        const applied = getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length;
        return applied > 0 && applied < declared;
      }).length;

      // ⚠ Sin funciones anidadas nombradas: esbuild inyecta un helper __name
      // que no existe en el contexto del navegador y revienta el evaluate.
      // Acá sólo se RECOLECTA data cruda; el análisis va en Node.
      const all: HTMLElement[] = Array.from(document.body.querySelectorAll<HTMLElement>('*'));

      // Blocks que se salen del ancho imprimible.
      // Sólo importan si CORTAN TEXTO: un <path> o un <rect> decorativo no se
      // "cortan", y la portada es full-bleed a propósito (@page :first margin 0).
      const wide: { tag: string; id: string; cls: string; overMm: number }[] = [];
      for (const el of all) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'svg' || el.closest('svg') !== null) continue;
        if (el.closest('.cover') !== null) continue;
        const hasText = Array.from(el.childNodes).some(
          (n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0,
        );
        if (!hasText) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const over = r.right / MM - usableW;
        if (over > 2) {
          wide.push({ tag, id: el.id, cls: typeof el.className === 'string' ? el.className : '', overMm: Math.round(over * 10) / 10 });
        }
      }

      // Encabezado huérfano: último hijo visible de la hoja y es un heading.
      const orphans: string[] = [];
      for (const sheet of sheets) {
        const kids = Array.from(sheet.querySelectorAll<HTMLElement>(':scope > * > *, :scope > *')).filter(
          (el) => el.getBoundingClientRect().height > 0,
        );
        const last = kids[kids.length - 1];
        if (last && /^H[1-6]$/.test(last.tagName)) orphans.push(last.textContent?.trim().slice(0, 40) ?? last.tagName);
      }

      // Tipografía y contraste: sólo elementos con nodo de texto propio.
      const seen = new Set<string>();
      const text: { tag: string; id: string; cls: string; pt: number; color: string; bg: string; skip: boolean; cover: boolean; label: boolean }[] = [];
      for (const el of all) {
        const own = Array.from(el.childNodes).some(
          (n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 1,
        );
        if (!own) continue;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') continue;
        if (el.closest('[hidden]')) continue;
        const key = el.tagName + el.id + el.className;
        if (seen.has(key)) continue;
        seen.add(key);
        // Fondo real: se sube la cadena componiendo ALFA sobre el primer ancestro
        // opaco, porque rgba(255,255,255,.04) sobre negro sigue siendo oscuro.
        // Si un ancestro tiene background-image (gradiente), el ratio no es
        // calculable de forma fiable: se marca unverifiable y se omite.
        let bg = '';
        let unverifiable = false;
        const stack: { c: string; a: number }[] = [];
        let node: HTMLElement | null = el;
        while (node) {
          const sN = getComputedStyle(node);
          if (sN.backgroundImage && sN.backgroundImage !== 'none') { unverifiable = true; break; }
          const c = sN.backgroundColor;
          const mBg = c ? c.match(/rgba?\(([^)]+)\)/) : null;
          let a = 0;
          if (mBg) {
            const parts = mBg[1].split(',');
            a = parseFloat((parts[3] ?? '1').trim());
            if (Number.isNaN(a)) a = 1;
          }
          if (a > 0) {
            stack.push({ c, a });
            if (a >= 0.999) break;
          }
          node = node.parentElement;
        }
        if (!unverifiable && stack.length) {
          let base = { r: 255, g: 255, b: 255 };
          for (let i = stack.length - 1; i >= 0; i--) {
            const m = stack[i].c.match(/rgba?\(([^)]+)\)/);
            if (!m) continue;
            const p = m[1].split(',').map((v) => parseFloat(v));
            const a = stack[i].a;
            base = { r: p[0] / 255 * a + base.r * (1 - a), g: p[1] / 255 * a + base.g * (1 - a), b: p[2] / 255 * a + base.b * (1 - a) };
          }
          bg = `rgb(${Math.round(base.r * 255)}, ${Math.round(base.g * 255)}, ${Math.round(base.b * 255)})`;
        }
        const isGradientText = s.webkitBackgroundClip === 'text' || s.backgroundClip === 'text';
        text.push({
          skip: unverifiable || isGradientText,
          cover: el.closest('.cover') !== null,
          label: s.textTransform === 'uppercase',
          tag: el.tagName.toLowerCase(),
          id: el.id,
          // Sin clase ni id el reporte dice sólo "span", que es inútil: se
          // agrega el padre para que el diagnóstico sea accionable.
          cls:
            (typeof el.className === 'string' && el.className.trim()) ||
            (el.parentElement
              ? `«en ${el.parentElement.tagName.toLowerCase()}${el.parentElement.className && typeof el.parentElement.className === 'string' ? '.' + el.parentElement.className.trim().split(/\s+/)[0] : ''}»`
              : ''),
          pt: Math.round(parseFloat(s.fontSize) * 0.75 * 10) / 10,
          color: s.color,
          bg,
        });
      }

      return {
        sheetCount: sheets.length,
        sheetsInfo,
        ruleCount,
        bodyFont,
        brokenGrids,
        wide: wide.slice(0, 8),
        orphans,
        text,
      };
    },
    { usableW: USABLE_MM.width },
  );

  // ── CHECKS ───────────────────────────────────────────────────────────────
  // css: el fallo silencioso. Un documento con hoja inlineada tiene cientos de
  // reglas; uno sin estilos parsea 0.
  if (report.ruleCount < 30) {
    defects.push({
      check: 'css',
      severity: 'error',
      where: label,
      detail: `Sólo ${report.ruleCount} reglas CSS parseadas. La hoja NO se aplicó: el PDF saldría sin estilos. Revisá que el CSS esté inlineado (<style>) y no en un <link> sin resolver.`,
    });
  }
  if (report.brokenGrids > 0) {
    defects.push({
      check: 'css',
      severity: 'error',
      where: label,
      detail: `${report.brokenGrids} grid(s) con columnas declaradas pero no aplicadas (display:gridLayout roto).`,
    });
  }
  if (/^(Times|serif)$/i.test(report.bodyFont.trim())) {
    defects.push({
      check: 'css',
      severity: 'warn',
      where: label,
      detail: `El body cae en la serif por defecto del navegador ("${report.bodyFont}"). Sospechoso de CSS no aplicado.`,
    });
  }

  // vacia
  for (const s of report.sheetsInfo) {
    if (s.heightMm < MIN_SHEET_MM) {
      defects.push({
        check: 'vacia',
        severity: 'error',
        where: `${label} · hoja ${s.index}`,
        detail: `Hoja de ${s.heightMm} mm: está vacía. Suele ser un split mal hecho (se partió una tabla por la mitad y quedaron <tr> huérfanos).`,
      });
    }
  }

  // alto
  for (const s of report.sheetsInfo) {
    if (s.heightMm > USABLE_MM.height + 2) {
      defects.push({
        check: 'alto',
        severity: 'error',
        where: `${label} · hoja ${s.index}`,
        detail: `${s.heightMm} mm > ${USABLE_MM.height} mm útiles: la página se corta. Partí la hoja o redujé el contenido.`,
      });
    }
  }

  // ancho
  for (const w of report.wide) {
    defects.push({
      check: 'ancho',
      severity: 'error',
      where: label,
      detail: `${sel(w)} se sale ${w.overMm} mm del ancho imprimible (${USABLE_MM.width} mm): texto cortado lateralmente.`,
    });
  }

  // huerfano
  for (const o of report.orphans) {
    defects.push({
      check: 'huerfano',
      severity: 'warn',
      where: label,
      detail: `Encabezado "${o}" es el último elemento de su hoja: queda solo al pie de la página. Mové el título junto a su contenido.`,
    });
  }

  // contraste (WCAG AA = 4.5:1) — se calcula en Node con los datos crudos.
  const lowContrast = report.text
    .filter((t) => !t.skip && t.bg && !t.cover)
    .map((t) => ({ t, ratio: contrastRatio(t.color, t.bg) }))
    .filter((x): x is { t: (typeof report.text)[number]; ratio: number } => x.ratio !== null && x.ratio < MIN_CONTRAST);
  const seenC = new Set<string>();
  for (const x of lowContrast) {
    const key = sel(x.t);
    if (seenC.has(key)) continue;
    seenC.add(key);
    defects.push({
      check: 'contraste',
      severity: 'warn',
      where: `${label} · ${key}`,
      detail: `contraste ${Math.round(x.ratio * 100) / 100}:1 (AA exige ${MIN_CONTRAST}:1). Texto ${x.t.color} sobre ${x.t.bg}: ilegible al imprimir.`,
    });
  }

  // tipografia: por debajo de 9pt no se lee en papel.
  const tiny = report.text.filter((t) => !t.skip && !t.cover && !t.label && t.pt < MIN_FONT_PT);
  const seenT = new Set<string>();
  for (const t of tiny) {
    const key = sel(t);
    if (seenT.has(key)) continue;
    seenT.add(key);
    defects.push({
      check: 'tipografia',
      severity: 'warn',
      where: `${label} · ${key}`,
      detail: `${t.pt} pt (mínimo ${MIN_FONT_PT} pt). Ilegible al imprimir.`,
    });
  }
  if (jsErrors.length) {
    defects.push({
      check: 'js',
      severity: 'error',
      where: label,
      detail: `Errores JS en la página: ${jsErrors.slice(0, 3).join(' | ')}`,
    });
  }

  await browser.close();
  return defects;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file && !args.dir) {
    console.error('Uso: --file <html> | --dir <carpeta>');
    process.exit(2);
  }

  const targets: { html: string; pdf: string | null; label: string }[] = [];
  if (args.file) {
    const html = resolve(args.file);
    if (!existsSync(html)) throw new Error(`No existe ${html}`);
    const pdf = html.replace(/\.html$/, '.pdf');
    targets.push({ html, pdf: existsSync(pdf) ? pdf : null, label: args.label ?? html.split(/[\\/]/).pop()! });
  } else {
    const dir = resolve(args.dir!);
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      if (f.isDirectory()) continue;
      if (extname(f.name) !== '.html') continue;
      const pdf = join(dir, f.name.replace(/\.html$/, '.pdf'));
      targets.push({ html: join(dir, f.name), pdf: existsSync(pdf) ? pdf : null, label: f.name.replace(/\.html$/, '') });
    }
  }
  if (targets.length === 0) throw new Error('No hay HTML que auditar.');

  const all: Defect[] = [];
  for (const t of targets) {
    const found = await audit(t.html, t.label);
    all.push(...found);
    const pdfInfo = t.pdf ? ` · PDF ${(statSync(t.pdf).size / 1024).toFixed(0)} KB` : ' · SIN PDF';
    const errs = found.filter((d) => d.severity === 'error').length;
    const warns = found.length - errs;
    console.log(`\n▸ ${t.label}${pdfInfo}`);
    console.log(`  ${errs === 0 ? '✔' : '✖'} ${errs} error(es), ${warns} advertencia(s)`);
  }

  if (all.length) {
    console.log('\n─── defectos ───');
    const byCheck = new Map<string, Defect[]>();
    for (const d of all) {
      if (!byCheck.has(d.check)) byCheck.set(d.check, []);
      byCheck.get(d.check)!.push(d);
    }
    for (const [check, list] of byCheck) {
      console.log(`\n[${check.toUpperCase()}] ${list.length}`);
      for (const d of list) {
        const icon = d.severity === 'error' ? '✖' : '⚠';
        console.log(`  ${icon} ${d.where}\n      ${d.detail}`);
      }
    }
  }

  const errors = all.filter((d) => d.severity === 'error').length;
  console.log('');
  if (errors) {
    console.log(`✖ QA falló: ${errors} error(es). No publicar el PDF así.`);
    process.exitCode = 1;
  } else if (all.length) {
    console.log(`✔ QA pasó sin errores (${all.length} advertencia(s) a revisar a ojo).`);
  } else {
    console.log('✔ QA limpio: ningún defecto encontrado.');
  }
}

main().catch((err: unknown) => {
  console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
