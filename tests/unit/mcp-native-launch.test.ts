import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runNpxTsxSync } from '../../src/core/run-command.ts';
import { resolveNativeEntry } from '../../src/tools/mcp-native-launch.ts';

const root = resolve(import.meta.dirname, '../..');

test('native MCP keeps argv and PID in the original Node process without a shell', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gv-native-mcp-'));
  try {
    const pkg = join(dir, 'memory-2.1.1/node_modules/@modelcontextprotocol/server-memory');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({
        name: '@modelcontextprotocol/server-memory',
        version: '2.1.1',
        type: 'module',
        bin: { 'mcp-server-memory': 'entry.js' },
      }),
    );
    writeFileSync(
      join(pkg, 'entry.js'),
      'console.log(JSON.stringify({pid:process.pid,ppid:process.ppid,args:process.argv.slice(2),memory:process.env.MEMORY_FILE_PATH}))',
    );
    const result = runNpxTsxSync(
      join(root, 'src/tools/mcp-native-launch.ts'),
      ['memory', 'space and & shell text'],
      { env: { GV_MCP_TOOLS_DIR: dir, MEMORY_FILE_PATH: join(dir, 'preserved.jsonl') } },
    );
    assert.equal(result.status, 0, result.stderr);
    const actual = JSON.parse(result.stdout);
    assert.equal(actual.ppid, process.pid, 'import must not introduce a child or shell');
    assert.deepEqual(actual.args, ['space and & shell text']);
    assert.equal(actual.memory, join(dir, 'preserved.jsonl'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('native MCP fails closed for missing versions and unsafe bin paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gv-native-mcp-'));
  try {
    assert.throws(() => resolveNativeEntry('memory', dir, root), /bootstrap/);
    const pkg = join(dir, 'memory-2.1.1/node_modules/@modelcontextprotocol/server-memory');
    mkdirSync(pkg, { recursive: true });
    const write = (version: string, bin: string) =>
      writeFileSync(
        join(pkg, 'package.json'),
        JSON.stringify({
          name: '@modelcontextprotocol/server-memory',
          version,
          bin: { 'mcp-server-memory': bin },
        }),
      );
    write('0.0.1', 'entry.js');
    assert.throws(() => resolveNativeEntry('memory', dir, root), /version/);
    write('2.1.1', '../outside.js');
    assert.throws(() => resolveNativeEntry('memory', dir, root), /Unsafe/);
    assert.throws(() => resolveNativeEntry('unexpected', dir, root), /Unknown/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('OpenCode affected MCP commands cannot regress to npm shims or npx', () => {
  const config = JSON.parse(readFileSync(join(root, 'opencode.json'), 'utf8'));
  assert.ok(config.mcp.servers['chrome-devtools'].command.includes('--no-usage-statistics'));
  for (const name of ['codegraph', 'chrome-devtools', 'memory', 'filesystem']) {
    const command = config.mcp.servers[name].command as string[];
    assert.deepEqual(command.slice(0, 5), [
      'node',
      '--import',
      'tsx',
      'src/tools/mcp-native-launch.ts',
      name,
    ]);
  }
});
