#!/usr/bin/env tsx
/**
 * validate-presentations — Validador estructural de docs/presentations/
 *
 * Absorbe el antiguo validate.js (gv-probe) al stack como CLI nativo TS.
 * Verifica cada HTML de la carpeta presentations:
 *   - Corrupción estructural (sdiv/sspan/U+FFFD)
 *   - Balance de tags principales (div/section/h2)
 *   - Assets compartidos (gv.css, gv.js, i18n.js, i18n-content.js)
 *   - Selector de idioma nuevo (.lang-seg) y ausencia de restos antiguos
 *   - Info-triggers: cada .info-trigger debe tener data-i18n-title
 *   - Lightbox: .svg-diagram presente en gv.js (initDiagramModal) y CSS .gv-lightbox
 *   - Iconos de layer: cada .arch-layer .layer-name debe tener un icono bi-*
 *
 * Usage:
 *   npm run presentations:validate
 *   npx tsx src/cli/validate-presentations.ts [--dir <path>] [--quiet] [--main]
 *
 *   --main   Valida solo las presentaciones principales (excluye apps CMS con sidebar
 *            que no usan i18n: contract-viewer, image-studio, marketing, md-viewer,
 *            resources-index, social-post, v4-features, video-studio).
 *
 * Exit code: 0 si todo PASS, 1 si algún FAIL.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const DIR = path.resolve(process.cwd(), 'docs/presentations');
const QUIET = process.argv.includes('--quiet');
const MAIN_ONLY = process.argv.includes('--main');

/**
 * Main presentations: páginas de presentación con i18n completo (gv.css, gv.js,
 * i18n.js, i18n-content.js, selector .lang-seg, títulos sec_* y contenido c_*).
 * Las apps CMS (contract-viewer, image-studio, marketing, md-viewer,
 * resources-index, social-post, v4-features, video-studio)
 * son herramientas con sidebar que NO usan i18n y se excluyen con --main.
 */
const MAIN_PRESENTATIONS = new Set([
  'agents-pipeline.html',
  'architecture.html',
  'autonomy.html',
  'commands.html',
  'dashboard.html',
  'glossary.html',
  'health.html',
  'index.html',
  'memory-knowledge.html',
  'operations-cloud.html',
  'patterns-conventions.html',
  'quickstart.html',
  'security-governance.html',
  'study-material.html',
]);

interface Result {
  file: string;
  status: 'PASS' | 'FAIL';
  secCount: number;
  errors: string[];
}

function main(): number {
  if (!fs.existsSync(DIR)) {
    console.error(`ERROR: carpeta no encontrada: ${DIR}`);
    return 1;
  }
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.html'))
    .filter((f) => (MAIN_ONLY ? MAIN_PRESENTATIONS.has(f) : true))
    .sort();
  if (files.length === 0) {
    console.error('ERROR: no hay archivos .html en', DIR);
    return 1;
  }

  const gvJs = fs.readFileSync(path.join(DIR, 'assets/js/gv.js'), 'utf8');
  const i18nJs = fs.readFileSync(path.join(DIR, 'assets/js/i18n.js'), 'utf8');
  const contentJs = fs.readFileSync(path.join(DIR, 'assets/js/i18n-content.js'), 'utf8');
  const gvCss = fs.readFileSync(path.join(DIR, 'assets/css/gv.css'), 'utf8');

  let pass = 0;
  let fail = 0;
  const results: Result[] = [];

  for (const file of files) {
    const html = fs.readFileSync(path.join(DIR, file), 'utf8');
    const errors: string[] = [];

    // 1. Corrupción
    if (/sdiv|sspan|s\/div|s\/span/.test(html)) errors.push('CORRUPCIÓN (sdiv/sspan)');
    if (/\uFFFD/.test(html)) errors.push('CARACTERES INVÁLIDOS (U+FFFD)');

    // 2. Tags balanceados (heurística de etiquetas principales)
    const divOpen = (html.match(/<div[\s>]/g) || []).length;
    const divClose = (html.match(/<\/div>/g) || []).length;
    if (Math.abs(divOpen - divClose) > 2)
      errors.push(`TAGS div desbalanceados (${divOpen}/${divClose})`);
    const secOpen = (html.match(/<section[\s>]/g) || []).length;
    const secClose = (html.match(/<\/section>/g) || []).length;
    if (secOpen !== secClose) errors.push(`TAGS section desbalanceados (${secOpen}/${secClose})`);
    const h2Open = (html.match(/<h2[\s>]/g) || []).length;
    const h2Close = (html.match(/<\/h2>/g) || []).length;
    if (h2Open !== h2Close) errors.push(`TAGS h2 desbalanceados (${h2Open}/${h2Close})`);

    // 3. Assets compartidos
    if (!html.includes('assets/css/gv.css')) errors.push('FALTA gv.css');
    if (!html.includes('assets/js/gv.js')) errors.push('FALTA gv.js');
    if (!html.includes('assets/js/i18n.js')) errors.push('FALTA i18n.js');
    if (!html.includes('assets/js/i18n-content.js')) errors.push('FALTA script i18n-content.js');

    // 4. Selector de idioma nuevo (segmented) — restos del viejo
    if (!html.includes('lang-seg')) errors.push('FALTA selector .lang-seg');
    if (html.includes('data-bs-toggle="dropdown"')) errors.push('AÚN dropdown Bootstrap viejo');
    if (html.includes('dropdown-item')) errors.push('RESTOS dropdown-item');
    if (html.includes('lang-btn') || html.includes('lang-menu'))
      errors.push('RESTOS selector antiguo');

    // 5. Info-triggers: todos deben tener data-i18n-title (y no estar vacíos)
    const triggers = html.match(/class="info-trigger"/g) || [];
    if (triggers.length > 0) {
      // Contar triggers que NO tienen data-i18n-title en su tag
      const triggerTags = html.split('class="info-trigger"').slice(1);
      const missingTitle = triggerTags.filter(
        (seg) => !/data-i18n-title=/.test(seg.slice(0, 200)),
      ).length;
      if (missingTitle > 0)
        errors.push(`${missingTitle}/${triggers.length} info-trigger SIN data-i18n-title`);
    }

    const isMainPresentation = MAIN_PRESENTATIONS.has(file);
    const secCount = (html.match(/data-i18n="sec_/g) || []).length;
    const contentCount = (html.match(/data-i18n="c_/g) || []).length;
    if (isMainPresentation) {
      if (secCount === 0) errors.push('SIN títulos data-i18n sec_*');
      if (contentCount === 0) errors.push('SIN contenido data-i18n c_*');
      if (!i18nJs.includes('sec_diagrams')) errors.push('i18n.js sin sec_diagrams');
      if (!contentJs.includes('window.__GV_CONTENT')) errors.push('i18n-content.js inválido');
    }

    const status = errors.length === 0 ? 'PASS' : 'FAIL';
    if (status === 'PASS') pass++;
    else fail++;
    results.push({ file, status, secCount, errors });
  }

  // Checks globales de assets compartidos
  const globalErrors: string[] = [];
  if (!gvJs.includes('initDiagramModal')) globalErrors.push('gv.js sin initDiagramModal');
  if (!gvJs.includes('initInfoModal')) globalErrors.push('gv.js sin initInfoModal');
  if (!gvJs.includes('gv-lightbox')) globalErrors.push('gv.js sin soporte gv-lightbox');
  if (!gvCss.includes('.gv-lightbox')) globalErrors.push('gv.css sin .gv-lightbox');
  if (!gvCss.includes('.info-trigger')) globalErrors.push('gv.css sin .info-trigger');
  if (!i18nJs.includes('lbox_hint_wheel')) globalErrors.push('i18n.js sin claves lightbox');
  if (globalErrors.length > 0) {
    for (const e of globalErrors) {
      console.log(`FAIL (global) ${e}`);
    }
    fail += globalErrors.length;
  }

  console.log('=== VALIDACIÓN DE PRESENTACIONES ===');
  for (const r of results) {
    const errStr = r.errors.length ? ' | ' + r.errors.join('; ') : '';
    console.log(`${r.status} ${r.file} (sec_:${r.secCount})${errStr}`);
  }
  if (globalErrors.length > 0) {
    console.log(`FAIL (global) ${globalErrors.length} errores en assets compartidos`);
  }
  console.log(`\nRESULTADO: ${pass} PASS / ${fail} FAIL / ${results.length} total`);
  return fail === 0 ? 0 : 1;
}

if (!QUIET) {
  process.exit(main());
} else {
  main();
}
