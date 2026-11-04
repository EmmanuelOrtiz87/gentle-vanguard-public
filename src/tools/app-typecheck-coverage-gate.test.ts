/**
 * TEST NEGATIVO del gate de cobertura de typecheck.
 *
 * Reproduce el caso REAL (2026-11-03): `apps/wpp-bot` era la unica app del
 * stack cuyo script `typecheck` usaba `tsconfig.build.json`, que excluye
 * `tests/` y `scripts/`. El typecheck daba VERDE mientras la mitad de la app
 * no la verificaba nadie — 21 errores ocultos (incluido el tipo `LeadRow` del
 * export de leads, que no declaraba las columnas del JOIN).
 *
 * El test arma ese mismo escenario y exige que el gate lo detecte.
 *
 * Corre con:  node --import tsx --test src/tools/app-typecheck-coverage-gate.test.ts
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import {
  checkTypecheckCoverage,
  coveredDirs,
  defaultRoot,
  projectUsedBy,
} from './app-typecheck-coverage-gate.js';

const temps: string[] = [];

after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** Repo minimo con una app que tiene codigo en src/ y en tests/. */
function makeRepo(appPkg: Record<string, unknown>, appFiles: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'typecheck-coverage-'));
  temps.push(root);
  const appDir = join(root, 'apps', 'mi-app');
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, 'package.json'), JSON.stringify(appPkg), 'utf8');
  for (const [path, body] of Object.entries(appFiles)) {
    const abs = join(appDir, path);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body, 'utf8');
  }
  return root;
}

describe('app-typecheck-coverage-gate', () => {
  it('lee el proyecto que usa el comando typecheck', () => {
    assert.equal(projectUsedBy('tsc --noEmit'), null, 'sin -p usa el tsconfig de la app');
    assert.equal(projectUsedBy('tsc -p tsconfig.json --noEmit'), 'tsconfig.json');
    assert.equal(projectUsedBy('tsc --project tsconfig.build.json --noEmit'), 'tsconfig.build.json');
    assert.equal(projectUsedBy('tsc -p=tsconfig.build.json --noEmit'), 'tsconfig.build.json');
  });

  it('compara los includes como conjuntos de directorios', () => {
    assert.deepEqual([...coveredDirs(['src/**/*', 'tests/**/*'])], ['src', 'tests']);
    assert.deepEqual([...coveredDirs(['src'])], ['src']);
    assert.deepEqual([...coveredDirs(['**'])], ['*']);
    assert.deepEqual([...coveredDirs(undefined)], []);
  });

  it('DETECTA el typecheck parcial (el caso real de wpp-bot)', () => {
    const root = makeRepo(
      {
        name: 'mi-app',
        scripts: { typecheck: 'tsc -p tsconfig.build.json --noEmit' },
      },
      {
        'tsconfig.json': JSON.stringify({ include: ['src/**/*', 'tests/**/*', 'scripts/**/*'] }),
        'tsconfig.build.json': JSON.stringify({ include: ['src/**/*'] }),
        'src/index.ts': 'export const a = 1;\n',
        'tests/foo.test.ts': 'export const b = 2;\n',
        'scripts/run.ts': 'export const c = 3;\n',
      },
    );

    const report = checkTypecheckCoverage(root);
    assert.equal(report.ok, false, 'el gate deberia fallar');
    // El hallazgo mas fuerte: hay .ts en disco que el typecheck no verifica.
    const findings = report.findings.filter((f) => f.rule === 'typecheck/uncovered-code');
    assert.equal(findings.length, 2, JSON.stringify(report.findings, null, 2));
    assert.equal(findings[0].severity, 'error');
    const mensajes = findings.map((f) => f.message).join('\n');
    assert.match(mensajes, /tests/);
    assert.match(mensajes, /scripts/);
  });

  it('DETECTA la promesa de cobertura rota aunque el codigo aun no exista', () => {
    // El tsconfig de la app promete cubrir "tests/" y el derivado no.
    // Aunque tests/ todavia no tenga archivos, la cobertura ya se perdio.
    const root = makeRepo(
      {
        name: 'mi-app',
        scripts: { typecheck: 'tsc -p tsconfig.build.json --noEmit' },
      },
      {
        'tsconfig.json': JSON.stringify({ include: ['src/**/*', 'tests/**/*'] }),
        'tsconfig.build.json': JSON.stringify({ include: ['src/**/*'] }),
        'src/index.ts': 'export const a = 1;\n',
      },
    );

    const report = checkTypecheckCoverage(root);
    assert.equal(report.ok, false, 'el gate deberia fallar');
    const finding = report.findings.find((f) => f.rule === 'typecheck/partial-coverage');
    assert.ok(finding, `esperaba typecheck/partial-coverage, vino: ${JSON.stringify(report.findings)}`);
    assert.match(finding!.message, /tests/);
  });

  it('DETECTA el codigo que el tsconfig usado deja sin verificar', () => {
    const root = makeRepo(
      {
        name: 'mi-app',
        scripts: { typecheck: 'tsc -p tsconfig.build.json --noEmit' },
      },
      {
        'tsconfig.json': JSON.stringify({ include: ['src/**/*'] }),
        'tsconfig.build.json': JSON.stringify({ include: ['src/**/*'] }),
        'src/index.ts': 'export const a = 1;\n',
        'scripts/run.ts': 'export const c = 3;\n',
      },
    );

    const report = checkTypecheckCoverage(root);
    assert.equal(report.ok, false, 'el gate deberia fallar');
    const finding = report.findings.find((f) => f.rule === 'typecheck/uncovered-code');
    assert.ok(finding, `esperaba typecheck/uncovered-code, vino: ${JSON.stringify(report.findings)}`);
    assert.match(finding!.message, /scripts/);
  });

  it('acepta el typecheck que usa el tsconfig de la app', () => {
    const root = makeRepo(
      {
        name: 'mi-app',
        scripts: { typecheck: 'tsc --noEmit' },
      },
      {
        'tsconfig.json': JSON.stringify({ include: ['src/**/*', 'tests/**/*'] }),
        'src/index.ts': 'export const a = 1;\n',
        'tests/foo.test.ts': 'export const b = 2;\n',
      },
    );

    const report = checkTypecheckCoverage(root);
    assert.equal(report.ok, true, JSON.stringify(report.findings, null, 2));
    assert.equal(report.errors, 0);
  });

  it('acepta un tsconfig derivado que NO restringe el include', () => {
    // `extends` sin `include` propio: hereda la cobertura del base.
    const root = makeRepo(
      {
        name: 'mi-app',
        scripts: { typecheck: 'tsc -p tsconfig.build.json --noEmit' },
      },
      {
        'tsconfig.json': JSON.stringify({ include: ['src/**/*', 'tests/**/*'] }),
        'tsconfig.build.json': JSON.stringify({ extends: './tsconfig.json' }),
        'src/index.ts': 'export const a = 1;\n',
        'tests/foo.test.ts': 'export const b = 2;\n',
      },
    );

    const report = checkTypecheckCoverage(root);
    assert.equal(report.ok, true, JSON.stringify(report.findings, null, 2));
  });

  it('no se queja por excluir node_modules/dist/coverage', () => {
    const root = makeRepo(
      {
        name: 'mi-app',
        scripts: { typecheck: 'tsc --noEmit' },
      },
      {
        'tsconfig.json': JSON.stringify({
          include: ['src/**/*'],
          exclude: ['node_modules', 'dist', 'coverage'],
        }),
        'src/index.ts': 'export const a = 1;\n',
      },
    );

    const report = checkTypecheckCoverage(root);
    assert.equal(report.warnings, 0, JSON.stringify(report.findings, null, 2));
  });

  it('el repo real: el typecheck de cada app cubre todo su codigo', () => {
    const report = checkTypecheckCoverage(defaultRoot());
    assert.equal(
      report.errors,
      0,
      `hay apps que verifican solo una parte de su codigo:\n${JSON.stringify(report.findings, null, 2)}`,
    );
  });
});
