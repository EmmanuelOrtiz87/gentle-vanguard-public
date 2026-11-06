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
  isCodex: boolean;
  isZCode: boolean;
  isMiniMax: boolean;
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

const KNOWN_TOOL_NAMES = [
  'opencode',
  'claude-code',
  'cline',
  'cursor',
  'windsurf',
  'codex',
  'zcode',
  'minimax',
  'continue-dev',
  'copilot',
  'antigravity',
  'claude-generic',
] as const;

const DEFAULT_CONFIG_FILES: Record<string, string> = {
  opencode: 'opencode.json',
  'claude-code': '.claude/settings.json',
  cline: '.clinerules',
  cursor: '.cursorrules',
  windsurf: '.windsurf/config.json',
  codex: '.codex/config.toml',
  zcode: '.zcode/config.json',
  minimax: '~/.minimax/config.yaml',
  'continue-dev': '.continue/config.json',
  antigravity: '.antigravity/config.json',
};

const DEFAULT_PROMPT_FILES: Record<string, string> = {
  opencode: 'CLAUDE.md',
  'claude-code': 'CLAUDE.md',
  cline: '.clinerules',
  cursor: '.cursorrules',
  windsurf: 'CLAUDE.md',
  codex: 'AGENTS.md',
  zcode: 'AGENTS.md',
  minimax: 'AGENTS.md',
  'continue-dev': 'CLAUDE.md',
  copilot: 'CLAUDE.md',
  antigravity: 'CLAUDE.md',
  'claude-generic': 'CLAUDE.md',
};

function setToolFlags(tool: DetectedTool, name: string): void {
  tool.isClaude = name === 'claude-code' || name === 'claude-generic';
  tool.isOpenCode = name === 'opencode';
  tool.isCline = name === 'cline';
  tool.isCursor = name === 'cursor';
  tool.isWindsurf = name === 'windsurf';
  tool.isContinueDev = name === 'continue-dev';
  tool.isCopilot = name === 'copilot';
  tool.isAntigravity = name === 'antigravity';
  tool.isCodex = name === 'codex';
  tool.isZCode = name === 'zcode';
  tool.isMiniMax = name === 'minimax';
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
    isCodex: false,
    isZCode: false,
    isMiniMax: false,
    confidence: 0,
    os: { ...OS_INFO },
  };

  // Explicit runtime signals must win over repository markers. This repository
  // intentionally contains .opencode even when another supported client owns
  // the current session.

  // Owner-level override: any client can declare itself explicitly. Accepted
  // values match config/orchestrator.json toolProfiles keys.
  const gvOverride = process.env.GV_ACTIVE_TOOL;
  if (gvOverride && (KNOWN_TOOL_NAMES as readonly string[]).includes(gvOverride)) {
    tool.name = gvOverride;
    tool.source = 'env:GV_ACTIVE_TOOL';
    setToolFlags(tool, gvOverride);
    tool.confidence = 100;
    tool.configFile = DEFAULT_CONFIG_FILES[gvOverride] ?? '';
    tool.promptFile = DEFAULT_PROMPT_FILES[gvOverride] ?? 'AGENTS.md';
    return tool;
  }

  if (process.env.CODEX_SESSION_ID || process.env.CODEX_THREAD_ID || process.env.CODEX_VERSION) {
    tool.name = 'codex';
    tool.source = process.env.CODEX_SESSION_ID ? 'env:CODEX_SESSION_ID' : 'env:CODEX_RUNTIME';
    tool.isCodex = true;
    tool.confidence = 100;
    tool.configFile = '.codex/config.toml';
    tool.promptFile = 'AGENTS.md';
    return tool;
  }

  if (process.env.ZCODE_SESSION_ID || process.env.ZCODE_HOME) {
    tool.name = 'zcode';
    tool.source = process.env.ZCODE_SESSION_ID ? 'env:ZCODE_SESSION_ID' : 'env:ZCODE_HOME';
    tool.isZCode = true;
    tool.confidence = 100;
    tool.configFile = '.zcode/config.json';
    tool.promptFile = 'AGENTS.md';
    return tool;
  }

  if (process.env.MINIMAX_SESSION_ID || process.env.MINIMAX_HOME) {
    tool.name = 'minimax';
    tool.source = process.env.MINIMAX_SESSION_ID ? 'env:MINIMAX_SESSION_ID' : 'env:MINIMAX_HOME';
    tool.isMiniMax = true;
    tool.confidence = 100;
    tool.configFile = '~/.minimax/config.yaml';
    tool.promptFile = 'AGENTS.md';
    return tool;
  }

  // Check OPENCODE env vars (most reliable for opencode)
  if (process.env.OPENCODE_SERVER_USERNAME) {
    tool.name = 'opencode';
    tool.source = 'env:OPENCODE_SERVER_USERNAME';
    tool.isOpenCode = true;
    tool.confidence = 100;
    tool.configFile = 'opencode.json';
    tool.promptFile = 'CLAUDE.md';
    return tool;
  }

  // Claude Code runtime signals (CLI exports CLAUDECODE=1; entrypoint reports origin)
  if (process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT) {
    tool.name = 'claude-code';
    tool.source = process.env.CLAUDECODE ? 'env:CLAUDECODE' : 'env:CLAUDE_CODE_ENTRYPOINT';
    tool.isClaude = true;
    tool.confidence = 100;
    tool.configFile = '.claude/settings.json';
    tool.promptFile = 'CLAUDE.md';
    return tool;
  }

  // Cursor agent runtime signal
  if (process.env.CURSOR_AGENT) {
    tool.name = 'cursor';
    tool.source = 'env:CURSOR_AGENT';
    tool.isCursor = true;
    tool.confidence = 100;
    tool.configFile = '.cursorrules';
    tool.promptFile = '.cursorrules';
    return tool;
  }

  // Claude Code VS Code extension
  if (process.env.CLAUDE_VSCODE_VERSION) {
    tool.name = 'claude-code';
    tool.source = 'env:CLAUDE_VSCODE_VERSION';
    tool.isClaude = true;
    tool.confidence = 90;
    tool.configFile = '.claude/settings.json';
    tool.promptFile = 'CLAUDE.md';
    return tool;
  }

  // Repository markers — reached only when no runtime signal matched above.
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

  const sessionStartCmd = 'npx tsx src/session/session-autostart.ts';

  result.instructions = {
    primaryEntryPoint: 'docs/AGENTS.md',
    primaryConfig: 'config/orchestrator.json',
    workspaceConfig: 'config/workspace.config.json',
    routingConfig: 'config/auto-delegation.json',
    normatives: 'rules/AI-NORMATIVES.md',
    sessionLifecycle: 'rules/NORMATIVAS-SESSION.md',
    developmentStandards: 'rules/DEVELOPMENT-STANDARDS.md',
    sessionAutostart: sessionStartCmd,
    preProcessHook: 'npx tsx src/tools/pre-process-input.ts',
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
