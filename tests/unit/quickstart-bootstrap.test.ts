/**
 * Tests del bootstrap de máquina limpia (slice 2, GB-2026-11-12).
 * Contrato: fingerprint determinista, accept gate stale-reject, y reglas de seguridad
 * (nunca clona sobre directorio ocupado; sin gh auth → clone excluido).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const mod = await import(pathToFileURL(resolve(ROOT, 'src/quickstart/bootstrap.ts')).href);
const { surveyBootstrap, buildBootstrapPlan, applyBootstrapPlan, insideGitRepo } = mod as {
  surveyBootstrap: (
    target: string,
    repo?: string,
  ) => {
    target: string;
    targetFree: boolean;
    repo: string;
    ghAuthed: string;
  };
  buildBootstrapPlan: (s: unknown) => {
    survey: unknown;
    components: Array<{ id: string; tier: string; sideEffect: string; state: string }>;
    fingerprint: string;
  };
  applyBootstrapPlan: (
    p: { fingerprint: string; survey: { target: string } },
    token: string,
    runners?: Record<string, () => string>,
  ) => { clonedTo?: string; depsInstalled: boolean; nextStep: string };
  insideGitRepo: (dir: string) => boolean;
};

describe('quickstart bootstrap', () => {
  it('insideGitRepo detecta el repo actual y un dir fuera de él', () => {
    assert.ok(insideGitRepo(ROOT), 'la raíz del repo debe detectarse como repo git');
    assert.ok(insideGitRepo(resolve(ROOT, 'src')), 'un subdir del repo también');
    // X:/nonexistent no tiene ancestro con .git en entornos de test típicos
    assert.ok(!insideGitRepo('X:/nonexistent-gv-bootstrap/gv'), 'dir inexistente fuera de repo');
  });

  it('survey es solo lectura y respeta repo/target', () => {
    const s = surveyBootstrap('X:/nonexistent-dir/gv-test', 'owner/repo');
    assert.strictEqual(s.repo, 'owner/repo');
    assert.strictEqual(s.target, 'X:/nonexistent-dir/gv-test');
    assert.strictEqual(typeof s.targetFree, 'boolean');
  });

  it('fingerprint determinista y formato sha12', () => {
    const a = buildBootstrapPlan(surveyBootstrap('X:/nonexistent-dir/gv-test', 'owner/repo'));
    const b = buildBootstrapPlan(surveyBootstrap('X:/nonexistent-dir/gv-test', 'owner/repo'));
    assert.strictEqual(a.fingerprint, b.fingerprint);
    assert.match(a.fingerprint, /^[0-9a-f]{12}$/);
  });

  it('target ocupado → clone-repo excluido (nunca clona sobre algo existente)', () => {
    const plan = buildBootstrapPlan(
      surveyBootstrap(ROOT, 'owner/repo'), // ROOT existe siempre
    );
    const clone = plan.components.find((c) => c.id === 'clone-repo');
    assert.strictEqual(clone?.tier, 'excluded');
  });

  it('sin gh auth presente → clone-repo excluido aunque el target esté libre', () => {
    const plan = buildBootstrapPlan({
      node: 'v24',
      npm: '11',
      git: 'git',
      gh: 'gh 2.0',
      ghAuthed: 'missing',
      target: 'X:/nonexistent-dir/gv-test',
      targetFree: true,
      repo: 'owner/repo',
    });
    const clone = plan.components.find((c) => c.id === 'clone-repo');
    assert.strictEqual(clone?.tier, 'excluded');
  });

  it('applyBootstrapPlan rechaza token stale sin ejecutar runners', () => {
    const plan = buildBootstrapPlan(surveyBootstrap('X:/nonexistent-dir/gv-test', 'owner/repo'));
    let executed = 0;
    assert.throws(() =>
      applyBootstrapPlan(plan, '000000000000', {
        'clone-repo': () => {
          executed++;
          return 'x';
        },
      }),
    );
    assert.strictEqual(executed, 0);
  });

  it('applyBootstrapPlan con token válido ejecuta y devuelve nextStep al plan del clon', () => {
    const plan = buildBootstrapPlan(surveyBootstrap('X:/nonexistent-dir/gv-test', 'owner/repo'));
    const r = applyBootstrapPlan(plan, plan.fingerprint, {
      'clone-repo': () => 'X:/nonexistent-dir/gv-test',
      'install-deps': () => 'ok',
    });
    assert.strictEqual(r.clonedTo, 'X:/nonexistent-dir/gv-test');
    assert.ok(r.depsInstalled);
    assert.match(r.nextStep, /quickstart\.ts/);
  });
});
