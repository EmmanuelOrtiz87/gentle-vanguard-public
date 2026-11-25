/**
 * El resumen de los lazy steps tiene que contar lo que realmente pasa.
 *
 * Contexto: los steps que arrancan un watcher se lanzan con `daemon: true` y
 * el runner escribe status `daemon`. El resumen NO contaba ese status: 88 steps
 * se reportaban como 85 ok (3 invisible) y, peor, un daemon que salia limpio
 * porque otra instancia era dueña (dedupe por pidfile) se reportaba como
 * `failed` → FAIL falso del watchtower.
 *
 * Casos que fijan:
 *   1. `daemon` cuenta como ok (el watcher quedó vivo o hay dueño).
 *   2. `failed` / `timeout` / `stale` siguen siendo lo que son.
 *   3. Un resultado ilegible es `failed` (no se cuenta como ok en silencio).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectLazyStatus, problemSteps } from '../../src/core/lazy-status.ts';

function makeRoot(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'gv-lazy-status-'));
  const dir = join(root, '.runtime', 'autostart-lazy-results');
  mkdirSync(dir, { recursive: true });
  for (const [name, payload] of Object.entries(files)) {
    writeFileSync(join(dir, name), JSON.stringify(payload), 'utf-8');
  }
  return root;
}

describe('lazy-status — el resumen cuenta los daemons', () => {
  it('cuenta `daemon` como ok y no lo deja invisible', () => {
    const root = makeRoot({
      'a.json': { id: 'a', status: 'ok', finishedAt: new Date().toISOString() },
      'b.json': { id: 'b', status: 'daemon', finishedAt: new Date().toISOString() },
    });
    const status = collectLazyStatus(root);
    assert.strictEqual(status.total, 2);
    assert.strictEqual(status.ok, 2);
    assert.strictEqual(status.failed, 0);
  });

  it('sigue contando failed / timeout / stale como problemas', () => {
    const root = makeRoot({
      'a.json': { id: 'a', status: 'failed', finishedAt: new Date().toISOString() },
      'b.json': { id: 'b', status: 'timeout', finishedAt: new Date().toISOString() },
      'c.json': { id: 'c', status: 'ok', finishedAt: new Date().toISOString() },
    });
    const status = collectLazyStatus(root);
    assert.strictEqual(status.ok, 1);
    assert.strictEqual(status.failed, 1);
    assert.strictEqual(status.timeout, 1);
  });

  it('un resultado ilegible es failed, no un ok silencioso', () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-lazy-status-bad-'));
    const dir = join(root, '.runtime', 'autostart-lazy-results');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'roto.json'), '{ esto no es json', 'utf-8');
    const status = collectLazyStatus(root);
    assert.strictEqual(status.failed, 1);
    assert.strictEqual(status.ok, 0);
  });
});

describe('problemSteps — el lector no se juzga a si mismo', () => {
  it('excluye el step del watchtower y conserva los demas problemas', () => {
    const results = [
      { id: 'maintenance-watchtower', status: 'failed' as const },
      { id: 'agent-operability', status: 'failed' as const },
      { id: 'token-safety-audit', status: 'timeout' as const },
      { id: 'ok-step', status: 'ok' as const },
      { id: 'daemon-step', status: 'daemon' as const },
    ];
    const problems = problemSteps(results, ['maintenance-watchtower']);
    assert.deepStrictEqual(
      problems.map((r) => `${r.id}:${r.status}`),
      ['agent-operability:failed', 'token-safety-audit:timeout'],
    );
  });

  it('sin exclusion reporta todos los problemas (incluido el propio)', () => {
    const results = [
      { id: 'maintenance-watchtower', status: 'failed' as const },
      { id: 'agent-operability', status: 'stale' as const },
    ];
    assert.strictEqual(problemSteps(results).length, 2);
  });
});
