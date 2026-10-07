/**
 * stack-upgrade.test.ts — lógica pura del comando de upgrade del stack.
 * El flujo git real se verifica en vivo (upgrade --check / upgrade contra
 * origin); acá se cubren las decisiones: plan de post-upgrade, clasificación
 * de divergencias y parseo de commits entrantes.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildUpgradePlan, classifyDivergence, parseIncomingCommits } from '../../src/ops/stack-upgrade.ts';

describe('buildUpgradePlan', () => {
  test('sin cambios entrantes → plan inerte', () => {
    const p = buildUpgradePlan([]);
    assert.equal(p.npmInstall, false);
    assert.equal(p.regenAcademy, false);
    assert.equal(p.suggestAppRestart, false);
  });

  test('lockfile en raíz y en app → npmInstall + lista dedupeada', () => {
    const p = buildUpgradePlan([
      'package.json',
      'package-lock.json',
      'apps/wpp-bot/package-lock.json',
      'apps/wpp-bot/package-lock.json',
      'README.md',
    ]);
    assert.equal(p.npmInstall, true);
    assert.deepEqual(p.lockfiles, ['package-lock.json', 'apps/wpp-bot/package-lock.json']);
  });

  test('otros lockfiles (pnpm/yarn/shrinkwrap) también disparan install', () => {
    assert.equal(buildUpgradePlan(['pnpm-lock.yaml']).npmInstall, true);
    assert.equal(buildUpgradePlan(['yarn.lock']).npmInstall, true);
    assert.equal(buildUpgradePlan(['npm-shrinkwrap.json']).npmInstall, true);
  });

  test('contenido de academy (courses/ebooks/toolkits) → regenAcademy', () => {
    assert.equal(buildUpgradePlan(['apps/academy-web/data/courses/gemini/course.json']).regenAcademy, true);
    assert.equal(buildUpgradePlan(['apps/academy-web/data/ebooks/x/content.js']).regenAcademy, true);
    assert.equal(buildUpgradePlan(['apps/academy-web/data/toolkits/y/toolkit.json']).regenAcademy, true);
    // shared/ y files.js no regeneran (el registry no los consume)
    assert.equal(buildUpgradePlan(['apps/academy-web/data/shared/files.js']).regenAcademy, false);
    // el código de la app de academy no regenera el registry de datos
    assert.equal(buildUpgradePlan(['apps/academy-web/app.js']).regenAcademy, false);
  });

  test('código de apps/src → sugiere restart de daemons', () => {
    assert.equal(buildUpgradePlan(['apps/gv-agenda/server/server.mjs']).suggestAppRestart, true);
    assert.equal(buildUpgradePlan(['src/ops/stack-upgrade.ts']).suggestAppRestart, true);
    // solo docs/imagenes → no hace falta reiniciar nada
    assert.equal(buildUpgradePlan(['docs/design/HOMOLOGACION-MATRIZ.md', 'assets/x.png']).suggestAppRestart, false);
  });
});

describe('classifyDivergence', () => {
  test('reconoce fast-forward imposible (branch divergido)', () => {
    assert.equal(classifyDivergence('fatal: Not possible to fast-forward, aborting.'), 'diverged');
    assert.equal(classifyDivergence('Your branch has diverged from origin/develop'), 'diverged');
  });
  test('reconoce archivos sin commit que el pull pisaría', () => {
    assert.equal(classifyDivergence('error: Your local changes to the following files would be overwritten by merge'), 'uncommitted-conflict');
    assert.equal(classifyDivergence("error: The following untracked working tree files would be overwritten"), 'uncommitted-conflict');
  });
  test('errores desconocidos no se inventan', () => {
    assert.equal(classifyDivergence('some random failure'), 'unknown');
    assert.equal(classifyDivergence(''), 'unknown');
  });
});

describe('parseIncomingCommits', () => {
  test('parsea git log --oneline y tolera salida vacía', () => {
    const out = 'abc1234 fix(x): algo\n def5678 feat(y): otra cosa \n';
    assert.deepEqual(parseIncomingCommits(out), [
      { hash: 'abc1234', subject: 'fix(x): algo' },
      { hash: 'def5678', subject: 'feat(y): otra cosa' },
    ]);
    assert.deepEqual(parseIncomingCommits(''), []);
    assert.deepEqual(parseIncomingCommits('\n\n'), []);
  });
});
