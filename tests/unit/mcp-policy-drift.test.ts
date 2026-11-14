#!/usr/bin/env node
/**
 * Unit Tests: MCP policy drift gate (src/tools/mcp-doctor.ts::checkPolicy)
 *
 * Por que existe: un gate que solo sabe decir "OK" es decorativo. Estos tests
 * prueban que detecta las tres clases de deriva que ya ocurrieron o pueden
 * ocurrir, con el caso historico real incluido:
 *
 *   1. `memory` figuraba `disabled-by-policy` en la politica y `enabled: true`
 *      en la config. Nadie se enteraba porque nada comparaba las dos fuentes.
 *   2. Una capacidad configurada que no figura en la politica (opera sin
 *      politica documentada: presupuesto de prompt y ciclo de vida sin duenio).
 *   3. Un `always-on` que desaparece de la config (memoria del proyecto off sin
 *      que nada avise).
 *
 * El test corre contra un cwd temporal: nunca toca la config real del stack.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPolicy } from '../../src/tools/mcp-doctor.ts';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

function fixture(mutate: (policy: PolicyFile) => void, servers: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'gv-mcp-policy-'));
  mkdirSync(join(dir, 'config'), { recursive: true });
  const policy = JSON.parse(
    readFileSync(join(ROOT, 'config', 'mcp-lifecycle-policy.json'), 'utf8'),
  ) as PolicyFile;
  mutate(policy);
  writeFileSync(join(dir, 'config', 'mcp-lifecycle-policy.json'), JSON.stringify(policy, null, 2));
  writeFileSync(
    join(dir, 'config', 'mcp-lifecycle-policy.schema.json'),
    readFileSync(join(ROOT, 'config', 'mcp-lifecycle-policy.schema.json'), 'utf8'),
  );
  writeFileSync(join(dir, 'opencode.json'), JSON.stringify({ mcp: { servers } }, null, 2));
  return dir;
}

interface PolicyFile {
  servers: Record<string, { activation?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

test('checkPolicy: detecta disabled-by-policy con el server enabled (caso memory)', () => {
  const dir = fixture(
    (p) => {
      p.servers.memory.activation = 'disabled-by-policy';
    },
    { memory: { type: 'local', command: ['memory.exe'], enabled: true } },
  );
  try {
    const drift = checkPolicy(dir);
    assert.equal(drift.ok, false, 'deberia fallar');
    assert.ok(
      drift.problems.some((p) => p.includes('[deriva] memory')),
      `esperaba deriva de memory, obtuve: ${drift.problems.join(' | ')}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkPolicy: detecta una capacidad configurada sin entrada en la politica', () => {
  const dir = fixture(() => {}, {
    fantasma: { type: 'local', command: ['ghost.exe'], enabled: true },
  });
  try {
    const drift = checkPolicy(dir);
    assert.equal(drift.ok, false, 'deberia fallar');
    assert.ok(
      drift.problems.some((p) => p.includes('fantasma') && p.includes('[politica]')),
      `esperaba falta de politica para fantasma, obtuve: ${drift.problems.join(' | ')}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkPolicy: detecta un always-on ausente de la config', () => {
  const dir = fixture(
    (p) => {
      p.servers.codegraph.activation = 'always-on';
    },
    { engram: { type: 'local', command: ['engram.exe'], enabled: true } },
  );
  try {
    const drift = checkPolicy(dir);
    assert.equal(drift.ok, false, 'deberia fallar');
    assert.ok(
      drift.problems.some((p) => p.includes('[deriva] codegraph')),
      `esperaba deriva de codegraph, obtuve: ${drift.problems.join(' | ')}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkPolicy: detecta un enum invalido (schema)', () => {
  const dir = fixture(
    (p) => {
      p.servers.engram.activation = 'siempre-encendido';
    },
    { engram: { type: 'local', command: ['engram.exe'], enabled: true } },
  );
  try {
    const drift = checkPolicy(dir);
    assert.equal(drift.ok, false, 'deberia fallar por enum');
    assert.ok(
      drift.problems.some((p) => p.includes('[schema] engram.activation')),
      `esperaba problema de schema, obtuve: ${drift.problems.join(' | ')}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkPolicy: la politica real del stack no tiene deriva', () => {
  // Guard de estado: si esto falla, alguien configuro un MCP sin politica o
  // dejo la politica contradiciendo opencode.json.
  const drift = checkPolicy(ROOT);
  assert.equal(drift.ok, true, `deriva real: ${drift.problems.join(' | ')}`);
});
