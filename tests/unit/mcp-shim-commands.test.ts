#!/usr/bin/env node
/**
 * Unit Tests: hidden-spawns / comandos MCP con shim .cmd.
 *
 * Regresión 2026-11-24: `.mcp.json` declaraba `"command": "codegraph"` (shim
 * `codegraph.cmd` del npm global) y CADA host que lee el canon abría un cmd.exe
 * al conectar el MCP. El gate miraba solo el código del repo, no las configs
 * que consumen los hosts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectDeclaredServers,
  resolvesToShim,
} from '../../src/core/watchtower/checks-security.js';

test('collectDeclaredServers: lee mcpServers, mcp.servers y aplica shimWaiver', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-mcp-shim-'));
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(
    join(root, '.mcp.json'),
    JSON.stringify({ mcpServers: { codegraph: { command: 'codegraph' } } }),
  );
  mkdirSync(join(root, '.zcode'), { recursive: true });
  writeFileSync(
    join(root, '.zcode', 'config.json'),
    JSON.stringify({ mcp: { servers: { stack: { command: 'node' } } } }),
  );
  writeFileSync(
    join(root, 'config', 'mcp-registry.json'),
    JSON.stringify({
      servers: [
        { name: 'context7', command: 'npx', shimWaiver: 'instala on-demand' },
        { name: 'ok', command: 'node' },
      ],
    }),
  );
  const servers = collectDeclaredServers(root);
  assert.deepEqual(
    servers.map((s) => s.command).sort(),
    ['codegraph', 'node', 'node', 'npx'],
  );
  assert.equal(servers.find((s) => s.name.endsWith('context7'))?.shimWaiver, 'instala on-demand');
});

test(
  'resolvesToShim: bare command con .cmd en PATH => shim; .exe => null; ruta explícita => null',
  { skip: process.platform !== 'win32' },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'gv-path-'));
    writeFileSync(join(dir, 'fakeshim.cmd'), '@echo off\r\n');
    writeFileSync(join(dir, 'realbin.exe'), '');
    const original = process.env.PATH;
    process.env.PATH = `${dir};${original ?? ''}`;
    try {
      assert.match(resolvesToShim('fakeshim') ?? '', /fakeshim\.cmd$/i);
      assert.equal(resolvesToShim('realbin'), null);
      assert.equal(resolvesToShim('C:\\Windows\\System32\\cmd.exe'), null);
      assert.equal(resolvesToShim('node.exe'), null);
    } finally {
      process.env.PATH = original;
    }
  },
);
