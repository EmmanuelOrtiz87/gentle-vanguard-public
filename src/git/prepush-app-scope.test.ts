import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyAppScope, inspectAppScope } from './prepush-app-scope.js';

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

test('los insumos compartidos y las rutas desconocidas amplían el alcance', () => {
  for (const path of [
    'packages/shared/x.ts',
    'src/x.ts',
    'pnpm-lock.yaml',
    '.lefthook.yml',
    'docs/build.ts',
    'scripts/alexandria/sync-core-contract.ts',
  ]) {
    assert.equal(classifyAppScope(['apps/a/test.mjs', path]).mode, 'full', path);
  }
  assert.equal(classifyAppScope(null).mode, 'full');
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
  assert.equal(inspectAppScope('missing', 'HEAD', () => null).mode, 'full');
});
