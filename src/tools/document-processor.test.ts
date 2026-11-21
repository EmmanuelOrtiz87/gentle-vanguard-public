import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runSync } from '../core/run-command.js';
import { cmdExtract, generateSummary } from './document-processor.js';

test('the literal preview preserves decimal punctuation and signals truncation', () => {
  const source = 'El pago de 12.5 EUR no se autorizó. Finalmente se canceló.';
  const preview = generateSummary(source, 35);
  assert.match(preview, /12\.5 EUR/);
  assert.ok(preview.endsWith('…'));
  assert.ok(source.startsWith(preview.slice(0, -1)));
});

test('OCR extracts a selected raster page and preserves its number', async (t) => {
  const imports = runSync('python', ['-c', 'import fitz, pypdf, rapidocr, onnxruntime'], {
    timeout: 15_000,
  });
  if (imports.status !== 0) {
    t.skip('Optional Python OCR engine not installed');
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), 'gv-ocr-test-'));
  const file = join(directory, 'scan.pdf');
  t.after(() => rmSync(file, { force: true }));
  const fixture = runSync(
    'python',
    [
      '-c',
      `import fitz, sys
src = fitz.open()
src.new_page().insert_text((75, 100), "The payment of 12.5 EUR is not authorized.", fontsize=22)
pdf = fitz.open()
pdf.new_page().insert_text((75, 100), "This page is outside the selection.")
page = pdf.new_page()
page.insert_image(page.rect, pixmap=src[0].get_pixmap(dpi=180))
pdf.save(sys.argv[1])`,
      file,
    ],
    { timeout: 15_000 },
  );
  assert.equal(fixture.status, 0, fixture.stderr);
  const result = await cmdExtract(file, { ocr: true, pages: [2] });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.match(result.text ?? '', /\[Página 2\]/);
  assert.match(result.text ?? '', /12\.5 EUR is not authorized/i);
  assert.doesNotMatch(result.text ?? '', /outside the selection/);
  assert.ok(result.warnings?.some((warning) => warning.includes('OCR en páginas 2')));
  assert.equal((await cmdExtract(file, { pages: [3] })).success, false);
});
