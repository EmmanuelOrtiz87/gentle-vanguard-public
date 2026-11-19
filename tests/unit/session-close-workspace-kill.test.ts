/**
 * BL-2026-11-16 — kills de session-close con alcance de workspace.
 *
 * Incidente: el close de un worktree de Copilot (inventario vacío → fallback
 * KILL_TARGETS) mató con matchers globales el CodeGraph MCP de OTRA sesión
 * activa. El scope workspaceScoped exige que el command line del proceso
 * referencie la raíz de ESTE workspace; el fallo seguro pasa a ser un daemon
 * sobreviviente (inofensivo, lo recoge process-hygiene), nunca matar la
 * sesión ajena.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  workspaceRootFilter,
  isProcessRunning,
  waitForProcess,
  KILL_TARGETS,
} from '../../src/session/session-close/process.js';

test('workspaceRootFilter acepta rutas mixtas y protege workspaces vecinos', () => {
  const workspace = new RegExp(
    workspaceRootFilter(String.raw`C:\Workspace_local\gentle-vanguard`),
    'i',
  );
  assert.match(
    String.raw`node C:\Workspace_local\gentle-vanguard\apps\censor\server\server.mjs`,
    workspace,
  );
  assert.match('node C:/Workspace_local/gentle-vanguard/apps/censor/server/server.mjs', workspace);
  assert.doesNotMatch(
    'node C:/Workspace_local/gentle-vanguard-other/apps/censor/server/server.mjs',
    workspace,
  );
  const weird = new RegExp(workspaceRootFilter(String.raw`C:\dir(1)\repo+test`), 'i');
  assert.match('node "C:/dir(1)/repo+test/something.js"', weird);
  assert.match(`node "${resolve(process.cwd())}"`, new RegExp(workspaceRootFilter(), 'i'));
});

test('isProcessRunning scoped con matcher inexistente es false (no lanza)', () => {
  const r = isProcessRunning('zz-inexistente-bL-2026-11-16-zz', { workspaceScoped: true });
  assert.equal(r, false);
});

test('waitForProcess scoped expira rápido sin encontrar procesos ajenos', () => {
  const r = waitForProcess('zz-inexistente-bL-2026-11-16-zz', 1200, { workspaceScoped: true });
  assert.equal(r, false);
});

test('KILL_TARGETS conserva sus matchers específicos (no se rompe el inventario)', () => {
  const names = KILL_TARGETS.map((t) => t.name);
  for (const expected of ['CodeGraph MCP', 'Timeout Daemon', 'Apps Server']) {
    assert.ok(names.includes(expected), `falta ${expected}`);
  }
});
