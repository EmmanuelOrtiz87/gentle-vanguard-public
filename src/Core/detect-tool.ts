#!/usr/bin/env node
/**
 * Detect Tool — detect which AI tool/agent is running and return standardized config.
 * TS migration of scripts/utilities/setup/DETECT/detect-tool.ps1
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pathToFileURL } from 'url';

export interface DetectedTool {
  name: string;
  source: string;
  configFile: string;
  promptFile: string;
  isClaude: boolean;
  isOpenCode: boolean;
  isCline: boolean;
  isCursor: boolean;
  isWindsurf: boolean;
  isContinueDev: boolean;
  isCopilot: boolean;
  isAntigravity: boolean;
  confidence: number;
  os: {
    platform: string;
    shell: string;
    pathSeparator: string;
    isWindows: boolean;
    isLinux: boolean;
    isMacOS: boolean;
  };
  instructions?: Record<string, string>;
}

const OS_INFO = getOsInfo();

function getOsInfo() {
  const platform = os.platform();
  return {
    platform: platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux',
    shell: platform === 'win32' ? 'powershell' : platform === 'darwin' ? 'zsh' : 'bash',
    pathSeparator: path.sep,
    isWindows: platform === 'win32',
    isLinux: platform === 'linux',
    isMacOS: platform === 'darwin',
  };
}

function getRepoRoot(): string {
  return process.env.GV_BASE_DIR || process.cwd();
}

function pathExists(filePath: string): boolean {
  try {
    return fs.existsSync(path.resolve(getRepoRoot(), filePath));
  } catch {
    return false;
  }
}

function getHomeDir(): string {
  return process.env.USERPROFILE || process.env.HOME || '';
}

export function getDetectedTool(): DetectedTool {
  const repoRoot = getRepoRoot();

  const tool: DetectedTool = {
    name: 'unknown',
    source: 'unknown',
    configFile: '',
    promptFile: '',
    isClaude: false,
    isOpenCode: false,
    isCline: false,
    isCursor: false,
    isWindsurf: false,
    isContinueDev: false,
    isCopilot: false,
    isAntigravity: false,
    confidence: 0,
    os: { ...OS_INFO },
  };

  // 1. Check OPENCODE env vars (most reliable for opencode)
  if (process.env.OPENCODE_SERVER_USERNAME) {
    tool.name = 'opencode';
    tool.source = 'env:OPENCODE_SERVER_USERNAME';
    tool.isOpenCode = true;
    tool.confidence = 100;
    tool.configFile = 'opencode.json';
    tool.promptFile = 'CLAUDE.md';
    return tool;
  }

  // 1b. Check for .opencode/ directory
  if (fs.existsSync(path.join(repoRoot, '.opencode'))) {
    tool.name = 'opencode';
    tool.source = 'dir:.opencode';
    tool.isOpenCode = true;
    tool.confidence = 85;
    tool.configFile = 'opencode.json';
    tool.promptFile = 'CLAUDE.md';
    return tool;
  }

  // 2. Check CLAUDE_VSCODE_VERSION (Claude Code extension)
  if (process.env.CLAUDE_VSCODE_VERSION) {
    tool.name = 'claude-code';
    tool.source = 'env:CLAUDE_VSCODE_VERSION';
    tool.isClaude = true;
    tool.confidence = 90;
    tool.configFile = '.claude/settings.json';
    tool.promptFile = 'CLAUDE.md';
    return tool;
  }

  // 3. Platform-default policy: OpenCode baseline
  if (pathExists('opencode.json')) {
    tool.name = 'opencode';
    tool.source = 'policy-default:opencode';
    tool.isOpenCode = true;
    tool.confidence = 75;
    tool.configFile = 'opencode.json';
    tool.promptFile = 'CLAUDE.md';
    return tool;
  }

  // 4. Check for .clinerules file (Cline)
  if (pathExists('.clinerules')) {
    tool.name = 'cline';
    tool.source = 'file:.clinerules';
    tool.isCline = true;
    tool.confidence = 85;
    tool.configFile = '.clinerules';
    tool.promptFile = '.clinerules';
    return tool;
  }

  // 5. Check for .cursorrules file (Cursor)
  if (pathExists('.cursorrules')) {
    tool.name = 'cursor';
    tool.source = 'file:.cursorrules';
    tool.isCursor = true;
    tool.confidence = 85;
    tool.configFile = '.cursorrules';
    tool.promptFile = '.cursorrules';
    return tool;
  }

  // 6. Check for .windsurf directory
  if (pathExists('.windsurf')) {
    tool.name = 'windsurf';
    tool.source = 'dir:.windsurf';
    tool.isWindsurf = true;
    tool.confidence = 80;
    tool.configFile = '.windsurf/config.json';
    tool.promptFile = 'CLAUDE.md';
    return tool;
  }

  // 6b. Check for .antigravity directory
  if (pathExists('.antigravity')) {
    tool.name = 'antigravity';
    tool.source = 'dir:.antigravity';
    tool.isAntigravity = true;
    tool.confidence = 80;
    tool.configFile = '.antigravity/config.json';
    tool.promptFile = 'CLAUDE.md';
    return tool;
  }

  // 7. Check for Continue config
  const continueConfig = path.join(getHomeDir(), '.continue', 'config.json');
  if (fs.existsSync(continueConfig)) {
    tool.name = 'continue-dev';
    tool.source = `file:${continueConfig}`;
    tool.isContinueDev = true;
    tool.confidence = 70;
    tool.configFile = '.continue/config.json';
    tool.promptFile = 'CLAUDE.md';
    return tool;
  }

  // 8. Fallback: detect by prompt instruction file
  const candidates = [
    { file: 'CLAUDE.md', name: 'claude-generic', promptFile: 'CLAUDE.md' },
    { file: '.clinerules', name: 'cline', promptFile: '.clinerules' },
    { file: '.cursorrules', name: 'cursor', promptFile: '.cursorrules' },
  ];
  for (const c of candidates) {
    if (pathExists(c.file)) {
      tool.name = c.name;
      tool.source = `file:${c.file}`;
      tool.confidence = 50;
      tool.promptFile = c.promptFile;
      if (c.name === 'cline') tool.isCline = true;
      if (c.name === 'cursor') tool.isCursor = true;
      return tool;
    }
  }

  // 9. Final fallback: OpenCode default
  tool.name = 'opencode';
  tool.source = 'fallback-default:opencode';
  tool.isOpenCode = true;
  tool.confidence = 40;
  tool.configFile = 'opencode.json';
  tool.promptFile = 'CLAUDE.md';
  return tool;
}

export function getToolConfig(detectedTool: DetectedTool, configPath?: string): DetectedTool {
  const result = { ...detectedTool };

  const sessionStartCmd = 'npx tsx src/session-autostart.ts';

  result.instructions = {
    primaryEntryPoint: 'docs/AGENTS.md',
    primaryConfig: 'config/orchestrator.json',
    workspaceConfig: 'config/workspace.config.json',
    routingConfig: 'config/auto-delegation.json',
    normatives: 'rules/AI-NORMATIVES.md',
    sessionLifecycle: 'rules/NORMATIVAS-SESSION.md',
    developmentStandards: 'rules/DEVELOPMENT-STANDARDS.md',
    sessionAutostart: sessionStartCmd,
    preProcessHook: 'npx tsx src/pre-process-input.ts',
    responseProfile: 'ultra',
    communicationLang: 'es',
  };

  if (!configPath) return result;
  const fullConfigPath = path.resolve(getRepoRoot(), configPath);
  if (!fs.existsSync(fullConfigPath)) return result;

  try {
    const config = JSON.parse(fs.readFileSync(fullConfigPath, 'utf-8'));
    const toolName = detectedTool.name;
    if (config.toolProfiles && config.toolProfiles[toolName]) {
      const profile = config.toolProfiles[toolName];
      for (const [key, value] of Object.entries(profile)) {
        if (result.instructions) {
          result.instructions[key] = String(value);
        }
      }
    }
  } catch {
    // ignore
  }

  return result;
}

// CLI entry (ESM)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const asJson = process.argv.includes('--json') || process.argv.includes('-AsJson');
  const configPathIdx = process.argv.indexOf('--config');
  const configPath = configPathIdx > 0 ? process.argv[configPathIdx + 1] : '';

  const detected = getDetectedTool();
  const fullConfig = getToolConfig(
    detected,
    configPath || path.join(getRepoRoot(), 'config', 'orchestrator.json'),
  );

  if (asJson) {
    console.log(JSON.stringify(fullConfig, null, 2));
  } else {
    console.log(fullConfig);
  }
}
