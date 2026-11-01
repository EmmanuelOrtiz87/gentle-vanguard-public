/**
 * render-slides — verifica que el render determinista de slides produce
 * lo que dice producir.
 *
 * Comprueba sobre el carrusel de ejemplo del stack:
 *   1. el tool existe y se puede ejecutar,
 *   2. produce un PNG por cada `.slide` del HTML (10),
 *   3. cada PNG sale a 2x del lienzo pedido (2160x2700),
 *   4. genera el contact sheet (montage.png),
 *   5. falla con código 1 si el HTML no tiene slides (no renderiza en vacío).
 *
 * Uso: node --import tsx --test tests/smoke/render-slides.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const TOOL = resolve(ROOT, 'tools/render-slides.mjs');
const EXAMPLE = resolve(ROOT, 'apps/design-gallery/examples/carrusel-ejemplo.html');
const OUT = resolve(ROOT, '.runtime/render-slides-test');

const run = (args: string[]) =>
  execFileSync(process.execPath, [TOOL, ...args], { encoding: 'utf-8', timeout: 180_000 });

function pngSize(path: string): { width: number; height: number } {
  // Los PNG empiezan con la firma y el IHDR en los primeros 24 bytes.
  const buf = readFileSync(path);
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${path} no es un PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test('render-slides produce un PNG 2x por slide y el contact sheet', () => {
  rmSync(OUT, { recursive: true, force: true });
  const stdout = run([EXAMPLE, '--out', OUT, '--scale', '2']);

  assert.match(stdout, /10 slide\(s\) renderizadas/, 'debe reportar 10 slides');

  const files = readdirSync(OUT).filter((f) => f.endsWith('.png'));
  const slides = files.filter((f) => f.startsWith('slide-'));
  assert.equal(slides.length, 10, `deben salir 10 PNG de slide (salieron ${slides.length})`);
  assert.ok(files.includes('montage.png'), 'debe salir montage.png');

  // 1080x1350 a escala 2 = 2160x2700.
  const size = pngSize(resolve(OUT, 'slide-01.png'));
  assert.equal(size.width, 2160, `el ancho del PNG debe ser 2160 (fue ${size.width})`);
  assert.equal(size.height, 2700, `el alto del PNG debe ser 2700 (fue ${size.height})`);
});

test('render-slides falla con código 1 si no hay slides', () => {
  const empty = resolve(OUT, 'vacio.html');
  writeFileSync(empty, '<!doctype html><html><body><p>sin slides</p></body></html>', 'utf-8');
  assert.throws(
    () => run([empty, '--out', resolve(OUT, 'vacio-out')]),
    (error: NodeJS.ErrnoException & { status?: number }) => {
      assert.equal(error.status, 1, 'debe salir con código 1');
      assert.match(String(error.stderr), /No encontré slides/, 'debe decir por qué');
      return true;
    }
  );
});

test('el tool y el ejemplo existen', () => {
  assert.ok(existsSync(TOOL), 'tools/render-slides.mjs debe existir');
  assert.ok(existsSync(EXAMPLE), 'el carrusel de ejemplo debe existir');
});
