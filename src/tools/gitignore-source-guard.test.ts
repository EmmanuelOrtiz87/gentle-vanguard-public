/**
 * TEST NEGATIVO del guard de .gitignore.
 *
 * Reproduce el incidente real (2026-11-02): la regla `build/` del .gitignore
 * se comio `docs/presentations/decks/build/` completo y el toolkit de
 * presentaciones no viajo en el clon. El test arma ese mismo escenario y
 * exige que el gate lo detecte.
 *
 * Corre con:  node --import tsx --test src/tools/gitignore-source-guard.test.ts
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { checkIgnoredSource, defaultRoot, extractPaths, baseDirsForCommand } from './gitignore-source-guard.js';

const temps: string[] = [];

after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** Repo git real, minimo, con .gitignore. */
function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'gitignore-guard-'));
  temps.push(root);
  for (const [path, body] of Object.entries(files)) {
    const abs = join(root, path);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body, 'utf8');
  }
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}

describe('gitignore-source-guard', () => {
  it('extrae rutas de codigo sin confundir sufijos ni globs', () => {
    assert.deepEqual(extractPaths('tsx --test tests/*.test.ts'), []);
    assert.deepEqual(extractPaths('node --import tsx src/tools/foo.ts'), ['src/tools/foo.ts']);
    assert.deepEqual(extractPaths('node build/compile.js'), ['build/compile.js']);
  });

  it('DETECTA el codigo fuente tragado por una regla de .gitignore', () => {
    const root = makeRepo({
      'package.json': JSON.stringify({ name: 'x', scripts: { build: 'node build/compile.js' } }),
      '.gitignore': 'build/\n',
      'build/compile.js': 'console.log(1);\n',
    });
    execFileSync('git', ['add', 'package.json', '.gitignore'], { cwd: root });

    const report = checkIgnoredSource(root);
    assert.equal(report.ok, false, 'el gate deberia fallar');
    const finding = report.findings.find((f) => f.rule === 'gitignore/untracked-source');
    assert.ok(finding, 'esperaba gitignore/untracked-source');
    assert.match(finding!.message, /no viaja en el clon/);
  });

  it('acepta el mismo repo cuando la excepcion esta escrita', () => {
    const root = makeRepo({
      'package.json': JSON.stringify({ name: 'x', scripts: { build: 'node build/compile.js' } }),
      '.gitignore': 'build/\n!build/\n!build/**\n',
      'build/compile.js': 'console.log(1);\n',
    });
    execFileSync('git', ['add', '-f', 'package.json', '.gitignore', 'build/compile.js'], { cwd: root });

    const report = checkIgnoredSource(root);
    assert.equal(report.errors, 0, JSON.stringify(report.findings, null, 2));
  });

  it('DETECTA la referencia a un script inexistente', () => {
    const root = makeRepo({
      'package.json': JSON.stringify({ name: 'x', scripts: { build: 'node build/compile.js' } }),
      '.gitignore': 'node_modules/\n',
    });
    execFileSync('git', ['add', 'package.json', '.gitignore'], { cwd: root });

    const report = checkIgnoredSource(root);
    const finding = report.findings.find((f) => f.rule === 'gitignore/missing-reference');
    assert.ok(finding, 'esperaba gitignore/missing-reference');
    // Un script que apunta a un archivo inexistente es una capacidad que el
    // stack promete y no tiene: BLOQUEA (no es un aviso que se puede ignorar).
    assert.equal(finding!.severity, 'error');
    assert.equal(report.ok, false, 'el gate deberia fallar');
  });

  it('resuelve el archivo contra la raiz del runner (--root), no contra el package', () => {
    // Caso REAL del repo: `vitest run --root scripts lifecycle-lock.test.ts`.
    // El archivo vive en <pkg>/scripts/, no en <pkg>/. El gate lo reportaba
    // como inexistente: un falso positivo que hace que el gate se apague.
    const root = makeRepo({
      'package.json': JSON.stringify({
        name: 'x',
        scripts: { 'test:lifecycle': 'vitest run --root scripts lifecycle-lock.test.ts' },
      }),
      '.gitignore': 'node_modules/\n',
      'scripts/lifecycle-lock.test.ts': 'test("lock", () => {});\n',
    });
    execFileSync('git', ['add', 'package.json', '.gitignore', 'scripts/lifecycle-lock.test.ts'], { cwd: root });

    const report = checkIgnoredSource(root);
    const missing = report.findings.filter((f) => f.rule === 'gitignore/missing-reference');
    assert.equal(missing.length, 0, `falso positivo: ${JSON.stringify(missing, null, 2)}`);
  });

  it('SIGUE detectingo el archivo faltante aunque el comando use --root', () => {
    // El arreglo del falso positivo NO puede volver ciego al gate: si el
    // archivo no esta en NINGUNA base, tiene que seguir mordiendo.
    const root = makeRepo({
      'package.json': JSON.stringify({
        name: 'x',
        scripts: { 'test:lifecycle': 'vitest run --root scripts lifecycle-lock.test.ts' },
      }),
      '.gitignore': 'node_modules/\n',
      'scripts/otro.test.ts': 'test("otro", () => {});\n',
    });
    execFileSync('git', ['add', 'package.json', '.gitignore', 'scripts/otro.test.ts'], { cwd: root });

    const report = checkIgnoredSource(root);
    const finding = report.findings.find((f) => f.rule === 'gitignore/missing-reference');
    assert.ok(finding, 'el gate debe seguir detectando el archivo que no existe');
    assert.match(finding!.path, /lifecycle-lock\.test\.ts/);
    assert.equal(finding!.severity, 'error', 'un target inexistente debe BLOQUEAR');
  });

  it('la raiz del runner se agrega como base solo cuando el flag existe', () => {
    const pkgDir = join(tmpdir(), 'pkg');
    assert.deepEqual(baseDirsForCommand(pkgDir, 'node build/compile.js'), [pkgDir]);
    assert.deepEqual(baseDirsForCommand(pkgDir, 'vitest run --root . x.test.ts'), [pkgDir]);
    assert.deepEqual(baseDirsForCommand(pkgDir, 'vitest run --root scripts a.test.ts'), [
      pkgDir,
      join(pkgDir, 'scripts'),
    ]);
  });

  it('el repo real no tiene codigo tragado por el .gitignore', () => {
    const report = checkIgnoredSource(defaultRoot());
    assert.equal(
      report.errors,
      0,
      `el repo real tiene codigo sin versionar:\n${JSON.stringify(report.findings, null, 2)}`,
    );
  });

  it('el repo real no tiene scripts que apunten a un archivo inexistente', () => {
    // Deuda real que el gate encontro (2026-11-03): `apps/wpp-bot` tenia
    // `smoke:twilio` y `db:migrate` apuntando a archivos que nunca
    // existieron. Ningun script del repo puede prometer una capacidad que
    // no se puede ejecutar.
    const report = checkIgnoredSource(defaultRoot());
    const missing = report.findings.filter((f) => f.rule === 'gitignore/missing-reference');
    assert.equal(
      missing.length,
      0,
      `scripts con target inexistente:\n${JSON.stringify(missing, null, 2)}`,
    );
  });
});
