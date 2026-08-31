#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawn } from 'child_process';
import { runSync } from '../../adapters/command-runner.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '../..');
const REGISTRY_PATH = join(ROOT, 'config', 'mcp-registry.json');
const LOCK_DIR = join(ROOT, '.runtime', 'mcp');
const TEMPLATES_PATH = join(ROOT, 'config', 'mcp-templates.json');

if (!existsSync(LOCK_DIR)) mkdirSync(LOCK_DIR, { recursive: true });

let quiet = false;

// ── Interfaces ──────────────────────────────────────────────────────────

interface McpServer {
  name: string;
  type: string;
  transport: string;
  command: string;
  args: string[];
  enabled: boolean;
  autoStart: boolean;
  description: string;
}

interface Registry {
  version?: string;
  description?: string;
  servers: McpServer[];
}

interface McpTemplate {
  name: string;
  description: string;
  command: string;
  args: string[];
  transport: string;
  autoStart: boolean;
  defaultPath?: string | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function log(...msg: string[]) {
  if (!quiet) console.log(...msg);
}

function err(msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function readRegistry(): Registry {
  if (!existsSync(REGISTRY_PATH)) return { servers: [] };
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
  } catch {
    return { servers: [] };
  }
}

function writeRegistry(reg: Registry) {
  writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + '\n', 'utf-8');
}

function readTemplates(): { templates: McpTemplate[] } {
  if (!existsSync(TEMPLATES_PATH)) return { templates: [] };
  try {
    return JSON.parse(readFileSync(TEMPLATES_PATH, 'utf-8'));
  } catch {
    return { templates: [] };
  }
}

function getProc(name: string): { pid: number } | null {
  const lockFile = join(LOCK_DIR, `${name}.pid`);
  if (!existsSync(lockFile)) return null;
  const pidStr = readFileSync(lockFile, 'utf-8').trim();
  if (!/^\d+$/.test(pidStr)) return null;
  const pid = parseInt(pidStr, 10);
  try {
    process.kill(pid, 0);
    return { pid };
  } catch {
    try {
      unlinkSync(lockFile);
    } catch {
      /* ignore */
    }
    return null;
  }
}

function findServer(reg: Registry, name: string): McpServer | undefined {
  return reg.servers.find((s) => s.name === name);
}

function sleepSync(ms: number) {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

// ── Actions ─────────────────────────────────────────────────────────────

function actionRegister(
  name: string,
  command: string,
  args: string[],
  description: string,
  transport: string,
  autoStart: boolean,
) {
  const reg = readRegistry();
  if (findServer(reg, name)) err(`server '${name}' already registered`);
  const entry: McpServer = {
    name,
    type: 'user',
    transport,
    command,
    args: args ?? [],
    enabled: true,
    autoStart,
    description,
  };
  reg.servers.push(entry);
  writeRegistry(reg);
  log(`Registered MCP server: ${name}`);
}

function actionUnregister(name: string) {
  const reg = readRegistry();
  const before = reg.servers.length;
  reg.servers = reg.servers.filter((s) => s.name !== name);
  if (reg.servers.length === before) err(`server '${name}' not found`);
  writeRegistry(reg);
  log(`Unregistered MCP server: ${name}`);
}

function actionList() {
  const reg = readRegistry();
  if (reg.servers.length === 0) {
    console.log('No MCP servers registered.');
    return;
  }
  console.log(`MCP Servers (${reg.servers.length} registered):`);
  for (const s of reg.servers) {
    const proc = getProc(s.name);
    const status = proc ? 'RUNNING' : 'stopped';
    const icon = s.enabled ? '\u2705' : '\u23f8';
    const type = s.type === 'builtin' ? '\uD83D\uDD27' : '\uD83E\uDDEA';
    console.log(`  ${icon} ${type} ${s.name} [${status}]`);
    console.log(`       cmd: ${s.command} ${s.args.join(' ')}`);
    console.log(`       ${s.description}`);
  }
}

function actionHealth() {
  const reg = readRegistry();
  let allOk = true;
  for (const s of reg.servers) {
    const proc = getProc(s.name);
    if (proc) {
      log(`  \u2705 ${s.name} \u2014 PID ${proc.pid}, running`);
    } else if (s.autoStart) {
      log(`  \u274c ${s.name} \u2014 NOT running (autoStart)`);
      allOk = false;
    } else {
      log(`  \u23f8  ${s.name} \u2014 stopped (manual)`);
    }
  }
  if (allOk) log('All MCP servers healthy.');
  else log('Some MCP servers need attention.');
}

function actionStart(name: string) {
  const reg = readRegistry();
  const server = findServer(reg, name);
  if (!server) err(`server '${name}' not found`);
  const existing = getProc(name);
  if (existing) {
    log(`Server '${name}' already running (PID ${existing.pid})`);
    return;
  }
  if (!existsSync(LOCK_DIR)) mkdirSync(LOCK_DIR, { recursive: true });
  try {
    const child = spawn(server.command, server.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    writeFileSync(join(LOCK_DIR, `${name}.pid`), String(child.pid ?? ''), 'utf-8');
    log(`Started MCP server: ${name} (PID ${child.pid})`);
  } catch (e: unknown) {
    err(`failed to start '${name}': ${e instanceof Error ? e.message : String(e)}`);
  }
}

function actionStop(name: string) {
  const proc = getProc(name);
  if (!proc) {
    log(`Server '${name}' not running`);
    return;
  }
  try {
    process.kill(proc.pid, 'SIGTERM');
  } catch {
    /* ignore */
  }
  const lockFile = join(LOCK_DIR, `${name}.pid`);
  try {
    unlinkSync(lockFile);
  } catch {
    /* ignore */
  }
  log(`Stopped MCP server: ${name}`);
}

function actionRestart(name: string) {
  actionStop(name);
  sleepSync(500);
  actionStart(name);
}

function actionReload() {
  log('Reloading MCP registry from disk...');
  const reg = readRegistry();
  for (const s of reg.servers) {
    const proc = getProc(s.name);
    if (s.enabled && s.autoStart && !proc) {
      actionStart(s.name);
    } else if (!s.enabled && proc) {
      actionStop(s.name);
    }
  }
  log('MCP registry reloaded.');
}

function actionListTemplates() {
  const tpl = readTemplates();
  if (tpl.templates.length === 0) {
    log('No templates found (config/mcp-templates.json missing).');
    return;
  }
  console.log(`MCP Templates (${tpl.templates.length} available):`);
  for (const t of tpl.templates) {
    console.log(`  \uD83D\uDCE6 ${t.name}`);
    console.log(`       ${t.description}`);
    console.log(`       cmd: ${t.command} ${t.args.join(' ')}`);
  }
}

function actionQuickstart(templateName: string, path?: string, start?: boolean) {
  const tpl = readTemplates();
  const tmpl = tpl.templates.find((t) => t.name === templateName);
  if (!tmpl) err(`template '${templateName}' not found`);
  const resolvedPath = path ?? tmpl.defaultPath ?? undefined;
  const resolvedArgs = tmpl.args.map((a) => (resolvedPath ? a.replace('{path}', resolvedPath) : a));
  if (resolvedPath && resolvedPath !== '.') {
    const absPath = resolve(ROOT, resolvedPath);
    const parent = dirname(absPath);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  }
  actionRegister(
    tmpl.name,
    tmpl.command,
    resolvedArgs,
    tmpl.description,
    tmpl.transport,
    tmpl.autoStart,
  );
  if (start || tmpl.autoStart) actionStart(tmpl.name);
  log(`Quickstart complete: ${templateName} \u2014 registered and ready.`);
}

function actionCreate(name: string, lang: string, build?: boolean, reg?: boolean, start?: boolean) {
  const serverDir = join(ROOT, 'mcp-servers', name);
  if (existsSync(serverDir)) err(`directory '${serverDir}' already exists`);
  mkdirSync(serverDir, { recursive: true });

  const packageJson = (
    main: string,
    deps: Record<string, string>,
    devDeps?: Record<string, string>,
  ) =>
    JSON.stringify(
      {
        name,
        version: '1.0.0',
        description: `MCP server: ${name}`,
        main,
        scripts: { ...(devDeps ? { build: 'tsc' } : {}), start: `node ${main}` },
        dependencies: deps,
        ...(devDeps ? { devDependencies: devDeps } : {}),
      },
      null,
      2,
    );

  let buildCmd = '';
  let runCmd = '';
  let entryPoint = '';

  switch (lang) {
    case 'ts': {
      const srcDir = join(serverDir, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(
        join(serverDir, 'package.json'),
        packageJson(
          'dist/index.js',
          {
            '@modelcontextprotocol/sdk': '^1.0.0',
          },
          { typescript: '^5.5.0', '@types/node': '^20.0.0' },
        ) + '\n',
        'utf-8',
      );
      writeFileSync(
        join(serverDir, 'tsconfig.json'),
        JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              outDir: 'dist',
              rootDir: 'src',
              strict: true,
              declaration: true,
            },
            include: ['src'],
          },
          null,
          2,
        ) + '\n',
        'utf-8',
      );
      writeFileSync(
        join(srcDir, 'index.ts'),
        `import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: '${name}', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'hello', description: 'A simple hello world tool', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } }],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === 'hello') {
    return { content: [{ type: 'text', text: \`Hello, \${req.params.arguments?.name || 'world'}!\` }] };
  }
  throw new Error('Tool not found');
});

const transport = new StdioServerTransport();
await server.connect(transport);
`,
        'utf-8',
      );
      buildCmd = 'npm install && npx tsc';
      runCmd = 'node dist/index.js';
      entryPoint = 'dist/index.js';
      break;
    }
    case 'js': {
      writeFileSync(
        join(serverDir, 'package.json'),
        packageJson('index.js', {
          '@modelcontextprotocol/sdk': '^1.0.0',
        }) + '\n',
        'utf-8',
      );
      writeFileSync(
        join(serverDir, 'index.js'),
        `import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: '${name}', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'hello', description: 'A simple hello world tool', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } }],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === 'hello') {
    return { content: [{ type: 'text', text: 'Hello, ' + (req.params.arguments?.name || 'world') + '!' }] };
  }
  throw new Error('Tool not found');
});

const transport = new StdioServerTransport();
await server.connect(transport);
`,
        'utf-8',
      );
      buildCmd = 'npm install';
      runCmd = 'node index.js';
      entryPoint = 'index.js';
      break;
    }
    case 'py': {
      writeFileSync(
        join(serverDir, 'pyproject.toml'),
        `[build-system]
requires = ["setuptools>=68.0"]
build-backend = "setuptools.backends._legacy:_Backend"

[project]
name = "${name}"
version = "1.0.0"
description = "MCP server: ${name}"
requires-python = ">=3.10"
dependencies = ["mcp>=1.0.0"]
`,
        'utf-8',
      );
      writeFileSync(
        join(serverDir, 'server.py'),
        `from mcp.server import Server, NotificationOptions
from mcp.server.models import InitializationOptions
import mcp.server.stdio
import mcp.types as types

server = Server("${name}")

@server.list_tools()
async def handle_list_tools() -> list[types.Tool]:
    return [types.Tool(name="hello", description="A simple hello world tool", inputSchema={"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]})]

@server.call_tool()
async def handle_call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    if name == "hello":
        return [types.TextContent(type="text", text=f"Hello, {arguments.get('name', 'world')}!")]
    raise ValueError(f"Unknown tool: {name}")

async def main():
    async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, InitializationOptions(server_name="${name}", server_version="1.0.0"))

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
`,
        'utf-8',
      );
      buildCmd = 'pip install -e . 2>$null';
      runCmd = 'python server.py';
      entryPoint = 'server.py';
      break;
    }
    case 'go': {
      writeFileSync(
        join(serverDir, 'go.mod'),
        `module ${name}

go 1.21

require github.com/mark3labs/mcp-go v1.0.0
`,
        'utf-8',
      );
      writeFileSync(
        join(serverDir, 'main.go'),
        `package main

import (
	"context"
	"fmt"
	mcp "github.com/mark3labs/mcp-go/server"
)

func main() {
	s := mcp.NewServer(mcp.WithServerInfo("${name}", "1.0.0"))

	s.AddTool(mcp.NewTool("hello",
		mcp.WithDescription("A simple hello world tool"),
		mcp.WithString("name", mcp.Required(), mcp.Description("Your name")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		name, _ := req.Params.Arguments["name"].(string)
		if name == "" { name = "world" }
		return mcp.NewTextResult(fmt.Sprintf("Hello, %s!", name)), nil
	})

	if err := mcp.ServeStdio(s); err != nil {
		panic(err)
	}
}
`,
        'utf-8',
      );
      buildCmd = 'go mod tidy && go build -o bin/server .';
      runCmd = './bin/server';
      entryPoint = 'bin/server';
      break;
    }
    case 'rs': {
      const rsSrcDir = join(serverDir, 'src');
      mkdirSync(rsSrcDir, { recursive: true });
      writeFileSync(
        join(serverDir, 'Cargo.toml'),
        `[package]
name = "${name}"
version = "1.0.0"
edition = "2021"

[dependencies]
rmcp = "0.1"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
`,
        'utf-8',
      );
      writeFileSync(
        join(rsSrcDir, 'main.rs'),
        `use rmcp::{ServiceExt, model::*, service::Service};
use serde_json::json;
use tokio::io::{stdin, stdout};

#[derive(Debug, serde::Deserialize)]
struct HelloArgs { name: Option<String> }

#[derive(Debug)]
struct MyServer;

impl Service for MyServer {
    fn list_tools(&self) -> Vec<Tool> {
        vec![Tool {
            name: "hello".into(),
            description: Some("A simple hello world tool".into()),
            input_schema: Some(json!({
                "type": "object",
                "properties": { "name": { "type": "string" } },
                "required": ["name"]
            })),
        }]
    }

    fn call_tool(&self, tool_name: &str, args: serde_json::Value) -> Result<CallToolResult, CallToolError> {
        if tool_name == "hello" {
            let name = serde_json::from_value::<HelloArgs>(args)
                .ok()
                .and_then(|a| a.name)
                .unwrap_or_else(|| "world".into());
            return Ok(CallToolResult { content: vec![Content::Text(TextContent { text: format!("Hello, {name}!") })], is_error: false });
        }
        Err(CallToolError::unknown_tool(tool_name))
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let service = MyServer;
    service.serve(StdioTransport::new(stdin(), stdout())).await?;
    Ok(())
}
`,
        'utf-8',
      );
      buildCmd = 'cargo build';
      runCmd = `./target/debug/${name}`;
      entryPoint = `target/debug/${name}`;
      break;
    }
    default:
      err(`unsupported language: ${lang}`);
  }

  console.log(`MCP server scaffolded at: mcp-servers/${name} (${lang})`);

  if (build) {
    log(`  Building (${lang})...`);
    try {
      const parts = buildCmd.split(' ').filter(Boolean);
      const cmd = parts[0];
      const args = parts.slice(1);
      const r = runSync(cmd, args, { cwd: serverDir, stdio: 'inherit', timeout: 120000 });
      if (r.status !== 0) throw new Error(r.error?.message || r.stderr || 'build failed');
    } catch {
      err(`build failed for ${name}`);
    }
    log('  Build complete.');
  }

  if (reg || build || start) {
    let regCommand: string;
    let regArgs: string[];
    if (lang === 'go' || lang === 'rs') {
      regCommand = `mcp-servers/${name}/${entryPoint}`;
      regArgs = [];
    } else if (lang === 'py') {
      regCommand = 'python';
      regArgs = [`mcp-servers/${name}/${entryPoint}`];
    } else {
      regCommand = 'node';
      regArgs = [`mcp-servers/${name}/${entryPoint}`];
    }
    actionRegister(name, regCommand, regArgs, `MCP server: ${name}`, 'stdio', !!start);
    if (start) actionStart(name);
  }

  console.log(`  cd mcp-servers/${name}`);
  console.log(`  Build: ${buildCmd}`);
  console.log(`  Run:   ${runCmd}`);
  log(`MCP server created: ${name} (${lang})`);
}

// ── CLI Parsing ─────────────────────────────────────────────────────────

interface CliArgs {
  action: string;
  name?: string;
  command?: string;
  args: string[];
  description: string;
  transport: string;
  template?: string;
  path?: string;
  lang: string;
  autoStart: boolean;
  start: boolean;
  build: boolean;
  register: boolean;
  quiet: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const result: CliArgs = {
    action: 'list',
    args: [],
    description: '',
    transport: 'stdio',
    lang: 'ts',
    autoStart: false,
    start: false,
    build: false,
    register: false,
    quiet: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('-')) continue;
    const key = arg.replace(/^--?/, '').toLowerCase();
    const next = argv[i + 1];

    switch (key) {
      case 'action':
      case 'a':
        if (next && !next.startsWith('-')) {
          result.action = next;
          i++;
        }
        break;
      case 'name':
      case 'n':
        if (next && !next.startsWith('-')) {
          result.name = next;
          i++;
        }
        break;
      case 'command':
      case 'c':
        if (next && !next.startsWith('-')) {
          result.command = next;
          i++;
        }
        break;
      case 'args':
        if (next && !next.startsWith('-')) {
          result.args = next
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          i++;
        }
        break;
      case 'description':
      case 'dsc':
        if (next && !next.startsWith('-')) {
          result.description = next;
          i++;
        }
        break;
      case 'transport':
        if (next && !next.startsWith('-')) {
          result.transport = next;
          i++;
        }
        break;
      case 'template':
        if (next && !next.startsWith('-')) {
          result.template = next;
          i++;
        }
        break;
      case 'path':
      case 'p':
        if (next && !next.startsWith('-')) {
          result.path = next;
          i++;
        }
        break;
      case 'lang':
      case 'l':
        if (next && !next.startsWith('-')) {
          result.lang = next;
          i++;
        }
        break;
      case 'autostart':
        result.autoStart = true;
        break;
      case 'start':
        result.start = true;
        break;
      case 'build':
      case 'b':
        result.build = true;
        break;
      case 'register':
      case 'r':
        result.register = true;
        break;
      case 'quiet':
      case 'q':
        result.quiet = true;
        break;
    }
  }

  return result;
}

// ── Main ────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv);
  quiet = args.quiet;

  switch (args.action) {
    case 'register':
      if (!args.name) err('-Name is required');
      if (!args.command) err('-Command is required');
      actionRegister(
        args.name,
        args.command,
        args.args,
        args.description,
        args.transport,
        args.autoStart,
      );
      break;
    case 'unregister':
      if (!args.name) err('-Name is required');
      actionUnregister(args.name);
      break;
    case 'list':
      actionList();
      break;
    case 'health':
      actionHealth();
      break;
    case 'start':
      if (!args.name) err('-Name is required');
      actionStart(args.name);
      break;
    case 'stop':
      if (!args.name) err('-Name is required');
      actionStop(args.name);
      break;
    case 'restart':
      if (!args.name) err('-Name is required');
      actionRestart(args.name);
      break;
    case 'reload':
      actionReload();
      break;
    case 'list-templates':
      actionListTemplates();
      break;
    case 'quickstart':
      if (!args.template) err('-Template is required. Use list-templates to see available.');
      actionQuickstart(args.template, args.path, args.start);
      break;
    case 'create':
      if (!args.name) err('-Name is required');
      actionCreate(args.name, args.lang, args.build, args.register, args.start);
      break;
    default:
      err(
        `Unknown action: ${args.action}. Valid actions: register, unregister, list, start, stop, restart, health, reload, quickstart, list-templates, create`,
      );
  }
}
