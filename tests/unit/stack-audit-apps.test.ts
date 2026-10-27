/**
 * Tests para stack-audit-apps.ts
 *
 * Verifica la logica PURA (descubrimiento + plan + composicion de audit).
 * No corre npm de verdad (eso es costoso + flake); usa execute=false para
 * ejercitar el camino de plan sin ejecutar.
 *
 * Los checks end-to-end (que npm run typecheck sale verde en wpp-bot)
 * los cubre el smoke E2E en tests/smoke/stack-audit.smoke.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..', '..');

const {
  discoverApps,
  readAppScripts,
  planAppAudits,
  buildAppAudit,
  auditApps,
} = await import('../../src/ops/stack-audit-apps.js');

void repoRoot;

test('discoverApps: detecta wpp-bot y content-cms, excluye .runtime', () => {
  const apps = discoverApps();
  assert.ok(apps.includes('wpp-bot'), 'wpp-bot debe aparecer');
  assert.ok(apps.includes('content-cms'), 'content-cms debe aparecer');
  assert.ok(!apps.includes('.runtime'), '.runtime debe estar excluido');
  assert.ok(!apps.some((a) => a.startsWith('.')), 'no debe haber dirs ocultos');
});

test('discoverApps: solo devuelve directorios, no archivos sueltos', () => {
  const apps = discoverApps();
  for (const a of apps) {
    assert.ok(a.length > 0 && !a.startsWith('.'), `${a} parece archivo o dir oculto`);
  }
});

test('readAppScripts: wpp-bot tiene typecheck/test/lint', () => {
  const scripts = readAppScripts('wpp-bot');
  assert.ok(scripts.typecheck, 'wpp-bot.typecheck debe existir');
  assert.ok(scripts.test, 'wpp-bot.test debe existir');
  assert.ok(scripts.lint, 'wpp-bot.lint debe existir');
});

test('readAppScripts: design-hub exposes its native tests without inventing typecheck or lint', () => {
  const scripts = readAppScripts('design-hub');
  assert.equal(scripts.typecheck, undefined);
  assert.equal(scripts.test, 'node --test tools/*.test.mjs');
  assert.equal(scripts.lint, undefined);
});

test('readAppScripts: maps a static:build script to the native build check', () => {
  const scripts = readAppScripts('genesis-landing');
  assert.equal(scripts.build, 'node scripts/build-static.mjs');
});

test('readAppScripts: devuelve vacio para app inexistente', () => {
  const scripts = readAppScripts('__no_existe__');
  assert.deepEqual(scripts, {});
});

test('planAppAudits: incluye solo kinds que tienen script definido', () => {
  const apps = ['wpp-bot', 'design-hub'];
  const plans = planAppAudits(apps, ['typecheck', 'test', 'lint']);
  const wpp = plans.find((p) => p.app === 'wpp-bot');
  const design = plans.find((p) => p.app === 'design-hub');
  assert.ok(wpp && wpp.plan.length === 3, 'wpp-bot debe planear 3 checks');
  assert.deepEqual(design?.plan.map((check) => check.kind), ['test']);
  assert.equal(design?.packageJsonExists, true, 'design-hub SI tiene package.json');
});

test('planAppAudits: uses static:build as the app build contract when build is absent', () => {
  const plan = planAppAudits(['genesis-landing'], ['build'])[0];
  assert.deepEqual(plan.plan.map((check) => check.script), ['static:build']);
  assert.equal(plan.omissions.length, 0);
});

test('planAppAudits: respeta filtro `only`', () => {
  const plans = planAppAudits(['wpp-bot'], ['test']);
  assert.equal(plans[0].plan.length, 1);
  assert.equal(plans[0].plan[0].kind, 'test');
});

test('planAppAudits: descubre suites test:* seguras y explica las suites diferidas de Vanguard Connect', () => {
  const plans = planAppAudits(['vanguard-connect'], ['test']);
  const plan = plans[0];
  assert.deepEqual(
    plan.plan.map((check) => check.script),
    ['test:automation', 'test:bridge', 'test:lifecycle'],
  );
  assert.ok(plan.omissions.some((item) => item.script === 'test:bot-manager' && /environment contract/i.test(item.reason)));
});

test('planAppAudits: también registra scripts test:* cuando ya existe el test genérico', () => {
  const plan = planAppAudits(['wpp-bot'], ['test'])[0];
  assert.ok(plan.plan.some((check) => check.kind === 'test'));
  assert.ok(plan.omissions.some((item) => item.script === 'test:autoplay'));
});

test('planAppAudits: solo ejecuta suites E2E incluidas en contrato local aislado', () => {
  const gvAgenda = planAppAudits(['gv-agenda'], ['test'])[0];
  const kairos = planAppAudits(['kairos-agenda'], ['test'])[0];
  const sandbox = planAppAudits(['sandbox-gv'], ['test'])[0];
  assert.ok(gvAgenda.plan.some((check) => check.script === 'test:e2e'));
  assert.ok(kairos.plan.some((check) => check.script === 'test:e2e'));
  assert.ok(sandbox.plan.some((check) => check.script === 'test:smoke'));
  assert.ok(gvAgenda.omissions.some((item) => item.script === 'test:journey'));
});

test('planAppAudits: incluye suites nativas explícitas para apps sin package.json', () => {
  const academy = planAppAudits(['academy-landing'], ['test'])[0];
  const commandCenter = planAppAudits(['command-center'], ['test'])[0];
  assert.equal(academy.packageJsonExists, false);
  assert.equal(commandCenter.packageJsonExists, false);
  assert.ok(academy.plan.some((check) => check.script === 'native-tests'));
  assert.ok(commandCenter.plan.some((check) => check.script === 'native-tests'));
  assert.ok(!academy.omissions.some((item) => item.script === 'test'));
  assert.ok(!commandCenter.omissions.some((item) => item.script === 'test'));
});

test('planAppAudits: explica checks genéricos ausentes por app sin ocultar el hueco', () => {
  const plans = planAppAudits(['corporate-web'], ['typecheck', 'test']);
  assert.ok(plans[0].omissions.some((item) => item.script === 'typecheck'));
  assert.ok(plans[0].omissions.some((item) => item.script === 'test'));
});

test('buildAppAudit: PASS si todos los resultados son PASS', () => {
  const plan = [{ kind: 'typecheck' as const, script: 'tsc --noEmit' }];
  const results = [{ kind: 'typecheck' as const, status: 'PASS' as const, durationMs: 100, message: 'ok' }];
  const audit = buildAppAudit('test-app', true, plan, results);
  assert.equal(audit.status, 'PASS');
  assert.equal(audit.checks.length, 1);
});

test('buildAppAudit: una app sin package.json puede pasar con checks nativos aprobados', () => {
  const plan = [{ kind: 'test:native', script: 'native-tests' }];
  const results = [{ kind: 'test:native', status: 'PASS' as const, durationMs: 25, message: 'ok' }];
  assert.equal(buildAppAudit('static-app', false, plan, results).status, 'PASS');
});

test('buildAppAudit: FAIL si algun check es FAIL', () => {
  const plan = [
    { kind: 'typecheck' as const, script: 'tsc' },
    { kind: 'test' as const, script: 'vitest' },
  ];
  const results = [
    { kind: 'typecheck' as const, status: 'PASS' as const, durationMs: 50, message: 'ok' },
    { kind: 'test' as const, status: 'FAIL' as const, durationMs: 200, message: '5 failed', exitCode: 1 },
  ];
  const audit = buildAppAudit('mixed', true, plan, results);
  assert.equal(audit.status, 'FAIL');
});

test('buildAppAudit: WARN si todos son SKIP (plan vacio o todos los kinds sin script)', () => {
  const plan: Array<{ kind: 'typecheck'; script: string }> = [];
  const results: Array<{ kind: 'typecheck'; status: 'SKIP'; durationMs: number; message: string }> = [];
  const audit = buildAppAudit('empty-app', false, plan, results);
  assert.equal(audit.status, 'WARN');
});

test('auditApps (execute=false): devuelve un audit por app, design-hub es WARN (plan vacio)', async () => {
  const audits = await auditApps({ only: ['typecheck', 'test'], execute: false });
  assert.ok(audits.length > 0, 'debe devolver al menos 1 audit');
  const designHub = audits.find((a) => a.app === 'design-hub');
  assert.ok(designHub, 'design-hub debe estar en la lista');
  assert.equal(designHub.status, 'WARN', 'design-hub sin scripts debe ser WARN');
  for (const c of designHub.checks) {
    assert.equal(c.status, 'SKIP');
  }
});

test('auditApps (execute=false): apps con plan pero sin ejecutar -> WARN', async () => {
  const audits = await auditApps({ only: ['typecheck', 'test'], execute: false });
  // wpp-bot tiene plan pero ejecuta=false -> todos SKIP -> WARN
  const wpp = audits.find((a) => a.app === 'wpp-bot');
  assert.ok(wpp);
  assert.equal(wpp.status, 'WARN', 'plan lleno pero todos SKIP -> WARN');
});

test('auditApps (execute=false, only=[test]): filtra por kind', async () => {
  const audits = await auditApps({ only: ['test'], execute: false });
  for (const a of audits) {
    for (const c of a.checks) {
      assert.ok(c.kind === 'test' || c.kind.startsWith('test:'), `check debe ser test o test:* pero es ${c.kind}`);
    }
  }
});

test('auditApps (execute=false): .runtime no aparece (filtrado por discoverApps)', async () => {
  const audits = await auditApps({ execute: false });
  assert.ok(!audits.some((a) => a.app === '.runtime'));
});
