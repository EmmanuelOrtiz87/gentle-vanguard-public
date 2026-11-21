/**
 * Contratest del inventario de actores paralelos (GB-2026-11-21 slice A3).
 *
 * La clasificación ES el contrato: un regenerable mal clasificado como ajeno
 * ruido en cada apertura; un ajeno clasificado como regenerable oculta obra
 * de un actor paralelo — exactamente el incidente que este step previene
 * (bitácora 2026-11-20, MiniMax ×3).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLine,
  isRegenerable,
  buildInventory,
} from '../../src/ops/uncommitted-actor-inventory.js';

test('classifyLine parsea los 4 estados de porcelain', () => {
  assert.deepEqual(classifyLine(' M src/foo.ts'), { path: 'src/foo.ts', state: 'modified' });
  assert.deepEqual(classifyLine('?? src/bar.ts'), { path: 'src/bar.ts', state: 'untracked' });
  assert.deepEqual(classifyLine('M  src/baz.ts'), { path: 'src/baz.ts', state: 'staged' });
  assert.deepEqual(classifyLine(' D src/old.ts'), { path: 'src/old.ts', state: 'deleted' });
  assert.equal(classifyLine(''), null);
  assert.equal(classifyLine('## main...origin/main'), null);
});

test('regenerables conocidos NO se reportan como ajenos', () => {
  for (const p of [
    '.runtime/autostart-detached-20261121.log',
    '.session/snapshots/untracked/x.patch',
    'rules/adaptive/LEARNED-NORMS.md',
    'docs/sessions/metrics/monthly/token-summary-2026-10.md',
    'reports/audits/token-efficiency-latest.json',
    'assets/tokens.json',
  ]) {
    assert.equal(isRegenerable(p), true, p);
  }
});

test('obra real de código es ajena', () => {
  for (const p of [
    'src/ops/nuevo.ts',
    'apps/web-dashboard/server/x.ts',
    'docs/features/GB-nuevo.md',
  ]) {
    assert.equal(isRegenerable(p), false, p);
  }
});

test('buildInventory separa y sugiere protocolo solo con ajenos', () => {
  const porcelain = [
    '?? src/ops/nuevo-step.ts',
    ' M rules/adaptive/LEARNED-NORMS.md',
    ' M src/core/session-autostart.ts',
  ].join('\n');
  const r = buildInventory(porcelain, 'main');
  assert.equal(r.total, 3);
  assert.equal(r.foreignCount, 2);
  assert.deepEqual(
    r.foreign.map((f) => f.path).sort(),
    ['src/core/session-autostart.ts', 'src/ops/nuevo-step.ts'].sort(),
  );
  assert.ok(r.note.includes('Protocolo probado'));

  const clean = buildInventory(' M rules/adaptive/LEARNED-NORMS.md', 'main');
  assert.equal(clean.foreignCount, 0);
  assert.ok(clean.note.includes('sin obra ajena'));
});
