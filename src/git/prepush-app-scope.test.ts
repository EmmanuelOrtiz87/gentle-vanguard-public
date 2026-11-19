import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertKnownAppScope, classifyAppScope, inspectAppScope } from './prepush-app-scope.js';

test('solo comandos MCP de OpenCode conocidos no afectan consumidores de modelos de apps', () => {
  const before = {
    model: 'provider/model',
    mcp: { servers: { memory: { command: ['npx', 'memory'], enabled: true } } },
  };
  const after = structuredClone(before);
  after.mcp.servers.memory.command = ['node', 'native-launch'];
  const pair = () => [JSON.stringify(before), JSON.stringify(after)] as [string, string];
  assert.equal(classifyAppScope(['opencode.json'], pair).mode, 'none');
  // Un cambio de modelo/proveedor/MCP afecta a todas las apps que consumen
  // agentes: el impacto es global (barrido completo), no "desconocido".
  after.model = 'different/model';
  assert.equal(classifyAppScope(['opencode.json'], pair).mode, 'full');
  after.model = before.model;
  after.mcp.servers.memory.enabled = false;
  assert.equal(classifyAppScope(['opencode.json'], pair).mode, 'full');
});

test('documentación editorial no propone una auditoría de apps', () => {
  assert.equal(
    classifyAppScope([
      'docs/alexandria/README.md',
      'docs/alexandria/propuesta.pdf',
      'scripts/alexandria/build-doc-guia.ts',
    ]).mode,
    'none',
  );
});

test('selecciona las apps directas una vez, en orden estable', () => {
  const scope = classifyAppScope([
    'apps/b/tests/a.ts',
    'apps/a/public/main.js',
    'apps/b/README.md',
  ]);
  assert.equal(scope.mode, 'apps');
  assert.deepEqual(scope.apps, ['a', 'b']);
});

test('solo los insumos compartidos conocidos amplían el alcance', () => {
  for (const path of ['packages/shared/x.ts', 'pnpm-lock.yaml']) {
    assert.equal(classifyAppScope(['apps/a/test.mjs', path]).mode, 'full', path);
  }
  // Superficie del stack: impacto global (barrido completo), no desconocido.
  for (const path of ['src/x.ts', 'scripts/alexandria/sync-core-contract.ts', 'config/otro.json']) {
    assert.equal(classifyAppScope(['apps/a/test.mjs', path]).mode, 'full', path);
    assert.equal(classifyAppScope([path]).mode, 'full', path);
  }
  // Superficie sin runtime de apps: docs, skills, reportes y tests del stack.
  for (const path of [
    'docs/build.ts',
    'skills/impeccable/SKILL.md',
    'reports/audits/x.json',
    'tests/unit/x.test.ts',
  ]) {
    assert.equal(classifyAppScope([path]).mode, 'none', path);
  }
  assert.equal(classifyAppScope(null).mode, 'unknown');
  assert.equal(classifyAppScope(['pnpm-lock.yaml', 'src/unknown.ts']).mode, 'full');
});

test('los reportes pasivos del incidente no seleccionan apps', () => {
  assert.equal(
    classifyAppScope([
      'reports/audits/model-catalog-latest.json',
      'reports/audits/workspace-reconciliation-2026-11-17.json',
    ]).mode,
    'none',
  );
});

test('un alcance desconocido no llega al ejecutor, aunque exista una dependencia compartida', () => {
  let executions = 0;
  // Una ruta sin clasificacion (no es app, ni stack, ni config conocida) sigue
  // bloqueando: "no conozco el impacto" no es lo mismo que "el impacto es global".
  assert.throws(() => {
    assertKnownAppScope(classifyAppScope(['pnpm-lock.yaml', 'assets/custom.json']));
    executions++;
  }, /Identificar consumidores/);
  assert.equal(executions, 0);
});

test('un contrato ilegible no concede autoridad para ejecutar todas las apps', () => {
  assert.equal(classifyAppScope(['package.json'], () => ['{}', '{bad']).mode, 'unknown');
});

test('la comparación usa los commits solicitados, incluso si HEAD apunta a otro', () => {
  const scope = inspectAppScope('base', 'candidate', (args) => {
    if (args.at(-1) === 'base^{commit}') return 'base-sha\n';
    if (args.at(-1) === 'candidate^{commit}') return 'candidate-sha\n';
    if (args[0] === 'merge-base') return '';
    assert.deepEqual(args.slice(-3), ['base-sha', 'candidate-sha', '--']);
    return 'apps/gv-agenda/tests/a.mjs\0';
  });
  assert.equal(scope.source, 'explicit');
  assert.deepEqual(scope.apps, ['gv-agenda']);
  assert.equal(inspectAppScope('missing', 'HEAD', () => null).mode, 'unknown');
});

test('un contrato de validación solo selecciona las apps cuyas entradas cambiaron', () => {
  const before = JSON.stringify({ version: 1, naDeclarations: { existing: { build: 'a' } } });
  const after = JSON.stringify({
    version: 1,
    naDeclarations: { existing: { build: 'a' }, forge: { build: 'b' } },
  });
  const scope = classifyAppScope(['config/app-validation-contracts.json'], () => [before, after]);
  assert.deepEqual(scope.apps, ['forge']);
  assert.equal(scope.mode, 'apps');
});

test('los metadatos generados y los scripts de salud no afectan apps; dependencias compartidas sí', () => {
  const before = JSON.stringify({ scripts: { test: 'node --test' }, dependencies: { x: '1' } });
  const after = JSON.stringify({
    scripts: { test: 'node --test', 'apps:health': 'health' },
    dependencies: { x: '1' },
  });
  assert.equal(classifyAppScope(['package.json'], () => [before, after]).mode, 'none');
  assert.equal(
    classifyAppScope(['package.json'], () => [before, after.replace('"1"', '"2"')]).mode,
    'full',
  );
  assert.equal(
    classifyAppScope(['assets/tokens.json'], () => [
      '{"meta":{"generated":"a"},"tokens":{"x":1}}',
      '{"meta":{"generated":"b"},"tokens":{"x":1}}',
    ]).mode,
    'none',
  );
});

test('el rango incluye cambios locales de apps sin ampliar por documentación local', () => {
  const scope = inspectAppScope(
    'base',
    'HEAD',
    (args) => {
      if (args[0] === 'rev-parse') return args.at(-1) === 'base^{commit}' ? 'base-sha' : 'head-sha';
      if (args[0] === 'merge-base') return '';
      if (args[0] === 'ls-files') return 'apps/b/smoke.test.js\0';
      if (args.includes('base-sha')) return 'apps/a/server.js\0';
      return 'docs/guide.md\0';
    },
    () => null,
  );
  assert.equal(scope.mode, 'apps');
  assert.deepEqual(scope.apps, ['a', 'b']);
});

test('la configuracion de tooling del stack tiene mapa de impacto declarado', () => {
  // Sin declaracion, el gate ABORTA antes de correr ningun check (alcance
  // desconocido): un archivo de tooling no puede dejar el push sin salida.
  for (const path of ['.deadcode-baseline.txt', 'knip.json']) {
    const scope = classifyAppScope([path]);
    assert.equal(scope.mode, 'none', `${path} debe quedar clasificado como sin impacto en apps`);
  }
});
