/**
 * duplicate-mechanism-gate — autotest (incluye el negativo que debe morder).
 *
 * El caso que motivó el gate (2026-11-24): el sync al repo público se re-hizo a mano
 * aunque `npm run publish:public` ya existía, y se escribió una segunda poda cuando
 * `sync-to-public.ts` ya podaba lo stale. Sin este check, esa clase no la ve nadie.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  computeDuplicates,
  findNewDuplicates,
  findScriptDuplicates,
  normalizeBasename,
} from '../../src/tools/duplicate-mechanism-gate.js';

test('detecta el mismo mecanismo con dos nombres de script npm', () => {
  const duplicates = findScriptDuplicates({
    'publish:public': 'node --import tsx src/infrastructure/sync-to-public.ts',
    'publish:mirror': 'node --import tsx src/infrastructure/sync-to-public.ts',
    'web:check': 'vitest run --config vitest.public-web.config.ts',
  });
  assert.equal(duplicates.length, 1);
  assert.deepEqual(duplicates[0].members, ['publish:mirror', 'publish:public']);
  assert.equal(duplicates[0].rule, 'R1');
});

test('NO marca como duplicado los subcomandos de una misma CLI', () => {
  const duplicates = findScriptDuplicates({
    'backlog:add': 'node --import tsx src/cli/backlog.ts add',
    'backlog:list': 'node --import tsx src/cli/backlog.ts list',
    'backlog:get': 'node --import tsx src/cli/backlog.ts get',
  });
  assert.equal(duplicates.length, 0);
});

test('normaliza el basename sin extension (index.ts -> index)', () => {
  assert.equal(normalizeBasename('src/session/index.ts'), 'index');
  assert.equal(normalizeBasename('src\\core\\Session-Autostart.ts'), 'sessionautostart');
});

test('ratchet: una duplicacion nueva bloquea, una tolerada no', () => {
  const command = 'node --import tsx src/infrastructure/sync-to-public.ts';
  const duplicates = findScriptDuplicates({
    'publish:public': command,
    'publish:mirror': command,
  });
  const key = `R1:src/infrastructure/sync-to-public.ts::${command}`;

  // Grupo tolerado que grew (le agregaron otro alias) => bloquea.
  const grown = findNewDuplicates(duplicates, {
    version: 1,
    tolerated: {
      [key]: { members: ['publish:public'], reason: 'alias tolerado' },
    },
  });
  assert.equal(grown.length, 1, 'el alias nuevo debe aparecer como duplicado fresco');
  assert.match(grown[0].reason, /grew|agregaron/);

  // Grupo tolerado tal cual => no bloquea.
  const tolerated = findNewDuplicates(duplicates, {
    version: 1,
    tolerated: {
      [key]: { members: ['publish:public', 'publish:mirror'], reason: 'alias tolerado' },
    },
  });
  assert.equal(tolerated.length, 0);

  // Grupo que el baseline no conoce => bloquea como duplicado nuevo.
  const unknown = findNewDuplicates(duplicates, { version: 1, tolerated: {} });
  assert.equal(unknown.length, 1);
  assert.match(unknown[0].reason, /nuevo/);
});

test('el estado real del repo no tiene duplicados frescos (ratchet en verde)', () => {
  const baseline = JSON.parse(
    readFileSync(
      new URL('../../config/baselines/duplicate-mechanism.json', import.meta.url),
      'utf8',
    ),
  ) as { tolerated: Record<string, { members: string[]; reason: string }> };
  const fresh = findNewDuplicates(computeDuplicates(), {
    version: 1,
    tolerated: baseline.tolerated,
  });
  assert.deepEqual(
    fresh.map((f) => f.group.members),
    [],
    'no debe haber duplicados fuera del baseline tolerado',
  );
});
