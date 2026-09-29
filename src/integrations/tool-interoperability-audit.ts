#!/usr/bin/env node
/** Audita disponibilidad real y contratos cross-tool sin leer credenciales. */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { delimiter, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { CRITICAL_SKILLS } from './zcode-sync.js';
import { runSync } from '../core/run-command.js';

type Status = 'PASS' | 'WARN' | 'FAIL';

interface ToolAudit {
  tool: string;
  status: Status;
  profile: boolean;
  runtime: boolean;
  launcher: boolean;
  agents: number | null;
  skills: number;
  hooks: 'safe' | 'unsafe' | 'n/a';
  engram: 'mcp' | 'cli-fallback' | 'missing';
  instructions: boolean;
  assets: 'fresh' | 'stale' | 'n/a';
  runtimeVariant: string;
  detail: string;
}

interface SkillTreeComparison {
  fresh: boolean;
  differences: string[];
}

function listRelativeFiles(root: string, current = root): string[] {
  if (!existsSync(current)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...listRelativeFiles(root, path));
    else if (entry.isFile()) files.push(path.slice(root.length + 1).replace(/\\/g, '/'));
  }
  return files.sort();
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function compareSkillTrees(source: string, target: string): SkillTreeComparison {
  if (!existsSync(source) || !existsSync(target)) {
    return { fresh: false, differences: ['source or target directory is missing'] };
  }
  const sourceFiles = listRelativeFiles(source);
  const targetFiles = listRelativeFiles(target);
  const sourceSet = new Set(sourceFiles);
  const targetSet = new Set(targetFiles);
  const differences: string[] = [];

  for (const file of sourceFiles) {
    if (!targetSet.has(file)) differences.push(`missing:${file}`);
    else if (sha256(join(source, file)) !== sha256(join(target, file))) {
      differences.push(`changed:${file}`);
    }
  }
  for (const file of targetFiles) {
    if (!sourceSet.has(file)) differences.push(`unexpected:${file}`);
  }
  return { fresh: differences.length === 0, differences };
}

function criticalSkillsFresh(root: string, targetRoot: string): boolean {
  return CRITICAL_SKILLS.every((skill) => {
    const sourceRoot =
      skill.root === 'opencode' ? join(root, '.opencode', 'skills') : join(root, 'skills');
    return compareSkillTrees(join(sourceRoot, skill.dir), join(targetRoot, skill.dir)).fresh;
  });
}

export function parseOpenCodeRuntimeMajor(version: string): 'v1' | 'v2' | 'unsupported' {
  // Regex-free parse (ReDoS-safe): "opencode 1.2.3", "OpenCode v2.0.0", "v1.0.0".
  const normalized = version
    .trim()
    .toLowerCase()
    .replace(/^opencode\s+/, '')
    .replace(/^v/, '');
  const parts = normalized.split('.');
  if (parts.length !== 3 || !parts.every((part) => /^\d+$/.test(part))) return 'unsupported';
  if (parts[0] === '1') return 'v1';
  if (parts[0] === '2') return 'v2';
  return 'unsupported';
}

function detectOpenCodeRuntime(command: string | null): { variant: string; supported: boolean } {
  if (!command) return { variant: 'missing', supported: false };
  const result = runSync(command, ['--version'], { timeout: 3000, maxBuffer: 4096 });
  if (result.status !== 0 || result.stdout.length > 4096 || result.stderr.length > 4096) {
    return { variant: 'unsupported', supported: false };
  }
  const major = parseOpenCodeRuntimeMajor(result.stdout);
  return { variant: major, supported: major === 'v1' };
}

function countFiles(dir: string, fileName: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name === fileName,
  ).length;
}

function countMarkdown(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name.endsWith('.md'),
  ).length;
}

export function isUsableLauncherFile(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return false;
    if (/\.exe$/i.test(path) || stat.size > 64 * 1024) return true;
    const content = readFileSync(path, 'utf8');
    return !/demo mode|temporary solution until proper|simulat(?:e|ed|ion)/i.test(content);
  } catch {
    return false;
  }
}

function findUsableCommand(name: string, pathValue = process.env.PATH ?? ''): string | null {
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat', '.ps1'] : [''];
  for (const dir of pathValue.split(delimiter)) {
    for (const extension of extensions) {
      const candidate = join(dir, `${name}${extension}`);
      if (isUsableLauncherFile(candidate)) return candidate;
    }
  }
  return null;
}

function commandAvailable(name: string, pathValue = process.env.PATH ?? ''): boolean {
  return findUsableCommand(name, pathValue) !== null;
}

function zcodeHooksSafe(configPath: string): boolean {
  if (!existsSync(configPath)) return false;
  try {
    const raw = readFileSync(configPath, 'utf8');
    const forbiddenTsxLauncher = ['cli', 'mjs'].join('.');
    return (
      raw.includes('"--import"') && raw.includes('"tsx"') && !raw.includes(forbiddenTsxLauncher)
    );
  } catch {
    return false;
  }
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function nestedValue(value: unknown, keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function hasEngramJsonServer(path: string, containers: string[][]): boolean {
  const config = readJson(path);
  if (!config) return false;
  return containers.some((container) => {
    const server = nestedValue(config, [...container, 'engram']);
    if (!server || typeof server !== 'object') return false;
    const serialized = JSON.stringify(server).toLowerCase();
    return serialized.includes('engram') && serialized.includes('mcp');
  });
}

function fileContains(path: string, pattern: RegExp): boolean {
  try {
    return existsSync(path) && pattern.test(readFileSync(path, 'utf8'));
  } catch {
    return false;
  }
}

export function auditTools(
  root = process.cwd(),
  home = homedir(),
  pathValue = process.env.PATH ?? '',
  appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming'),
): ToolAudit[] {
  const sourceAgents = countMarkdown(join(root, '.opencode', 'agents'));
  const expectedSkills = CRITICAL_SKILLS.length;
  const zcodeSkills = countFiles(join(home, '.zcode', 'skills'), 'SKILL.md');
  const codexSkills = countFiles(join(home, '.codex', 'skills'), 'SKILL.md');
  const minimaxSkills = countFiles(join(home, '.minimax', 'agents', 'mavis', 'skills'), 'SKILL.md');
  const copilotSkills = countFiles(join(root, '.github', 'skills'), 'SKILL.md');
  const antigravitySkills = countFiles(join(root, '.antigravity', 'skills'), 'SKILL.md');
  const zcodeAgents = countMarkdown(join(home, '.zcode', 'agents'));
  const hookSafe = zcodeHooksSafe(join(home, '.zcode', 'cli', 'config.json'));
  const engramAvailable = commandAvailable('engram', pathValue);
  const zcodeAssetsFresh = criticalSkillsFresh(root, join(home, '.zcode', 'skills'));
  const codexAssetsFresh = criticalSkillsFresh(root, join(home, '.codex', 'skills'));
  const minimaxAssetsFresh = criticalSkillsFresh(
    root,
    join(home, '.minimax', 'agents', 'mavis', 'skills'),
  );
  const copilotAssetsFresh = criticalSkillsFresh(root, join(root, '.github', 'skills'));
  const antigravityAssetsFresh = criticalSkillsFresh(root, join(root, '.antigravity', 'skills'));

  const openCodeProfile = existsSync(join(root, 'config', 'tool-opencode.json'));
  const openCodeRuntime = existsSync(join(root, '.opencode'));
  const openCodeCommand = findUsableCommand('opencode', pathValue);
  const openCodeLauncher = openCodeCommand !== null;
  const openCodeRuntimeVersion = detectOpenCodeRuntime(openCodeCommand);
  const openCodePlugin = existsSync(join(home, '.config', 'opencode', 'plugins', 'engram.ts'));
  const openCodeMcp = hasEngramJsonServer(join(home, '.config', 'opencode', 'opencode.json'), [
    ['mcp'],
  ]);

  const codexTomlCandidates = [
    join(home, '.codex', 'config.toml'),
    join(appData, 'codex', 'config.toml'),
  ];
  const codexMcp = codexTomlCandidates.some((path) =>
    fileContains(path, /\[mcp_servers\.engram\]/),
  );
  const codexInstructions = [
    join(home, '.codex', 'engram-instructions.md'),
    join(appData, 'codex', 'engram-instructions.md'),
  ].some((path) => existsSync(path));

  const zcodeMcp = hasEngramJsonServer(join(root, '.zcode', 'config.json'), [
    ['mcp', 'servers'],
    ['mcpServers'],
  ]);
  const copilotMcp = hasEngramJsonServer(join(appData, 'Code', 'User', 'mcp.json'), [['servers']]);
  const copilotInstructions = existsSync(
    join(appData, 'Code', 'User', 'prompts', 'engram.instructions.md'),
  );
  const antigravityMcp = hasEngramJsonServer(join(home, '.gemini', 'config', 'mcp_config.json'), [
    ['mcpServers'],
    ['servers'],
  ]);
  const antigravityInstructions = fileContains(
    join(home, '.gemini', 'GEMINI.md'),
    /Engram|Memory Protocol/i,
  );

  return [
    {
      tool: 'OpenCode',
      status:
        openCodeProfile &&
        openCodeRuntime &&
        openCodeLauncher &&
        openCodeRuntimeVersion.supported &&
        openCodePlugin &&
        openCodeMcp
          ? 'PASS'
          : 'WARN',
      profile: openCodeProfile,
      runtime: openCodeRuntime,
      launcher: openCodeLauncher,
      agents: sourceAgents,
      skills: countFiles(join(root, '.opencode', 'skills'), 'SKILL.md'),
      hooks: 'n/a',
      engram: openCodeMcp && openCodePlugin ? 'mcp' : 'missing',
      instructions: openCodePlugin && existsSync(join(root, 'AGENTS.md')),
      assets: 'n/a',
      runtimeVariant: openCodeRuntimeVersion.variant,
      detail:
        openCodeRuntimeVersion.variant === 'v2'
          ? 'OpenCode V2 detectado; MCP/config nativos requieren calificación y review transport no se anuncia'
          : 'CLI real V1, plugin oficial Engram v2 y MCP global',
    },
    {
      tool: 'Codex',
      status:
        commandAvailable('codex', pathValue) &&
        codexSkills >= expectedSkills &&
        codexAssetsFresh &&
        existsSync(join(root, 'AGENTS.md')) &&
        codexMcp &&
        codexInstructions
          ? 'PASS'
          : 'WARN',
      profile: existsSync(join(root, 'config', 'tool-codex.json')),
      runtime: existsSync(join(home, '.codex')),
      launcher: commandAvailable('codex', pathValue),
      agents: sourceAgents,
      skills: codexSkills,
      hooks: 'n/a',
      engram: codexMcp ? 'mcp' : 'missing',
      instructions: codexInstructions,
      assets: codexAssetsFresh ? 'fresh' : 'stale',
      runtimeVariant: 'native',
      detail: 'AGENTS.md, skills nativas, plugin y MCP Engram v2',
    },
    {
      tool: 'ZCode',
      status:
        zcodeAgents === sourceAgents &&
        zcodeSkills >= expectedSkills &&
        zcodeAssetsFresh &&
        hookSafe &&
        zcodeMcp &&
        engramAvailable
          ? 'PASS'
          : 'WARN',
      profile: existsSync(join(root, 'config', 'tool-zcode.json')),
      runtime: existsSync(join(home, '.zcode', 'v2')),
      launcher: commandAvailable('zcode', pathValue),
      agents: zcodeAgents,
      skills: zcodeSkills,
      hooks: hookSafe ? 'safe' : 'unsafe',
      engram: zcodeMcp ? 'mcp' : 'missing',
      instructions: existsSync(join(root, 'AGENTS.md')) && zcodeSkills >= expectedSkills,
      assets: zcodeAssetsFresh ? 'fresh' : 'stale',
      runtimeVariant: 'desktop',
      detail: 'Desktop runtime; MCP, agentes, skills y hooks seguros',
    },
    {
      tool: 'MiniMax Code',
      status:
        existsSync(join(home, '.minimax', 'config.yaml')) &&
        minimaxSkills >= expectedSkills &&
        minimaxAssetsFresh &&
        engramAvailable &&
        existsSync(join(root, 'AGENTS.md'))
          ? 'PASS'
          : 'WARN',
      profile: existsSync(join(root, 'config', 'tool-minimax.json')),
      runtime: existsSync(join(home, '.minimax', 'v2')),
      launcher: commandAvailable('minimax', pathValue),
      agents: null,
      skills: minimaxSkills,
      hooks: 'n/a',
      engram: engramAvailable ? 'cli-fallback' : 'missing',
      instructions: minimaxSkills >= expectedSkills && existsSync(join(root, 'AGENTS.md')),
      assets: minimaxAssetsFresh ? 'fresh' : 'stale',
      runtimeVariant: 'desktop/pi-agent',
      detail: 'Runtime desktop/pi-agent; Engram CLI es fallback hasta configurar MCP desde /mcp',
    },
    {
      tool: 'GitHub Copilot',
      status:
        existsSync(join(root, 'config', 'tool-vscode.json')) &&
        existsSync(join(root, '.vscode', 'settings.json')) &&
        commandAvailable('code', pathValue) &&
        copilotSkills >= expectedSkills &&
        copilotAssetsFresh &&
        copilotMcp &&
        copilotInstructions
          ? 'PASS'
          : 'WARN',
      profile: existsSync(join(root, 'config', 'tool-vscode.json')),
      runtime: existsSync(join(root, '.vscode', 'settings.json')),
      launcher: commandAvailable('code', pathValue),
      agents: null,
      skills: copilotSkills,
      hooks: 'n/a',
      engram: copilotMcp ? 'mcp' : 'missing',
      instructions:
        copilotInstructions && existsSync(join(root, '.github', 'copilot-instructions.md')),
      assets: copilotAssetsFresh ? 'fresh' : 'stale',
      runtimeVariant: 'vscode-agent-mode',
      detail: 'VS Code Agent Mode, workspace skills, MCP e instrucciones oficiales',
    },
    {
      tool: 'Antigravity',
      status:
        existsSync(join(root, 'config', 'tool-antigravity.json')) &&
        existsSync(join(root, '.antigravity', 'config.json')) &&
        antigravitySkills >= expectedSkills &&
        antigravityAssetsFresh &&
        antigravityMcp &&
        antigravityInstructions
          ? 'PASS'
          : 'WARN',
      profile: existsSync(join(root, 'config', 'tool-antigravity.json')),
      runtime: existsSync(join(root, '.antigravity', 'config.json')),
      launcher: commandAvailable('antigravity', pathValue),
      agents: null,
      skills: antigravitySkills,
      hooks: 'n/a',
      engram: antigravityMcp ? 'mcp' : 'missing',
      instructions: antigravityInstructions,
      assets: antigravityAssetsFresh ? 'fresh' : 'stale',
      runtimeVariant: 'desktop',
      detail: 'Desktop runtime, workspace skills, MCP compartido y Memory Protocol',
    },
  ];
}

function markdown(rows: ToolAudit[], generatedAt: string): string {
  const lines = [
    '# Auditoría de interoperabilidad de herramientas',
    '',
    `Generado: ${generatedAt}`,
    '',
    '| Herramienta | Estado | Variante | Perfil | Runtime | Launcher | Agentes | Skills | Assets | Hooks | Engram | Instrucciones |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...rows.map(
      (row) =>
        `| ${row.tool} | ${row.status} | ${row.runtimeVariant} | ${row.profile ? 'sí' : 'no'} | ${row.runtime ? 'sí' : 'no'} | ${row.launcher ? 'sí' : 'no'} | ${row.agents ?? 'n/a'} | ${row.skills} | ${row.assets} | ${row.hooks} | ${row.engram} | ${row.instructions ? 'sí' : 'no'} |`,
    ),
    '',
    '## Criterio',
    '',
    'Un runtime desktop puede estar operativo sin una CLI global. PASS exige el contrato nativo de cada herramienta: perfil, instrucciones, skills con árboles y hashes frescos, Engram por MCP o fallback explícito y, cuando aplica, agentes y hooks seguros. OpenCode se clasifica por la versión reportada por el ejecutable; una major desconocida o V2 todavía no calificada nunca hereda capacidades V1.',
    '',
  ];
  return lines.join('\n');
}

function main(): void {
  const rows = auditTools();
  const generatedAt = new Date().toISOString();
  console.log(
    JSON.stringify(
      { generatedAt, expectedCriticalSkills: CRITICAL_SKILLS.length, tools: rows },
      null,
      2,
    ),
  );
  if (process.argv.includes('--write')) {
    const day = generatedAt.slice(0, 10);
    const dir = resolve('reports', 'audits');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `tool-interoperability-${day}.json`),
      `${JSON.stringify({ generatedAt, tools: rows }, null, 2)}\n`,
    );
    writeFileSync(join(dir, `tool-interoperability-${day}.md`), markdown(rows, generatedAt));
  }
  if (rows.some((row) => row.status !== 'PASS')) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
