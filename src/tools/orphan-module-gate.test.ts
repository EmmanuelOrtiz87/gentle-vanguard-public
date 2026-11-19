/**
 * orphan-module-gate.test.ts — El detector de muertos no declara vivos ni omite muertos.
 *
 * Fixture: un src/ mínimo con un módulo vivo (importado) y un huérfano
 * (0 importers). El gate tiene que encontrar exactamente al huérfano.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { findOrphans } from './orphan-module-gate.js';

function buildFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'orphans-'));
  mkdirSync(join(root, 'src', 'core'), { recursive: true });
  mkdirSync(join(root, 'src', 'cli'), { recursive: true });
  writeFileSync(join(root, 'src', 'core', 'live-module.ts'), 'export const alive = () => 1;\n');
  writeFileSync(join(root, 'src', 'core', 'orphan-module.ts'), 'export const dead = () => 2;\n');
  writeFileSync(join(root, 'src', 'cli', 'only-called.ts'), 'main();\n');
  writeFileSync(
    join(root, 'src', 'core', 'importer.ts'),
    "import { alive } from './live-module.js';\nexport const use = () => alive();\n",
  );
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ scripts: { demo: 'node --import tsx src/cli/only-called.ts' } }),
  );
  mkdirSync(join(root, 'tests'), { recursive: true });
  writeFileSync(
    join(root, 'tests', 'consumer.ts'),
    "import { use } from '../src/core/importer.js';\nexport const indirect = () => use();\n",
  );
  return root;
}

test('un modulo importado y un entry point NO son huerfanos; el muerto SI', () => {
  const root = buildFixture();
  try {
    const orphans = findOrphans(root);
    const names = orphans.map((o) => o.module);
    assert.ok(
      names.some((n) => n.endsWith('orphan-module.ts')),
      'el muerto debe figurar',
    );
    assert.ok(!names.some((n) => n.endsWith('live-module.ts')), 'el vivo no debe figurar');
    assert.ok(!names.some((n) => n.endsWith('only-called.ts')), 'entry point CLI excluido');
    assert.ok(!names.some((n) => n.endsWith('importer.ts')), 'importado desde tests → no huérfano');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
