/**
 * runtime-retention-notify.test.ts — el aviso de retención llega una vez, no
 * en cada ciclo.
 *
 * Control declarado en `config/declarations.json`: runtime-retention:notify
 *
 * POR QUÉ EXISTE (2026-11-11)
 * -------------------------------------------------------------------------
 * El owner pidió: _"si esto genera problemas, notificar para que la decisión
 * la tome él"_. Con la política sola eso no pasa: el gate del pre-push imprime
 * escalaciones, pero el owner no hace push todos los días y un aviso repetido
 * con el mismo contenido es ruido (y ruido es lo contrario de notificar).
 *
 * Estos tests fijan el contrato del aviso:
 *
 *   N1 · Sin escalaciones y sin estado previo → no se avisa (nada que decidir).
 *   N2 · Escalaciones nuevas → se avisa (warning).
 *   N3 · El MISMO set en el ciclo siguiente → NO se avisa (ya avisado).
 *   N4 · Escalaciones resueltas → se avisa (info: se resolvió).
 *   N5 · El aviso lleva la recomendación y el detalle de las escalaciones.
 *   N6 · `autoApply` decide si el barrido borra: por defecto simula.
 *   N7 · El estado queda escrito para que el próximo ciclo pueda comparar.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  decideNotification,
  escalationFingerprint,
  runRetentionNotification,
  type EscalationState,
} from '../../src/ops/runtime-retention-notify.ts';
import type { RetentionPolicy } from '../../src/ops/runtime-retention.ts';

const roots: string[] = [];

function makeRoot(policy: Partial<RetentionPolicy> = {}): string {
  const root = mkdtempSync(join(tmpdir(), `gv-retention-notify-${Date.now()}-`));
  roots.push(root);
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(join(root, '.runtime'), { recursive: true });
  const full: RetentionPolicy = {
    version: 1,
    logs: { maxAgeDays: 7 },
    pidfiles: { pruneStale: true },
    prune: [],
    preserve: [],
    ...policy,
  };
  writeFileSync(join(root, 'config', 'runtime-retention.json'), JSON.stringify(full, null, 2));
  return root;
}

/** Directorio con un tope que la propia política no puede cumplir → escalación. */
function seedOverCap(root: string): void {
  const dir = join(root, '.runtime', 'big');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'data.bin'), Buffer.alloc(3 * 1024 * 1024, 1));
}

/**
 * Directorio SIN política de retención y por encima del umbral que escala
 * (20 MB): esto sí es una decisión del owner (a diferencia de superar un tope
 * declarado, que es informativo).
 */
function seedUnclassified(root: string): void {
  const dir = join(root, '.runtime', 'research');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'data.bin'), Buffer.alloc(21 * 1024 * 1024, 1));
}

test.after(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

test('N1 · sin escalaciones y sin estado previo no se avisa', () => {
  const root = makeRoot();
  const sent: unknown[] = [];
  const result = runRetentionNotification({ root, dispatch: (o) => sent.push(o) });
  assert.equal(result.notified, false);
  assert.equal(result.reason, 'unchanged');
  assert.equal(sent.length, 0, 'no hay nada que decidir: no hay aviso');
});

test('N2 · escalaciones nuevas → se avisa', () => {
  const root = makeRoot();
  seedUnclassified(root);
  const sent: Array<{ severity: string; category: string }> = [];
  const result = runRetentionNotification({ root, dispatch: (o) => sent.push(o) });
  assert.equal(result.notified, true);
  assert.equal(result.reason, 'new');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].severity, 'warning');
  assert.equal(sent[0].category, 'runtime-retention');
});

test('N3 · el mismo set en el ciclo siguiente NO vuelve a avisar', () => {
  const root = makeRoot();
  seedUnclassified(root);
  const sent: unknown[] = [];
  runRetentionNotification({ root, dispatch: (o) => sent.push(o) });
  const second = runRetentionNotification({ root, dispatch: (o) => sent.push(o) });
  assert.equal(sent.length, 1, 'el aviso no se repite: un aviso diario por lo mismo es ruido');
  assert.equal(second.notified, false);
  assert.equal(second.reason, 'unchanged');
});

test('N4 · escalaciones resueltas → se avisa (info)', () => {
  const root = makeRoot();
  seedUnclassified(root);
  const sent: Array<{ severity: string }> = [];
  runRetentionNotification({ root, dispatch: (o) => sent.push(o) });
  rmSync(join(root, '.runtime', 'research'), { recursive: true, force: true });
  const second = runRetentionNotification({ root, dispatch: (o) => sent.push(o) });
  assert.equal(second.notified, true);
  assert.equal(second.reason, 'resolved');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].severity, 'info');
});

test('N5 · el aviso lleva recomendación y detalle', () => {
  const root = makeRoot();
  seedUnclassified(root);
  const sent: Array<{ message: string; details?: string; recommendation?: string }> = [];
  runRetentionNotification({ root, dispatch: (o) => sent.push(o) });
  assert.match(sent[0].message, /escalaciones requieren decisión/);
  assert.match(sent[0].details ?? '', /research/);
  assert.match(sent[0].recommendation ?? '', /runtime-retention\.json/);
});

test('N6 · autoApply decide si el barrido borra', () => {
  const root = makeRoot({
    prune: [{ path: 'old', maxAgeDays: 0, keepNewest: 0 }],
  });
  mkdirSync(join(root, '.runtime', 'old'), { recursive: true });
  writeFileSync(join(root, '.runtime', 'old', 'a.txt'), 'x');

  const simulated = runRetentionNotification({ root, dispatch: () => {} });
  assert.equal(simulated.applied, false, 'por defecto simula: no se borra nada');
  assert.ok(existsSync(join(root, '.runtime', 'old', 'a.txt')), 'simulación: el archivo sigue');

  const withApply = makeRoot({
    autoApply: true,
    prune: [{ path: 'old', maxAgeDays: 0, keepNewest: 0 }],
  });
  mkdirSync(join(withApply, '.runtime', 'old'), { recursive: true });
  writeFileSync(join(withApply, '.runtime', 'old', 'a.txt'), 'x');
  // mtime explícito en el pasado: si se deja "ahora", el reloj puede quedar un
  // instante por delante del archivo y la edad sale negativa (bug medido).
  const yesterday = new Date(Date.now() - 86_400_000);
  utimesSync(join(withApply, '.runtime', 'old', 'a.txt'), yesterday, yesterday);
  const applied = runRetentionNotification({ root: withApply, dispatch: () => {} });
  assert.equal(applied.applied, true);
  assert.ok(
    !existsSync(join(withApply, '.runtime', 'old', 'a.txt')),
    'autoApply: se poda lo declarado',
  );
});

test('N7 · el estado queda escrito para el próximo ciclo', () => {
  const root = makeRoot();
  seedUnclassified(root);
  const result = runRetentionNotification({ root, dispatch: () => {} });
  assert.ok(existsSync(result.statePath), 'estado persistido');
});

test('N8 · decideNotification es puro y ordena el set', () => {
  const a = escalationFingerprint(['b', 'a']);
  const b = escalationFingerprint(['a', 'b']);
  assert.equal(a, b, 'el mismo set en distinto orden ⇒ el mismo fingerprint');

  const previous: EscalationState = { fingerprint: a, escalations: ['a', 'b'], notifiedAt: 'x' };
  assert.equal(decideNotification(previous, ['a', 'b']).notify, false);
  assert.equal(decideNotification(previous, ['a', 'c']).reason, 'changed');
  assert.equal(decideNotification(previous, []).reason, 'resolved');
  assert.equal(decideNotification(null, ['a']).reason, 'new');
});

test('N9 · un tamaño que se movió NO vuelve a avisar (el aviso no es ruido)', () => {
  const antes = 'backups: quedaría en 1263 MB (tope 512 MB) tras podar — decisión del owner';
  const despues = 'backups: quedaría en 1264 MB (tope 512 MB) tras podar — decisión del owner';
  assert.equal(
    escalationFingerprint([antes]),
    escalationFingerprint([despues]),
    'la identidad de la escalación es el directorio y la clase, no el número',
  );

  const otro = 'research: 93.3 MB sin política de retención — decidir (podar, archivar o declarar)';
  assert.notEqual(
    escalationFingerprint([antes]),
    escalationFingerprint([otro]),
    'un directorio nuevo SÍ es una escalación nueva',
  );
});
