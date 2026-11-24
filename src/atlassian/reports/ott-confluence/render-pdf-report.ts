import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

export interface RenderOptions {
  htmlPath: string;
  pdfPath: string;
  label: string;
  dateLabel: string;
}

export async function renderPdf(opts: RenderOptions): Promise<{ pdfPath: string; bytes: number }> {
  const browser = await chromium.launch({
    headless: true,
    ...(process.platform === 'win32' ? { channel: 'msedge' as const } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1700 } });
    await page.goto(pathToFileURL(resolve(opts.htmlPath)).href, { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });
    await page.pdf({
      path: opts.pdfPath,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<table style="width:100%;font-size:7pt;color:#94A3B8;font-family:Segoe UI,sans-serif;margin:0 14mm">
    <tr><td>GentleVanguard · ${opts.label} · ${opts.dateLabel} · documento de trabajo</td>
    <td style="text-align:right">Página <span class="pageNumber"></span> de <span class="totalPages"></span></td></tr>
  </table>`,
      margin: { top: '13mm', bottom: '15mm', left: '14mm', right: '14mm' },
    });
  } finally {
    await browser.close();
  }
  return { pdfPath: opts.pdfPath, bytes: statSync(opts.pdfPath).size };
}
