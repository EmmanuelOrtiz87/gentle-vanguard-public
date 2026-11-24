/**
 * Contrato del cache del composite pre-push (Fase 4 del ajuste del owner).
 *
 * El cache de 24 h tenía dos huecos que lo convertían en "verde.presentation":
 *   1. La clave NO incluía la DEFINICIÓN de los checks: agregar o cambiar un
 *      check no toca el árbol, así que el gate podía re-servir un verde que
 *      nunca corrió ese check (el check nuevo se anunciaba como verificado).
 *   2. La salida decía "Warm cache hit ... Skipping N checks" y salía con
 *      exit 0: el log del push se leía como un verde más, sin que nadie
 *      supiera que NO se había verificado nada.
 *
 * Estos tests muerden: si alguien vuelve a sacar la firma de los checks de la
 * clave o a cambiar el rótulo por un "cache hit" genérico, fallan.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { cacheHitBanner, checksSignature } from './prepush-gate.js';

const CHECK = {
  name: 'demo',
  command: 'node',
  args: ['--import', 'tsx', 'src/tools/demo.ts'],
  timeoutMs: 1000,
  description: 'check de demostración',
};

test('la firma de los checks cambia si se AGREGA un check', () => {
  const before = checksSignature([CHECK]);
  const after = checksSignature([CHECK, { ...CHECK, name: 'otro' }]);
  assert.notEqual(before, after);
});

test('la firma de los checks cambia si se MODIFICA el comando de un check', () => {
  const before = checksSignature([CHECK]);
  const after = checksSignature([{ ...CHECK, args: ['--import', 'tsx', 'src/tools/otro.ts'] }]);
  assert.notEqual(before, after);
});

test('la firma de los checks es estable si nada cambia', () => {
  assert.equal(checksSignature([CHECK]), checksSignature([CHECK]));
});

test('el rótulo del verde cacheado dice que NO se ejecutó ningún check', () => {
  const [banner, hint] = cacheHitBanner(44, '2026-11-24T02:00:00.000Z');
  assert.match(banner, /VERDE CACHEADO/);
  assert.match(banner, /44 checks NO se ejecutaron/);
  assert.match(banner, /2026-11-24T02:00:00.000Z/);
  assert.match(hint, /NO es una verificación nueva/);
  assert.match(hint, /--force/);
});
