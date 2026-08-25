import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { executeApprovedCommand } from '../../scripts/mcp/execution-worker.js';
import {
  getApprovedCommand,
  loadSkillExecutionPolicy,
  parseCommandField,
} from '../../scripts/mcp/skill-execution-policy.js';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('MCP skill execution policy', () => {
  it('keeps the MCP server off the raw shell execution path', () => {
    const server = readFileSync(resolve(ROOT, 'scripts', 'mcp', 'skill-server.ts'), 'utf-8');
    assert.equal(server.includes('runSyncShell'), false);
    assert.equal(server.includes('runSync('), false);
    assert.equal(server.includes('getApprovedCommand'), true);
  });

  it('has no command approvals by default', () => {
    const policy = loadSkillExecutionPolicy(resolve(ROOT, 'config', 'mcp-execution-policy.json'));
    assert.deepEqual(policy.skills, {});
  });

  it('extracts command metadata without executing it', () => {
    assert.equal(parseCommandField('---\ncommand: node task.js\n---\n'), 'node task.js');
  });

  it('requires an exact explicit approval for a command', () => {
    const policy = {
      version: 'test',
      skills: {
        safe: { command: 'node task.js', executable: process.execPath, args: ['task.js'] },
      },
    };

    assert.deepEqual(getApprovedCommand(policy, 'safe', 'node task.js'), policy.skills.safe);
    assert.equal(getApprovedCommand(policy, 'safe', 'node task.js && whoami'), undefined);
    assert.equal(getApprovedCommand(policy, 'unknown', 'node task.js'), undefined);
  });

  it('passes arguments as argv without shell interpretation', async () => {
    const result = await executeApprovedCommand({
      command: 'node argv',
      executable: process.execPath,
      args: ['-e', 'console.log(process.argv.slice(1).join("|"))', 'alpha && beta'],
      maxOutputBytes: 1024,
      timeoutMs: 5_000,
    });
    assert.equal(result.stdout.trim(), 'alpha && beta');
  });

  it('enforces timeout and output limits in the worker', async () => {
    const timedOut = await executeApprovedCommand({
      command: 'node timeout',
      executable: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 1000)'],
      timeoutMs: 50,
      maxOutputBytes: 1024,
    });
    assert.equal(timedOut.timedOut, true);

    const outputLimited = await executeApprovedCommand({
      command: 'node output',
      executable: process.execPath,
      args: ['-e', 'process.stdout.write("x".repeat(2048))'],
      timeoutMs: 5_000,
      maxOutputBytes: 128,
    });
    assert.equal(outputLimited.outputLimited, true);
  });

  it('fails closed for capabilities outside the restricted baseline', async () => {
    await assert.rejects(
      executeApprovedCommand({
        command: 'network',
        executable: process.execPath,
        args: [],
        network: true,
      }),
      /unavailable OS sandbox capabilities/,
    );
  });
});
