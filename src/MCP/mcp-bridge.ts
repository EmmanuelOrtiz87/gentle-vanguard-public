#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { runSync, runNpxTsxSync } from '../../adapters/command-runner.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..');
const CONFIG_PATH = join(ROOT, 'config', 'orchestrator.json');

interface MCPIntegrationStatus {
  configured: boolean;
  skillServer: boolean;
  path: string | null;
}

interface ToolConfigMap {
  [key: string]: string;
}

const TOOL_CONFIGS: ToolConfigMap = {
  cursor: '.cursor/config.json',
  windsurf: '.windsurf/config.json',
  cline: '.cline/config.json',
  opencode: 'opencode.json',
};

function getToolMCPConfigPath(tool: string): string | null {
  const relPath = TOOL_CONFIGS[tool];
  if (!relPath) return null;
  return join(ROOT, relPath);
}

function readJson<T = Record<string, unknown>>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function testMCPIntegration(tool: string): MCPIntegrationStatus {
  const configPath = getToolMCPConfigPath(tool);
  if (!configPath || !existsSync(configPath)) {
    return { configured: false, skillServer: false, path: configPath };
  }
  const content = readJson(configPath);
  if (!content) {
    return { configured: false, skillServer: false, path: configPath };
  }
  const hasMCP = 'mcpServers' in content;
  const hasSkills =
    hasMCP && 'gentle-vanguard-skills' in (content.mcpServers as Record<string, unknown>);
  return { configured: hasMCP, skillServer: hasSkills, path: configPath };
}

function testSkillServer(): boolean {
  // Auto-detect if running from src/ or dist/ and adjust path
  const isSrc = __filename.includes('src/mcp') || __filename.includes('src\\mcp');
  const serverPath = isSrc
    ? join(ROOT, '..', 'dist', 'scripts', 'mcp', 'skill-server.js')
    : join(ROOT, 'dist', 'scripts', 'mcp', 'skill-server.js');
  if (existsSync(serverPath)) {
    console.log('  skill-server.js: OK');
    return true;
  }
  console.log('  skill-server.js: NOT COMPILED (run: pnpm build:mcp)');
  return false;
}

function getDetectedToolName(): string {
  const r = runNpxTsxSync('src/detect-tool.ts', ['--json'], { cwd: ROOT });
  if (r.status !== 0 || r.error) {
    console.error('Failed to detect tool, falling back to unknown');
    return 'unknown';
  }
  try {
    const parsed = JSON.parse(r.stdout.trim());
    return parsed.name || 'unknown';
  } catch {
    return 'unknown';
  }
}

function invokeMCPSetup(tool: string): void {
  const configPath = getToolMCPConfigPath(tool);
  if (!configPath) {
    console.warn(`Unknown tool: ${tool}`);
    return;
  }
  if (!existsSync(configPath)) {
    console.warn(`Config not found: ${configPath}`);
    return;
  }

  const existing = readJson(configPath);
  if (!existing) return;

  if ('mcpServers' in existing) {
    console.log(`[${tool}] MCP already configured in ${configPath}`);
    return;
  }

  const mcpBlock = {
    mcpServers: {
      'gentle-vanguard-skills': {
        command: 'node',
        args: ['dist/scripts/mcp/skill-server.js'],
        description: '143+ skills via MCP: list_skills, get_skill, search_skills',
      },
      engram: {
        command: 'engram',
        args: ['mcp', '--tools=agent'],
        description: 'Persistent memory Engram via MCP',
      },
      codegraph: {
        command: 'codegraph',
        args: ['serve', '--mcp'],
        description: 'CodeGraph: indexed code analysis',
      },
    },
  };

  const merged = { ...existing, ...mcpBlock };
  writeJson(configPath, merged);
  console.log(`[${tool}] MCP bridge configured in ${configPath}`);
}

function actionStatus(): void {
  const detected = getDetectedToolName();
  console.log(`Detected tool: ${detected}`);
  console.log('');
  console.log('MCP Bridge Status:');
  for (const tool of ['cursor', 'windsurf', 'cline']) {
    const s = testMCPIntegration(tool);
    const icon = s.skillServer ? '[OK]' : s.configured ? '[WARN]' : '[MISSING]';
    console.log(`  ${icon} ${tool} \u2014 skills:${s.skillServer} | config:${s.configured}`);
  }
  console.log('  [i] opencode \u2014 native skills (no MCP)');
  console.log('');
  console.log('Skill server:');
  testSkillServer();
}

function actionSetup(allTools: boolean, tool: string): void {
  const targets: string[] = allTools
    ? ['cursor', 'windsurf', 'cline']
    : tool
      ? [tool]
      : [getDetectedToolName()];

  for (const t of targets) {
    invokeMCPSetup(t);
  }

  if (!existsSync(CONFIG_PATH)) {
    console.error('orchestrator.json not found');
    return;
  }

  const orchestrator = readJson<Record<string, unknown>>(CONFIG_PATH);
  if (!orchestrator) return;

  const toolProfiles = orchestrator.toolProfiles as
    Record<string, Record<string, unknown>> | undefined;
  if (toolProfiles) {
    for (const t of targets) {
      if (toolProfiles[t]) {
        toolProfiles[t].mcpBridge = 'src/integrations/mcp-bridge.ts';
      }
    }
    writeJson(CONFIG_PATH, orchestrator);
    console.log('orchestrator.json updated with mcpBridge');
  }
}

function actionVerify(): boolean {
  let allOk = true;
  const mcpTools = ['cursor', 'windsurf', 'cline'];
  for (const tool of mcpTools) {
    const s = testMCPIntegration(tool);
    if (!s.skillServer) {
      allOk = false;
      console.log(`  [FAIL] ${tool} \u2014 MCP not configured`);
    } else {
      console.log(`  [OK] ${tool} \u2014 MCP configured`);
    }
  }
  console.log('  [i] opencode \u2014 uses native skills (no MCP)');

  if (!testSkillServer()) {
    allOk = false;
  }

  if (allOk) {
    console.log('Bridge status: OK');
  } else {
    console.log('Bridge status: INCOMPLETE');
  }
  return allOk;
}

function actionLaunch(): void {
  const serverPath = join(ROOT, 'dist', 'scripts', 'mcp', 'skill-server.js');
  if (!existsSync(serverPath)) {
    console.log('Compiling skill server...');
    const build = runSync('pnpm', ['run', 'build:mcp'], { cwd: ROOT });
    if (build.status !== 0) {
      console.error('Build failed');
      process.exit(1);
    }
  }
  console.log('Launching MCP skill server...');
  const launch = runSync('node', [serverPath], { cwd: ROOT });
  if (launch.status !== 0) {
    console.error(`Failed to launch: ${launch.error?.message ?? launch.stderr}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const action = args.find((a) => !a.startsWith('-')) || 'status';
  const toolIdx = args.indexOf('--tool');
  const tool = toolIdx >= 0 && args[toolIdx + 1] ? args[toolIdx + 1] : '';
  const allTools = args.includes('--all-tools') || args.includes('--all');

  switch (action) {
    case 'status':
      actionStatus();
      break;
    case 'setup':
      actionSetup(allTools, tool);
      break;
    case 'verify':
      if (!actionVerify()) process.exit(1);
      break;
    case 'launch':
      actionLaunch();
      break;
    default:
      console.error(`Unknown action: ${action}. Valid: status, setup, verify, launch`);
      process.exit(1);
  }

  // Ensure the script exits after completing the action
  process.exit(0);
}
