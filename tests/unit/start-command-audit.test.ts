/**
 * start-command-audit.test.ts — el detector de comandos de arranque rotos.
 *
 * POR QUÉ EXISTE (2026-11-11)
 * -------------------------------------------------------------------------
 * El `start.sh` de `sandbox-gv` llamaba a `src/cli/gv.ts`, que no existía: la
 * app no arrancaba y nadie lo notó porque el Command Center la arrancaba por
 * su cuenta. Dos caminos para prender la misma app pueden divergir en
 * silencio, y el que falla es el que nadie mira.
 *
 * El detector tiene que:
 *   · VER el error real (una referencia que no resuelve a ningún archivo),
 *   · NO ver errores falsos (un ejemplo en un comentario, un `.js` con
 *     hermano `.ts`, un artefacto de build).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auditStartCommands, stripComments } from '../../src/tools/start-command-audit.ts';

const roots: string[] = [];

function makeRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), `gv-start-cmd-${Date.now()}-`));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  return root;
}

test.after(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

test('VE el error real: una referencia que no resuelve a ningún archivo', () => {
  const root = makeRoot({
    'apps/probe/start.sh': '#!/usr/bin/env bash\nnode --import tsx src/cli/roto.ts\n',
  });
  const { broken } = auditStartCommands(root);
  assert.equal(broken.length, 1, 'la referencia rota tiene que aparecer');
  assert.ok(broken[0].reference.includes('roto.ts'));
});

test('NO ve errores falsos: un ejemplo en un comentario no es un comando', () => {
  const root = makeRoot({
    'apps/probe/start.sh': '#!/usr/bin/env bash\n# uso: ./start.sh src/cli/ejemplo.ts\n',
  });
  const { broken } = auditStartCommands(root);
  assert.equal(broken.length, 0, 'el comentario no se audita');
});

test('NO ve errores falsos: un .js con hermano .ts resuelve', () => {
  const root = makeRoot({
    'apps/probe/start.ts': "import './server.js';\n",
    'apps/probe/server.ts': 'export const a = 1;\n',
  });
  const { broken } = auditStartCommands(root);
  assert.equal(broken.length, 0, 'el hermano .ts cuenta como resolución');
});

test('un artefacto de build se reporta aparte, no como error', () => {
  const root = makeRoot({
    'apps/probe/start.sh': '#!/usr/bin/env bash\nnode dist/index.js\n',
  });
  const { broken, buildArtifacts } = auditStartCommands(root);
  assert.equal(broken.length, 0);
  assert.equal(buildArtifacts.length, 1, 'el build queda declarado, no roto');
});

test('los comentarios no son comandos', () => {
  const shell = [
    '#!/usr/bin/env bash',
    '# node apps/no-existe/src/x.ts',
    'node apps/web-dashboard/server/x.ts',
  ].join('\n');
  const stripped = stripComments(shell, '.sh');
  assert.ok(!stripped.includes('no-existe'), 'el comentario se elimina');
  assert.ok(stripped.includes('web-dashboard'), 'el comando real se conserva');
});

test('los comentarios de bloque TS tampoco', () => {
  const ts = ['/* node apps/no-existe/x.ts */', 'const a = 1;'].join('\n');
  assert.ok(!stripComments(ts, '.ts').includes('no-existe'));
});

test('el repo real no tiene comandos de arranque rotos', () => {
  const { broken } = auditStartCommands();
  assert.equal(
    broken.length,
    0,
    `comandos rotos:\n${broken.map((b) => `  · ${b.file}:${b.line} → ${b.reference}`).join('\n')}`,
  );
});
