import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repo = resolve(import.meta.dirname, '../..');
const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const canonical = {
  generatedAt: '2026-11-22T20:00:00.000Z',
  packageVersion: '4.5.0-fixture',
  nexus: { tables: 45 },
  extraEvidence: { source: 'real filesystem fixture' },
};

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'gv-stack-mcp-facts-'));
}
function put(root: string, value: unknown, directory = 'docs/generated'): void {
  const dir = join(root, directory);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'stack-facts.json'), JSON.stringify(value));
}
async function read(root: string) {
  const { readStackFacts } = await import('../../src/mcp/stack-facts-reader.js');
  return readStackFacts(root);
}
async function rejectFacts(root: string): Promise<void> {
  // Resolve the reader outside the rejection assertion: a missing implementation
  // must fail the test, never masquerade as correct invalid-input rejection.
  const { readStackFacts } = await import('../../src/mcp/stack-facts-reader.js');
  assert.throws(
    () => readStackFacts(root),
    /stack.facts|stack:facts|generated|invalid|schema|json/i,
  );
}
async function callInfo(root: string) {
  // SDK transport launches node directly with windowsHide on Windows, and closes it.
  // The absolute tsx loader remains resolvable when cwd is the isolated temp root.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', loader, join(repo, 'src/mcp/stack-mcp-server.ts')],
    cwd: root,
    stderr: 'ignore',
  });
  const client = new Client({ name: 'stack-facts-causal-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    return await client.callTool({ name: 'stack_info', arguments: {} }, undefined, {
      timeout: 15_000,
    });
  } finally {
    await client.close();
    await transport.close();
  }
}

test('canonical generated facts preserve measured fields and ignore obsolete config snapshot', async () => {
  const root = tempRoot();
  try {
    put(root, canonical);
    put(root, { ...canonical, packageVersion: 'obsolete-config' }, 'config');
    assert.deepEqual(await read(root), canonical);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('missing canonical facts reject even if an obsolete config snapshot exists', async () => {
  const root = tempRoot();
  try {
    put(root, canonical, 'config');
    await rejectFacts(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('corrupt canonical JSON rejects instead of synthesizing facts', async () => {
  const root = tempRoot();
  try {
    put(root, canonical);
    writeFileSync(join(root, 'docs/generated/stack-facts.json'), '{broken');
    await rejectFacts(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const invalid of [
  {},
  { ...canonical, generatedAt: 'yesterday' },
  { ...canonical, packageVersion: '' },
]) {
  test(`invalid canonical facts reject: ${JSON.stringify(invalid)}`, async () => {
    const root = tempRoot();
    try {
      put(root, invalid);
      await rejectFacts(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test(
  'real stdio stack_info returns canonical fields from its isolated working directory',
  { timeout: 20_000 },
  async () => {
    const root = tempRoot();
    try {
      put(root, canonical);
      const result = await callInfo(root);
      assert.notEqual(result.isError, true);
      const content = result.content as Array<{ type: string; text?: string }>;
      const data = JSON.parse(content.find((item) => item.type === 'text')!.text!);
      assert.deepEqual(data.facts, canonical);
      assert.equal(data.appsDetected, 0, 'fixture root contains no application directories');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  'real stdio stack_info reports missing facts as an MCP error with no invented version',
  { timeout: 20_000 },
  async () => {
    const root = tempRoot();
    try {
      const result = await callInfo(root);
      assert.equal(result.isError, true);
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content.map((item) => item.text ?? '').join('\n');
      assert.match(text, /stack.facts|stack:facts|generated/i);
      assert.doesNotMatch(text, /"version"\s*:\s*"unknown"|datos sinteticos/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
