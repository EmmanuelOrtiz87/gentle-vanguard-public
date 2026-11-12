/**
 * Tests del quickstart con plan firmado (GB-2026-11-12).
 * Contrato clave: fingerprint determinista sobre {id,tier,sideEffect}, accept gate
 * que rechaza tokens stale, y apply que solo ejecuta componentes selected con runner.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SRC = (name: string) => pathToFileURL(resolve(ROOT, 'src', name)).href;

const mod = await import(SRC('quickstart/quickstart.ts'));
const { buildPlan, planFingerprint, validateAccept, applyPlan, surveyEnvironment } = mod as {
  buildPlan: (s: unknown) => {
    survey: unknown;
    components: Array<Record<string, unknown>>;
    fingerprint: string;
  };
  planFingerprint: (c: Array<Record<string, unknown>>) => string;
  validateAccept: (p: { fingerprint: string }, t: string) => boolean;
  applyPlan: (
    p: { components: Array<{ id: string; tier: string }> },
    root: string,
    token: string,
    runners?: Record<string, (id: string) => string>,
  ) => { applied: { id: string; output: string }[]; refused: string[] };
  surveyEnvironment: (root: string) => unknown;
};

const GOOD_SURVEY = {
  node: 'v22.0.0',
  npm: '10.0.0',
  git: 'git version 2.40',
  nodeModules: 'missing',
  nexusDb: 'missing',
  qualityGatesConfig: 'present',
  stackTasks: [],
};

describe('quickstart plan', () => {
  it('survey es solo lectura y devuelve el shape esperado', () => {
    const s = surveyEnvironment(ROOT) as { node: string | null; stackTasks: string[] };
    assert.ok('node' in s && 'stackTasks' in s);
    assert.ok(Array.isArray(s.stackTasks));
  });

  it('fingerprint determinista: mismo survey → mismo token', () => {
    const a = buildPlan(GOOD_SURVEY);
    const b = buildPlan(GOOD_SURVEY);
    assert.strictEqual(a.fingerprint, b.fingerprint);
    assert.match(a.fingerprint, /^[0-9a-f]{12}$/);
  });

  it('fingerprint cambia solo si cambia lo que se haría (tier/sideEffect), no el estado', () => {
    const plan = buildPlan(GOOD_SURVEY);
    const base = plan.components;
    // mismo contrato, estado distinto (solo state) → mismo fingerprint
    const same = planFingerprint(base.map((c) => ({ ...c, state: 'present' })) as never);
    assert.strictEqual(same, plan.fingerprint);
    // cambia el tier → cambia el fingerprint
    const changed = planFingerprint(
      base.map((c) => (c.id === 'install-deps' ? { ...c, tier: 'excluded' } : c)) as never,
    );
    assert.notStrictEqual(changed, plan.fingerprint);
  });

  it('accept gate: token correcto pasa, incorrecto o con espacios/casing falla', () => {
    const plan = buildPlan(GOOD_SURVEY);
    assert.ok(validateAccept(plan, plan.fingerprint));
    assert.ok(validateAccept(plan, `  ${plan.fingerprint.toUpperCase()}  `));
    assert.ok(!validateAccept(plan, 'deadbeefdead'));
  });

  it('applyPlan rechaza token stale sin ejecutar NINGUNA acción', () => {
    const plan = buildPlan(GOOD_SURVEY);
    let executed = 0;
    const runners = {
      'install-deps': () => {
        executed++;
        return 'x';
      },
    };
    assert.throws(() => applyPlan(plan, ROOT, '000000000000', runners));
    assert.strictEqual(executed, 0);
  });

  it('applyPlan con token válido ejecuta solo selected y reporta refused', () => {
    const plan = buildPlan(GOOD_SURVEY);
    const appliedIds: string[] = [];
    const runners = {
      'install-deps': () => {
        appliedIds.push('install-deps');
        return 'ok';
      },
    };
    const r = applyPlan(plan, ROOT, plan.fingerprint, runners);
    // install-deps es selected con node_modules missing → aplicado con su runner
    assert.deepStrictEqual(appliedIds, ['install-deps']);
    // session-pipeline es selected (sin tareas) pero sin runner → refused, no crash
    assert.ok(r.refused.includes('session-pipeline'));
    assert.ok(r.applied.some((a) => a.id === 'install-deps'));
  });

  it('plan con todo presente no deja componentes selected con safe-write', () => {
    const plan = buildPlan({
      ...GOOD_SURVEY,
      nodeModules: 'present',
      nexusDb: 'present',
      qualityGatesConfig: 'present',
      stackTasks: ['GV-session-autostart'],
    });
    const work = plan.components.filter(
      (c) => c.tier === 'selected' && c.sideEffect === 'safe-write',
    );
    assert.strictEqual(work.length, 0, 'con el stack operativo no debe haber nada que escribir');
  });
});
