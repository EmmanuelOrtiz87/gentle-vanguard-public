/**
 * format-check-hook.test.ts — el gate de formato tiene que morder.
 *
 * POR QUÉ EXISTE (2026-11-11)
 * -------------------------------------------------------------------------
 * `config/quality-gates.json` declaraba `pre-commit-format` con
 * `enforced: true` desde hacía meses y NADIE lo ejecutaba. Cuando se
 * cableó de verdad, el problema de fondo apareció: el repo tiene
 * `.prettierrc` pero cientos de archivos fuera de formato. Un gate que
 * exige "todo formateado" bloquearía todos los commits del owner; un gate
 * que no exige nada es un guardrail de mentira.
 *
 * La regla que sí es honesta: NO-REGRESIÓN.
 *
 *   · Archivo nuevo → tiene que salir formateado (bloquea).
 *   · Archivo que estaba formateado → no puede dejar de estarlo (bloquea).
 *   · Archivo que ya estaba fuera de formato → se informa, no bloquea.
 *   · Archivo que prettier ignora (.prettierignore) → no se le exige nada.
 *
 * Un gate que nunca falla no vale nada: estos tests verifican las cuatro
 * ramas con un doble de prettier (sin tocar el repo).
 *
 * CONTRATO DECLARADO: control `format-check:no-regression`
 * (config/declarations.json → controls[].contractTest).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFile, type StagedFile } from '../../src/hooks/format-check-hook.ts';

/** Doble de prettier: `clean` decide si un contenido está "formateado". */
function fakePrettier(
  clean: (content: string) => boolean,
  ignored: (path: string) => boolean = () => false,
) {
  return {
    getFileInfo: async (abs: string) => ({ ignored: ignored(abs), inferredParser: 'typescript' }),
    resolveConfig: async () => ({ singleQuote: true }),
    check: async (content: string) => clean(content),
  } as unknown as typeof import('prettier');
}

const root = '/repo';

test('un archivo nuevo sin formatear BLOQUEA', async () => {
  const file: StagedFile = { path: 'src/nuevo.ts', staged: 'sin formato', head: null };
  const verdict = await evaluateFile(
    file,
    fakePrettier(() => false),
    root,
  );
  assert.equal(verdict.status, 'violation');
  assert.match(verdict.reason ?? '', /nuevo/);
});

test('un archivo nuevo ya formateado PASA', async () => {
  const file: StagedFile = { path: 'src/nuevo.ts', staged: 'formateado', head: null };
  const verdict = await evaluateFile(
    file,
    fakePrettier(() => true),
    root,
  );
  assert.equal(verdict.status, 'ok');
});

test('un archivo que estaba formateado y dejó de estarlo BLOQUEA', async () => {
  const file: StagedFile = { path: 'src/quebrado.ts', staged: 'mal', head: 'bien' };
  const verdict = await evaluateFile(
    file,
    fakePrettier((c) => c === 'bien'),
    root,
  );
  assert.equal(verdict.status, 'violation');
  assert.match(verdict.reason ?? '', /dejó de estarlo/);
});

test('un archivo con deuda heredada de formato NO bloquea', async () => {
  const file: StagedFile = { path: 'src/viejo.ts', staged: 'mal', head: 'también mal' };
  const verdict = await evaluateFile(
    file,
    fakePrettier(() => false),
    root,
  );
  assert.equal(verdict.status, 'legacy');
});

test('un archivo que prettier ignora NO se exige formateado', async () => {
  const file: StagedFile = { path: 'docs/sessions/x.md', staged: 'sin formato', head: null };
  const verdict = await evaluateFile(
    file,
    fakePrettier(
      () => false,
      () => true,
    ),
    root,
  );
  assert.equal(verdict.status, 'ignored');
});
