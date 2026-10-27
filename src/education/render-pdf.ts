/** Text package PDF export using the bundled document runtime. Does not render DOCX. */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { educationPrintHtml } from './print.js';
import type { EducationPackage } from './service.js';

const [input, directory] = process.argv.slice(2);
const packages = process.env.GV_DOCUMENT_PACKAGES;
if (!input || !directory || !packages) throw new Error('Uso: GV_DOCUMENT_PACKAGES=<runtime> node --import tsx src/education/render-pdf.ts paquete.json carpeta-nueva');
const p: EducationPackage = JSON.parse(readFileSync(input, 'utf8'));
const documents = [
  ['guia-docente', educationPrintHtml(p, 'teacher')],
  ['material-alumno', educationPrintHtml(p, 'student')],
] as const;
const out = resolve(directory);
if (existsSync(out)) throw new Error('La carpeta de salida debe ser nueva para preservar entregas existentes.');
const require = createRequire(resolve(packages, '_education-runtime.cjs'));
const { chromium } = require('playwright');
// Windows already provides Edge; avoid requiring a second browser download.
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  mkdirSync(out, { recursive: true });
  const page = await browser.newPage();
  for (const [name, html] of documents) {
    writeFileSync(resolve(out, `${name}.html`), html);
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({ path: resolve(out, `${name}.pdf`), format: 'A4', printBackground: true, preferCSSPageSize: true });
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ out, notice: 'PDF de texto generado. Renderizar e inspeccionar todas las páginas; el estado de revisión está dentro del documento.' }));
