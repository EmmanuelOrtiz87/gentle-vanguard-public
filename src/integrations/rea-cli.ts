#!/usr/bin/env node
/**
 * rea-cli.ts — Native entry point for REA in the Gentle-Vanguard stack.
 *
 * Why a shim: REA 6.8.0 (the release that ships the `zcode` / `dsh` client
 * integrations and AgentEnv bundles) declares `node: ^22.23.4 || ^24.22.1 ||
 * >=26.12.1`. This machine runs Node 24.15.0, so `rea setup` and `rea doctor`
 * refuse to run even though the server itself starts. Instead of changing the
 * system runtime (MSI, admin) the stack keeps a portable Node 24.22.1 plus REA
 * 6.8.0 under `C:\Workspace_local\tools\`, the same place Ghidra/JDK/Android
 * live, and every supported client registration points at that toolchain.
 *
 * This shim gives the stack one stable command for the CLI and for MCP
 * registration: it forwards argv to the toolchain, injects the analysis-engine
 * environment when the caller has not set it, hides the child window, and
 * propagates the real exit code.
 *
 * Usage:
 *   npm run rea -- --version
 *   npm run rea -- doctor
 *   npm run rea -- setup --client zcode --yes
 *   node --import tsx src/integrations/rea-cli.ts mcp      # MCP stdio mode
 *
 * Overrides (portable machines / upgraded toolchain):
 *   GV_TOOLS_DIR   root holding the toolchain (default C:\Workspace_local\tools)
 *   GV_REA_NODE    portable node.exe
 *   GV_REA_ENTRY   rea-agents scripts/rea.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const TOOLS_DIR = process.env.GV_TOOLS_DIR ?? 'C:\\Workspace_local\\tools';
const NODE_EXE = process.env.GV_REA_NODE ?? join(TOOLS_DIR, 'node-v24.22.1', 'node.exe');
const REA_ENTRY =
  process.env.GV_REA_ENTRY ??
  join(TOOLS_DIR, 'rea-6.8.0', 'node_modules', 'rea-agents', 'scripts', 'rea.mjs');

/** Analysis-engine hints the REA provider checks for; never overwrite a caller value. */
const ENGINE_ENV: Record<string, string> = {
  GHIDRA_INSTALL_DIR: join(TOOLS_DIR, 'ghidra_12.1.4_PUBLIC'),
  JAVA_HOME: 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.101-hotspot',
  REA_ADB_PATH: join(TOOLS_DIR, 'android', 'platform-tools', 'adb.exe'),
  // Optional analysis engines installed as caller-supplied tools (doctor green on 2026-10-28).
  REA_WABT_BIN_DIRECTORY: join(TOOLS_DIR, 'wabt-1.0.42', 'bin'),
  REA_APKTOOL_COMMAND: join(TOOLS_DIR, 'apktool', 'apktool.cmd'),
  REA_JADX_MCP_JAR: join(TOOLS_DIR, 'jadx-headless-mcp', 'jadx-headless-mcp-0.7.1-all.jar'),
};

function fail(message: string): never {
  console.error(`[rea] ${message}`);
  process.exit(2);
}

for (const [label, path] of [
  ['portable Node 24.22.1', NODE_EXE],
  ['REA 6.8.0 entry', REA_ENTRY],
] as const) {
  if (!existsSync(path)) {
    fail(
      `${label} not found at ${path}. Reinstall the toolchain — see docs/stack-manual-modules.md §REA.`,
    );
  }
}

const env: NodeJS.ProcessEnv = { ...process.env };
for (const [key, value] of Object.entries(ENGINE_ENV)) {
  if (!env[key] && existsSync(value)) env[key] = value;
}

const result = spawnSync(NODE_EXE, [REA_ENTRY, ...process.argv.slice(2)], {
  stdio: 'inherit',
  windowsHide: true,
  env,
});

if (result.error) fail(`could not start REA: ${result.error.message}`);
process.exit(result.status ?? 1);
