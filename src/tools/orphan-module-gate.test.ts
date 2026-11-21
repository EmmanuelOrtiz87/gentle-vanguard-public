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

test('un módulo nombrado SOLO en un config histórico SIGUE siendo huérfano (GB-20261120)', () => {
  const root = buildFixture();
  try {
    // El tracker ps1→TS nombraba a 5 wrappers muertos y el gate los creía vivos
    // durante meses. Ahora los configs de registro histórico no son consumidores.
    mkdirSync(join(root, 'config'), { recursive: true });
    writeFileSync(
      join(root, 'config', 'ps1-ts-migration.json'),
      JSON.stringify({ completedWave7: ['orphan-module'] }),
    );
    const orphans = findOrphans(root);
    assert.ok(
      orphans.some((o) => o.module.endsWith('orphan-module.ts')),
      'el config histórico no debe salvar al muerto',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('un config VIVO que referencia el módulo sigue siendo consumidor', () => {
  const root = buildFixture();
  try {
    mkdirSync(join(root, 'config'), { recursive: true });
    writeFileSync(
      join(root, 'config', 'live-routing.json'),
      JSON.stringify({ pattern: 'orphan-module', target: 'algo' }),
    );
    const orphans = findOrphans(root);
    assert.ok(
      !orphans.some((o) => o.module.endsWith('orphan-module.ts')),
      'un config vivo que lo usa sigue siendo consumidor legítimo',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
