import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SRC = (name: string) => pathToFileURL(resolve(ROOT, 'src', name)).href;
const ADAPTERS = (name: string) => pathToFileURL(resolve(ROOT, 'adapters', name)).href;

describe('run-command', () => {
  it('source file exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src/core/run-command.ts')));
  });

  it('imports without error', async () => {
    const mod = await import(SRC('core/run-command.ts'));
    assert.ok(mod);
  });

  it('exports run, runSync, runSyncShell', async () => {
    const mod = await import(SRC('core/run-command.ts'));
    assert.strictEqual(typeof mod.run, 'function');
    assert.strictEqual(typeof mod.runSync, 'function');
    assert.strictEqual(typeof mod.runSyncShell, 'function');
  });

  it('runSync executes a command with argv array', async () => {
    const mod = await import(SRC('core/run-command.ts'));
    const isWin = process.platform === 'win32';
    const r = isWin
      ? mod.runSync('cmd', ['/c', 'echo', 'hello-run-command'])
      : mod.runSync('echo', ['hello-run-command']);
    assert.strictEqual(r.status, 0);
    assert.match(String(r.stdout), /hello-run-command/);
    assert.strictEqual(r.error, null);
  });

  it('runSync returns error info for a failing command', async () => {
    const mod = await import(SRC('core/run-command.ts'));
    const r = mod.runSync('cmd', ['/c', 'exit', '3'], { cwd: ROOT });
    assert.strictEqual(r.status, 3);
  });

  it('runSyncShell supports shell syntax (pipe)', async () => {
    const mod = await import(SRC('core/run-command.ts'));
    const isWin = process.platform === 'win32';
    const r = isWin
      ? mod.runSyncShell('echo shell-pipe-test | findstr shell-pipe-test')
      : mod.runSyncShell('echo shell-pipe-test | grep shell-pipe-test');
    assert.strictEqual(r.status, 0);
    assert.match(String(r.stdout), /shell-pipe-test/);
  });
});

describe('adapters', () => {
  it('Adapter.ts exists and exports base class', async () => {
    assert.ok(existsSync(resolve(ROOT, 'adapters/Adapter.ts')));
    const mod = await import(ADAPTERS('Adapter.ts'));
    assert.ok(mod.Adapter);
    assert.strictEqual(typeof mod.Adapter, 'function');
  });

  it('FormatAdapter extends Adapter and requires name', async () => {
    const { default: Adapter } = await import(ADAPTERS('Adapter.ts'));
    const { default: FormatAdapter } = await import(ADAPTERS('FormatAdapter.ts'));
    const a = new (FormatAdapter as any)('test-fmt');
    assert.ok(a instanceof Adapter);
    assert.strictEqual(a.name, 'test-fmt');
  });

  it('loadAdapters returns all three adapters', async () => {
    const { loadAdapters } = await import(ADAPTERS('index.ts'));
    const adapters = await loadAdapters();
    assert.ok(adapters.codexAdapter, 'codex adapter should load');
    assert.ok(adapters.windsurfAdapter, 'windsurf adapter should load');
    assert.ok(adapters.antigravityAdapter, 'antigravity adapter should load');
  });

  it('codex converter produces a JSON function definition', async () => {
    const { convertToCodex } = await import(ADAPTERS('index.ts'));
    const os = await import('node:os');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-adapter-test-'));
    const skill = path.join(tmp, 'SKILL.md');
    const out = path.join(tmp, 'out.json');
    fs.writeFileSync(skill, '---\nname: test-skill\ndescription: A test skill\ntrigger: test, demo\n---\n# Instructions\nDo the thing.\n');
    convertToCodex(skill, out);
    const parsed = JSON.parse(fs.readFileSync(out, 'utf-8'));
    assert.strictEqual(parsed.type, 'function');
    assert.strictEqual(parsed.function.name, 'test_skill');
    assert.ok(parsed.function.parameters.required.includes('task'));
  });

  it('windsurf converter creates plugin dir with plugin.json', async () => {
    const { convertToWindsurf } = await import(ADAPTERS('index.ts'));
    const os = await import('node:os');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-ws-adapter-test-'));
    const skill = path.join(tmp, 'SKILL.md');
    const outDir = path.join(tmp, 'plugins');
    fs.writeFileSync(skill, '---\nname: ws-skill\ndescription: A ws skill\ntrigger: ws\n---\n# Instructions\nDo the ws thing.\n');
    convertToWindsurf(skill, outDir);
    const pluginJson = path.join(outDir, 'ws-skill', 'plugin.json');
    assert.ok(fs.existsSync(pluginJson));
    const parsed = JSON.parse(fs.readFileSync(pluginJson, 'utf-8'));
    assert.strictEqual(parsed.name, 'ws-skill');
  });

  it('skill-export consumer source exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src/skill-export.ts')));
  });
});
