#!/usr/bin/env node
/**
 * Property-based Tests: passive path classification (contrato pasivo-delta #5638).
 * Las propiedades vienen del REQUISITO: un delta que solo toca rutas pasivas
 * (docs/, .session/, knowledge-base/, o cualquier *.md) es terminal. Un falso
 * negativo dispararía re-review sin causa; un falso positivo la evitaría sin
 * revisar código — ambas roturas son graves, por eso las propiedades.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { isPassiveOnly, isPassivePath } from '../../src/review/reviewed-boundary.js';

const segment = fc
  .string({ minLength: 1, maxLength: 8 })
  .filter((s) => /^[a-z0-9_.-]+$/i.test(s) && s !== 'docs' && s !== 'knowledge-base');

/** paths sin ninguna ruta pasiva: prefijo arbitrario que no sea docs/.session/knowledge-base */
const neutralPathArb: fc.Arbitrary<string> = fc
  .tuple(fc.array(segment, { minLength: 1, maxLength: 4 }), segment)
  .map(([dirs, file]) => [...dirs, file].join('/'))
  .filter((p) => !/(^|\/)(docs|\.session|knowledge-base)\//.test(p) && !/\.md$/i.test(p));

const passiveDirPathArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.option(fc.array(segment, { maxLength: 2 }), { nil: undefined }),
    fc.constantFrom('docs', '.session', 'knowledge-base'),
    fc.array(segment, { minLength: 1, maxLength: 3 }),
  )
  .map(([prefix, passiveDir, rest]) => [...(prefix ?? []), passiveDir, ...rest].join('/'));

const mdPathArb: fc.Arbitrary<string> = fc
  .tuple(fc.array(segment, { minLength: 0, maxLength: 4 }), segment)
  .map(([dirs, file]) => [...dirs, `${file}.MD`].join('/'));

test('propiedad: cualquier ruta dentro de docs/.session/knowledge-base es pasiva', () => {
  fc.assert(
    fc.property(passiveDirPathArb, (p) => assert.ok(isPassivePath(p))),
    { numRuns: 300 },
  );
});

test('propiedad: cualquier *.md es pasiva sin importar mayúsculas ni profundidad', () => {
  fc.assert(
    fc.property(mdPathArb, (p) => assert.ok(isPassivePath(p))),
    { numRuns: 300 },
  );
});

test('propiedad: código fuera de rutas pasivas no es pasivo (falso positivo grave)', () => {
  fc.assert(
    fc.property(neutralPathArb, (p) => assert.ok(!isPassivePath(p))),
    { numRuns: 300 },
  );
});

test('propiedad: lista con UNA sola ruta activa deja de ser passive-only', () => {
  fc.assert(
    fc.property(
      fc.array(passiveDirPathArb, { minLength: 1, maxLength: 5 }),
      neutralPathArb,
      (passives, active) => {
        assert.ok(isPassiveOnly(passives));
        assert.ok(!isPassiveOnly([...passives, active]));
      },
    ),
    { numRuns: 200 },
  );
});

test('propiedad: lista vacía nunca es passive-only (exige al menos una ruta)', () => {
  assert.equal(isPassiveOnly([]), false);
});

test('casos límite fijados: mydocs/ no es docs/ (anclas de la regex)', () => {
  assert.ok(!isPassivePath('mydocs/x.ts'), 'mydocs no debe matchear ^docs/');
  assert.ok(isPassivePath('src/docs/a.ts'), 'docs/ precedido de / sí matchea');
  assert.ok(!isPassivePath('src/a.mdx'), '.md$ no matchea .mdx');
});
