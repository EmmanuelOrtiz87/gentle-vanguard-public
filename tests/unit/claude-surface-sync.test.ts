import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SRC = pathToFileURL(resolve(ROOT, 'src', 'tools', 'claude-surface-sync.ts')).href;

type Mod = typeof import('../../src/tools/claude-surface-sync.js');

async function load(): Promise<Mod> {
  return (await import(SRC)) as Mod;
}

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'claude-surface-'));
  mkdirSync(join(dir, 'src', 'tools'), { recursive: true });
  mkdirSync(join(dir, 'skills', 'demo-skill'), { recursive: true });
  writeFileSync(join(dir, 'AGENTS.md'), '# agents\n');
  writeFileSync(join(dir, 'src', 'tools', 'pre-process-input.ts'), '// hook\n');
  writeFileSync(join(dir, 'skills', 'demo-skill', 'SKILL.md'), '# demo\n');
  return dir;
}

describe('claude-surface-sync', () => {
  it('detecta rutas muertas y no cuenta globs como rutas', async () => {
    const mod = await load();
    const root = tempRepo();
    try {
      const dead = mod.findDeadPaths(root, {
        a: 'src/tools/pre-process-input.ts',
        b: 'src/pre-process-input.ts',
        c: 'skills/*/SKILL.md',
        d: 'https://example.com/x.md',
      });
      assert.deepEqual(dead, ['src/pre-process-input.ts']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('aplica las correcciones declaradas y deja lo no resoluble sin inventar', async () => {
    const mod = await load();
    const root = tempRepo();
    try {
      const fixed = mod.fixStructure(
        root,
        { preRouting: 'src/pre-process-input.ts', load: ['skills/docker-devops-skill/SKILL.md'] },
        [],
      ) as Record<string, unknown>;
      assert.equal(fixed.preRouting, 'src/tools/pre-process-input.ts');
      // El destino del fix no existe en este repo de prueba: no se fabrica.
      assert.deepEqual(fixed.load, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('check falla cuando hay una ruta muerta y pasa cuando todas resuelven', async () => {
    const mod = await load();
    const root = tempRepo();
    try {
      mkdirSync(join(root, '.claude'), { recursive: true });
      writeFileSync(
        join(root, '.claude', 'settings.json'),
        JSON.stringify({ canonicalEntryPoint: 'src/pre-process-input.ts' }),
      );
      const bad = mod.checkClaudeSurface(root);
      assert.equal(bad.ok, false);
      assert.ok(bad.deadPaths.includes('src/pre-process-input.ts'));

      writeFileSync(
        join(root, '.claude', 'settings.json'),
        JSON.stringify({ canonicalEntryPoint: 'src/tools/pre-process-input.ts' }),
      );
      const good = mod.checkClaudeSurface(root);
      assert.equal(good.deadPaths.length, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('no reporta como roto un junction que resuelve', async () => {
    const mod = await load();
    const root = tempRepo();
    try {
      mkdirSync(join(root, '.claude', 'skills'), { recursive: true });
      writeFileSync(join(root, '.claude', 'skills', 'real.md'), 'ok');
      assert.deepEqual(mod.brokenSkillLinks(root), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
