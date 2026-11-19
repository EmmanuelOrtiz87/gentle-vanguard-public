/**
 * fix-relative-imports.test.ts — regresión del codemod de imports relativos ESM.
 *
 * Cubre los dos defectos que aparecieron al aplicarlo:
 *  1. el dedupe por spec descartaba la 2ª+ ocurrencia del mismo modulo en un
 *     archivo (el caso real: `export type {...} from './x'` + `export {...} from './x'`);
 *  2. los ejemplos de los doc-comments se reescribian como si fueran codigo.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { planFile, resolveRelative } from '../../src/tools/fix-relative-imports.js';

const FILE = 'src/ejemplo/index.ts';

function fakeExists(files: string[]): (p: string) => boolean {
  // El codemod siempre consulta rutas ABSOLUTAS (resolve del spec contra el
  // dir del archivo), asi que el set fake se normaliza igual.
  const set = new Set(files.map((f) => resolve(f).replace(/\\/g, '/')));
  return (p: string) => set.has(resolve(p).replace(/\\/g, '/'));
}

describe('fix-relative-imports', () => {
  it('agrega la extension .js al spec relativo que resuelve en disco', () => {
    const exists = fakeExists(['src/ejemplo/repo.ts']);
    const { fixes, next } = planFile(FILE, "import { root } from './repo';\n", exists);
    assert.equal(fixes.length, 1);
    assert.equal(fixes[0].to, './repo.js');
    assert.ok(next.includes("from './repo.js'"));
  });

  it('reescribe TODAS las ocurrencias del mismo spec en el archivo', () => {
    const exists = fakeExists(['src/ejemplo/repo.ts']);
    const source = [
      "export type { A } from './repo';",
      "export { B } from './repo';",
      "import { C } from './repo';",
    ].join('\n');
    const { fixes, next } = planFile(FILE, source, exists);
    assert.equal(fixes.length, 3, 'debe corregir cada ocurrencia, no solo la primera');
    assert.equal(next.match(/\.\/repo\.js/g)?.length, 3);
  });

  it('no toca los ejemplos de los doc-comments', () => {
    const exists = fakeExists(['src/ejemplo/repo.ts']);
    const source = [
      '/**',
      " *   import { root } from './repo';",
      ' */',
      "import { root } from './repo';",
    ].join('\n');
    const { fixes, unresolved, next } = planFile(FILE, source, exists);
    assert.equal(fixes.length, 1, 'solo el import real');
    assert.equal(unresolved.length, 0, 'el ejemplo del comentario no es deuda');
    assert.ok(next.includes(" *   import { root } from './repo';"));
  });

  it('reporta como sin resolver lo que no existe en disco (no inventa destinos)', () => {
    const exists = fakeExists([]);
    const { fixes, unresolved } = planFile(FILE, "import { x } from './no-existe';\n", exists);
    assert.equal(fixes.length, 0);
    assert.equal(unresolved.length, 1);
    assert.equal(unresolved[0].spec, './no-existe');
  });

  it('respeta los specs que ya traen extension', () => {
    const exists = fakeExists(['src/ejemplo/repo.ts']);
    const { fixes, next } = planFile(FILE, "import { root } from './repo.js';\n", exists);
    assert.equal(fixes.length, 0);
    assert.equal(next, "import { root } from './repo.js';\n");
  });

  it('resuelve un directorio con index.ts a /index.js', () => {
    const exists = fakeExists(['src/ejemplo/feature/index.ts']);
    const resolved = resolveRelative('src/ejemplo', './feature', exists);
    assert.ok(resolved);
    assert.equal(resolved.suffix, '/index.js');
  });

  it('no toca los paquetes (directorio con package.json)', () => {
    const exists = fakeExists(['src/ejemplo/pkg/package.json']);
    const resolved = resolveRelative('src/ejemplo', './pkg', exists);
    assert.equal(resolved, null);
  });
});
