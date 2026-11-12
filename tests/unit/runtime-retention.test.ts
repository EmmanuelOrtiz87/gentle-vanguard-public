/**
 * runtime-retention.test.ts — la política de retención se puede aplicar sin
 * surprises.
 *
 * POR QUÉ EXISTE (2026-11-11)
 * -------------------------------------------------------------------------
 * `.runtime/` estaba en 3,6 GB con 136 directorios y 53.321 archivos, sin
 * política: el disco se llenaba en silencio. La política vive en
 * `config/runtime-retention.json` y la aplica `src/ops/runtime-retention.ts`.
 *
 * Un podador que borra lo que no debe es peor que no tener podador: estos
 * tests fijan las reglas que importan:
 *
 *   R1 · Lo PODABLE por edad se poda (y en modo simulación NO se borra).
 *   R2 · `keepNewest` protege lo más reciente, aunque sea viejo: un backup
 *        de restauración vale más que su edad.
 *   R3 · Lo CONSERVADO no se toca nunca.
 *   R4 · Un pidfile huérfano (proceso muerto) se poda; uno vivo, no.
 *   R5 · Lo que no tiene política se ESCALA, no se borra: la decisión es del
 *        owner.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  auditRetention,
  loadPolicy,
  matches,
  type RetentionPolicy,
} from '../../src/ops/runtime-retention.ts';

const roots: string[] = [];

const DAY = 86_400_000;

function makeRoot(policy: Partial<RetentionPolicy> = {}): string {
  const root = mkdtempSync(join(tmpdir(), `gv-retention-${Date.now()}-`));
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

function touch(root: string, rel: string, ageDays: number, sizeBytes = 1024): void {
  const abs = join(root, '.runtime', rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, 'x'.repeat(sizeBytes));
  const when = new Date(Date.now() - ageDays * DAY);
  // mtime del archivo (Windows: hay que tocar también el directorio padre).
  try {
    utimesSync(abs, when, when);
    utimesSync(join(abs, '..'), when, when);
  } catch {
    /* best effort */
  }
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

test('R1 · lo podable por edad se marca, y en simulación NO se borra', () => {
  const root = makeRoot({ prune: [{ path: 'backups', maxAgeDays: 14 }] });
  touch(root, 'backups/viejo.txt', 40);
  touch(root, 'backups/nuevo.txt', 2);

  const report = auditRetention({ root });
  const marked = report.pruned.map((p) => p.path);
  assert.deepEqual(marked, ['backups/viejo.txt'], 'sólo lo que excede la edad');
  assert.ok(existsSync(join(root, '.runtime', 'backups', 'viejo.txt')), 'simulación: no borra');
});

test('R2 · keepNewest protege lo más reciente aunque sea viejo', () => {
  const root = makeRoot({ prune: [{ path: 'backups', maxAgeDays: 14, keepNewest: 1 }] });
  touch(root, 'backups/a.txt', 90);
  touch(root, 'backups/b.txt', 80);
  touch(root, 'backups/c.txt', 70);

  const report = auditRetention({ root });
  assert.equal(report.pruned.length, 2, 'el más reciente se conserva');
  assert.ok(!report.pruned.some((p) => p.path.endsWith('c.txt')));
});

test('R3 · lo conservado no se toca nunca', () => {
  const root = makeRoot({
    prune: [{ path: '*', maxAgeDays: 1 }],
    preserve: [{ path: 'prompt-studio', note: 'estado del owner' }],
  });
  touch(root, 'prompt-studio/estado.txt', 90);

  const report = auditRetention({ root });
  assert.equal(report.pruned.length, 0, 'lo conservado no se poda');
});

test('R4 · un pidfile huérfano se poda y uno vivo no', () => {
  const root = makeRoot();
  writeFileSync(join(root, '.runtime', 'muerto.pid'), '999999');
  writeFileSync(join(root, '.runtime', 'vivo.pid'), String(process.pid));

  const report = auditRetention({ root });
  assert.equal(report.stalePidfiles.length, 1, 'sólo el huérfano');
  assert.ok(report.stalePidfiles[0].includes('muerto.pid'));
});

test('R5 · lo que no tiene política se escala, no se borra', () => {
  const root = makeRoot({ prune: [{ path: 'backups', maxAgeDays: 1 }] });
  touch(root, 'sin-politica/dato.txt', 90, 40 * 1024 * 1024);

  const report = auditRetention({ root });
  assert.equal(report.pruned.length, 0, 'sin política no se borra nada');
  assert.ok(report.unclassified.some((u) => u.path === 'sin-politica'));
  assert.ok(
    report.escalations.some((e) => e.includes('sin-politica')),
    'lo sin política se escala para que el owner decida',
  );
});

test('los logs viejos se podan y los recientes no', () => {
  const root = makeRoot({ logs: { maxAgeDays: 7 } });
  touch(root, 'viejo.log', 30);
  touch(root, 'nuevo.log', 1);

  const report = auditRetention({ root });
  assert.equal(report.logsPruned, 1);
});

test('el patrón con sufijo * hace match por prefijo', () => {
  assert.equal(matches('qa-*', 'qa-web'), true);
  assert.equal(matches('qa-*', 'webhooks'), false);
  assert.equal(matches('backups', 'backups'), true);
});

test('R6 · la edad nunca es negativa (un mtime un instante adelante no esquiva la poda)', () => {
  const root = makeRoot({ prune: [{ path: 'backups', maxAgeDays: 0 }] });
  const abs = join(root, '.runtime', 'backups');
  mkdirSync(abs, { recursive: true });
  const file = join(abs, 'recien.txt');
  writeFileSync(file, 'x');
  // El mtime queda un instante por delante del reloj (granularidad de ms).
  const future = new Date(Date.now() + 1000);
  utimesSync(file, future, future);

  const report = auditRetention({ root });
  assert.equal(report.pruned.length, 1, 'edad negativa = 0: se poda igual');
  assert.ok(report.pruned[0].ageDays >= 0, 'la edad reportada nunca es negativa');
});

test('R7 · superar el tope declarado se INFORMA, no escala (el owner confirmó los topes)', () => {
  const root = makeRoot({
    prune: [{ path: 'backups', maxAgeDays: 14, keepNewest: 1, maxMb: 1 }],
  });
  touch(root, 'backups/grande.bin', 1, 3 * 1024 * 1024);

  const report = auditRetention({ root });
  assert.equal(report.escalations.length, 0, 'un tope confirmado no pide decisión');
  assert.equal(report.overCap.length, 1, 'pero se informa');
  assert.match(report.overCap[0], /backups/);
});

test('R8 · una regla con onExceed "ask" sí escala (el tope es lo que hay que decidir)', () => {
  const root = makeRoot({
    prune: [{ path: 'backups', maxAgeDays: 14, keepNewest: 1, maxMb: 1, onExceed: 'ask' }],
  });
  touch(root, 'backups/grande.bin', 1, 3 * 1024 * 1024);

  const report = auditRetention({ root });
  assert.equal(report.escalations.length, 1, 'el owner lo pidió: escala');
  assert.equal(report.overCap.length, 0);
});

test('la política real del repo está versionada y tiene reglas', () => {
  const policy = loadPolicy();
  assert.ok(policy.prune.length > 0, 'hay reglas de poda');
  assert.ok(policy.preserve.length > 0, 'hay reglas de conservación');
  assert.equal(policy.logs.maxAgeDays, 7);
});
