/**
 * codegraph-paths.ts — resolución única del entry JS de codegraph para MCP.
 *
 * POR QUE (2026-11-24): el canon `.mcp.json` declaraba `"command": "codegraph"`,
 * que en Windows resuelve al shim `codegraph.cmd` del npm global. Todo host que
 * lee el canon (Qoder, MiniMax, ZCode) lanza entonces `cmd.exe /d /s /c
 * "codegraph ..."` en cada (re)conexión MCP — una ventana de consola que el
 * host no oculta. Medido en `.runtime/console-flash-*.jsonl` con padre
 * Qoder.exe. La cadena de autostart propia ya spawna `node <codegraph.js>`
 * directamente para el mismo motivo (ver codegraph-mcp-server-start.ts): un
 * solo resolver para los dos consumidores.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

/** Entry JS real (dist/bin/codegraph.js) del paquete; '' si no se puede resolver. */
export function resolveCodeGraphJs(): string {
  try {
    const pkgJson = require.resolve('@colbymchenry/codegraph/package.json');
    const pkg = JSON.parse(readFileSync(pkgJson, 'utf-8')) as {
      bin?: string | Record<string, string>;
    };
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.codegraph;
    if (bin) {
      // Prefer the repo symlink (node_modules/<pkg>) over the pnpm store path:
      // require.resolve dereferences to .pnpm/<pkg>@<version>/…, which breaks
      // when the version bumps. The symlink follows the install.
      const stable = join(REPO_ROOT, 'node_modules', '@colbymchenry', 'codegraph', bin);
      return existsSync(stable) ? stable : join(dirname(pkgJson), bin);
    }
  } catch {
    // fall through to the global npm install
  }
  const globalRoot =
    process.platform === 'win32'
      ? join(process.env.APPDATA || '', 'npm', 'node_modules')
      : '/usr/local/lib/node_modules';
  const candidate = join(globalRoot, '@colbymchenry', 'codegraph', 'dist', 'bin', 'codegraph.js');
  if (existsSync(candidate)) return candidate;
  return '';
}

export interface CodegraphMcpEntry {
  command: string;
  args: string[];
  type: string;
  description: string;
}

/**
 * Entry MCP del canon. Con el JS resuelto, `node <codegraph.js>` evita el shim
 * `.cmd` (y con él el cmd.exe de cada host). Sin resolución cae al binario de
 * PATH para no dejar el servidor inalcanzable, pero ese fallback es el que
 * reproduce la ventana — el gate `hidden-spawns` lo detecta.
 */
export function codegraphMcpEntry(projectRoot: string): CodegraphMcpEntry {
  const jsEntry = resolveCodeGraphJs();
  const description = 'CodeGraph: indexed code intelligence and knowledge graph';
  if (jsEntry) {
    return {
      command: process.platform === 'win32' ? process.execPath : 'node',
      args: [jsEntry, 'serve', '--mcp', '--path', projectRoot],
      type: 'stdio',
      description,
    };
  }
  return {
    command: 'codegraph',
    args: ['serve', '--mcp', '--path', projectRoot],
    type: 'stdio',
    description,
  };
}
