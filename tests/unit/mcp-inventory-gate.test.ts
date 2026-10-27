import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runNpxTsxSync } from '../../src/core/run-command.ts';

const script = resolve('src/mcp/mcp-inventory.ts');

for (const scenario of ['unreachable', 'removed', 'initial failure', 'failed baseline update']) {
  test(`MCP gate fails closed for ${scenario}`, (t) => {
    const root = mkdtempSync(join(tmpdir(), 'gv-mcp-gate-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'config'), { recursive: true });
    mkdirSync(join(root, '.runtime/mcp-inventory'), { recursive: true });
    const baselinePath = join(root, '.runtime/mcp-inventory/baseline.json');
    const previous = JSON.stringify({ servers: [{ name: 'probe', source: 'mcp-registry', command: 'unused', tools: ['known-tool'] }] });
    if (scenario !== 'initial failure') writeFileSync(baselinePath, previous);
    writeFileSync(join(root, 'config/mcp-registry.json'), JSON.stringify({
      servers: scenario === 'removed' ? [] : [{
        name: 'probe', enabled: true, transport: 'stdio', command: 'gv-missing-mcp-executable-019823', args: [],
      }],
    }));
    const result = runNpxTsxSync(script, [scenario === 'failed baseline update' ? '--baseline' : '--diff'], {
      cwd: root, timeout: 10000,
    });
    assert.notEqual(result.status, null, 'the gate must terminate instead of timing out');
    assert.notEqual(result.status, 0, result.stderr);
    if (scenario === 'initial failure') assert.equal(existsSync(baselinePath), false);
    else assert.equal(readFileSync(baselinePath, 'utf8'), previous, 'failed capture preserves the trusted baseline');
  });
}

test('remote OAuth is reported as deferred coverage, never as a verified server', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'gv-mcp-oauth-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'opencode.json'), JSON.stringify({ mcp: {
    payment: { enabled: true, type: 'remote', url: 'https://example.invalid/mcp' },
  } }));
  const result = runNpxTsxSync(script, ['--diff'], { cwd: root, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const latest = JSON.parse(readFileSync(join(root, '.runtime/mcp-inventory/mcp-inventory-latest.json'), 'utf8'));
  assert.deepEqual(latest.coverage, { verified: 0, deferred: 1, failed: 0 });
});

for (const scenario of ['new server', 'removed tool', 'unchanged']) {
  test(`MCP gate handles a real protocol exchange: ${scenario}`, (t) => {
    const root = mkdtempSync(join(tmpdir(), 'gv-mcp-protocol-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const probe = join(root, 'probe.ts');
    writeFileSync(probe, `
      import { createInterface } from 'node:readline';
      createInterface({ input: process.stdin }).on('line', (line) => {
        const req = JSON.parse(line);
        if (req.id === undefined) return;
        const result = req.method === 'initialize'
          ? { protocolVersion: req.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'probe', version: '1' } }
          : { tools: [{ name: 'probe', inputSchema: { type: 'object', properties: {} } }] };
        console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }));
      });
    `);
    mkdirSync(join(root, 'config'));
    mkdirSync(join(root, '.runtime/mcp-inventory'), { recursive: true });
    writeFileSync(join(root, 'config/mcp-registry.json'), JSON.stringify({ servers: [{
      name: 'probe', enabled: true, transport: 'stdio', command: process.execPath,
      args: ['--import', import.meta.resolve('tsx'), probe],
    }] }));
    const baseline = { servers: scenario === 'new server' ? [] : [{
      name: 'probe', source: 'mcp-registry', tools: scenario === 'removed tool' ? ['probe', 'missing'] : ['probe'],
    }] };
    writeFileSync(join(root, '.runtime/mcp-inventory/baseline.json'), JSON.stringify(baseline));
    const result = runNpxTsxSync(script, ['--diff'], { cwd: root, timeout: 10000 });
    assert.equal(result.status, scenario === 'unchanged' ? 0 : 1, result.stderr);
    const latest = JSON.parse(readFileSync(join(root, '.runtime/mcp-inventory/mcp-inventory-latest.json'), 'utf8'));
    assert.deepEqual(latest.coverage, { verified: 1, deferred: 0, failed: 0 });
  });
}
