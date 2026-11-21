import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SRC = pathToFileURL(resolve(ROOT, 'src', 'session', 'session-expiry.ts')).href;

type Mod = typeof import('../../src/session/session-expiry.js');

async function load(): Promise<Mod> {
  return (await import(SRC)) as Mod;
}

function repoWithConfig(config: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'session-expiry-'));
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'config', 'session-autostart.config.json'), JSON.stringify(config));
  return dir;
}

describe('session-expiry', () => {
  it('lee sessionExpiryHours del config de autostart', async () => {
    const mod = await load();
    const root = repoWithConfig({ sessionExpiryHours: 8 });
    try {
      assert.equal(mod.resolveSessionExpiryHours(root), 8);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('el flag explicito gana por encima del config', async () => {
    const mod = await load();
    const root = repoWithConfig({ sessionExpiryHours: 8 });
    try {
      assert.equal(mod.resolveSessionExpiryHours(root, 48), 48);
      // Un valor explicito invalido se descarta: no hay "no expirar" por error.
      assert.equal(mod.resolveSessionExpiryHours(root, 0), 8);
      assert.equal(mod.resolveSessionExpiryHours(root, Number.NaN), 8);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('sin config usa el fallback y no inventa expiracion inmediata', async () => {
    const mod = await load();
    const root = mkdtempSync(join(tmpdir(), 'session-expiry-empty-'));
    try {
      // 24 h: el fallback historico del stack (constante interna del modulo).
      assert.equal(mod.resolveSessionExpiryHours(root), 24);
      const rootZero = repoWithConfig({ sessionExpiryHours: 0 });
      try {
        assert.equal(mod.resolveSessionExpiryHours(rootZero), 24);
      } finally {
        rmSync(rootZero, { recursive: true, force: true });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('CONTRATO: el config real del stack declara una expiracion usable', async () => {
    const mod = await load();
    const configured = mod.resolveSessionExpiryHours(ROOT);
    assert.ok(configured > 0, 'sessionExpiryHours debe estar declarado y ser > 0');
    // El consumidor existe de verdad: el sweeper usa el resolver, no la constante.
    const sweeper = await import(
      pathToFileURL(resolve(ROOT, 'src', 'session', 'stale-session-sweeper.ts')).href
    );
    assert.equal(sweeper.resolveSessionExpiryHours(ROOT), configured);
  });
});
