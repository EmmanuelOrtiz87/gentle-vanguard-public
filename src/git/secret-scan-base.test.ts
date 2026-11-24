/**
 * Contrato del rango del escaneo de secretos (meta-auditoría 2026-11-20, backlog #3).
 *
 * El fix "escanear el rango completo en el primer push de una rama nueva"
 * vivía embebido en el composite del pre-push: no había forma de probarlo.
 * Estos tests son el autotest que muerde: sin ellos, el rango podría volver
 * a ser HEAD~1 y nadie lo notaría hasta que un secreto saliera pusheado.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { resolveSecretScanRange, type GitProbe } from './secret-scan-base.js';

/** Git simulado: responde por prefijo de comando. */
function fakeGit(responses: Record<string, string | null>): GitProbe {
  return (args: string[]) => {
    const key = args.join(' ');
    for (const [pattern, value] of Object.entries(responses)) {
      if (key.includes(pattern)) return value;
    }
    return null;
  };
}

test('rama ya publicada: la base es el remoto (solo lo que el remoto no tiene)', () => {
  const range = resolveSecretScanRange(
    fakeGit({
      'rev-parse --abbrev-ref HEAD': 'feature/nueva\n',
      'rev-parse --verify --quiet origin/feature/nueva': 'abc123\n',
      'rev-list --count origin/feature/nueva..HEAD': '2\n',
    }),
  );
  assert.equal(range.base, 'origin/feature/nueva');
  assert.equal(range.commits, 2);
  assert.match(range.reason, /ya publicada/);
});

test('rama nueva: la base es el fork-point con origin/main y cubre TODOS los commits', () => {
  const range = resolveSecretScanRange(
    fakeGit({
      'rev-parse --abbrev-ref HEAD': 'feature/hotfix\n',
      'rev-parse --verify --quiet origin/feature/hotfix': null,
      'rev-parse --verify --quiet origin/main': 'main-sha\n',
      'merge-base origin/main HEAD': 'fork-sha\n',
      'rev-list --count fork-sha..HEAD': '5\n',
    }),
  );
  assert.equal(range.base, 'fork-sha');
  assert.equal(range.commits, 5);
  assert.match(range.reason, /rango COMPLETO/);
});

test('sin remoto: HEAD~1 y el motivo declara que NO se pudo saber el rango completo', () => {
  const range = resolveSecretScanRange(
    fakeGit({
      'rev-parse --abbrev-ref HEAD': 'solo-local\n',
      'rev-parse --verify --quiet origin/solo-local': null,
      'rev-parse --verify --quiet origin/main': null,
      'rev-list --count HEAD~1..HEAD': '1\n',
    }),
  );
  assert.equal(range.base, 'HEAD~1');
  assert.match(range.reason, /el último commit/);
});

test('la rama nunca puede volver a HEAD~1 cuando existe origin/main (el bug original)', () => {
  const range = resolveSecretScanRange(
    fakeGit({
      'rev-parse --abbrev-ref HEAD': 'feature/x\n',
      'rev-parse --verify --quiet origin/feature/x': null,
      'rev-parse --verify --quiet origin/main': 'main-sha\n',
      'merge-base origin/main HEAD': 'fork\n',
    }),
  );
  assert.notEqual(range.base, 'HEAD~1');
});
