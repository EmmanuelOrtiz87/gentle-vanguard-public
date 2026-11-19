#!/usr/bin/env node
/** Audita disponibilidad real y contratos cross-tool sin leer credenciales. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { CRITICAL_SKILLS } from './zcode-sync.js';
import { codexTokenSafetyProblems, parseTomlScalars } from '../tokens/token-safety.js';

type Status = 'PASS' | 'WARN' | 'FAIL';

export interface ToolAudit {
  tool: string;
  status: Status;
  profile: boolean;
  hostConfig: boolean;
  agents: number | null;
  skills: number;
  hooks: 'safe' | 'unsafe' | 'n/a';
  engram: 'mcp' | 'missing' | 'unverified';
  instructions: boolean;
  assets: 'fresh' | 'stale' | 'n/a';
  hostType: string;
  detail: string;
}

interface SkillTreeComparison {
  fresh: boolean;
  differences: string[];
}

const EXPECTED_TOOL_SURFACES = [
  'OpenCode',
  'Codex',
  'ZCode',
  'MiniMax Code',
  'GitHub Copilot',
  'Antigravity',
  'Kimi',
  'Qoder',
];

/**
 * Perfiles de referencia para herramientas fuera del roster operativo de 9
 * (audit 2026-11-17 F10). Existen como especificacion y como superficies de
 * instrucciones generadas por el watchtower, pero NO tienen contrato de
 * identificacion ni auditoria de skills/MCP: declararlos evita que queden
 * como perfiles mudos.
 */
export interface ReferenceProfile {
  tool: string;
  profile: string;
  surface: string;
  surfacePaths: readonly string[];
  reason: string;
}

export const REFERENCE_PROFILES: readonly ReferenceProfile[] = [
  {
    tool: 'Claude Code',
    profile: 'config/tool-claude-code.json',
    surface:
      'CLAUDE.md (puntero a AGENTS.md) + .claude/ gitignored (settings stale, decision del owner)',
    surfacePaths: ['CLAUDE.md', '.claude'],
    reason: 'fuera del roster de 9; sin contrato de identificacion ni host config auditado',
  },
  {
    tool: 'Cline',
    profile: 'config/tool-cline.json',
    surface: '.clinerules + .cline/config.json (instrucciones auto-managed por watchtower)',
    surfacePaths: ['.clinerules', '.cline'],
    reason:
      'fuera del roster de 9; superficie de instrucciones generada, sin auditoria de skills/MCP',
  },
  {
    tool: 'Cursor',
    profile: 'config/tool-cursor.json',
    surface: '.cursorrules + .cursor/{commands,hooks,rules} (auto-managed por watchtower)',
    surfacePaths: ['.cursorrules', '.cursor'],
    reason: 'fuera del roster de 9; sin host instalado ni contrato de identificacion',
  },
  {
    tool: 'Windsurf',
    profile: 'config/tool-windsurf.json',
    surface: '.windsurf/{config.json,plugins}',
    surfacePaths: ['.windsurf'],
    reason: 'fuera del roster de 9; superficie de proyecto minima, sin auditoria de skills/MCP',
  },
];

export interface ReferenceProfileReport extends ReferenceProfile {
  profilePresent: boolean;
  surfacePresent: boolean;
}

/** Reporta presencia real de cada perfil/superficie de referencia declarada. */
export function referenceProfileReports(root: string): ReferenceProfileReport[] {
  return REFERENCE_PROFILES.map((profile) => ({
    ...profile,
    profilePresent: existsSync(join(root, profile.profile)),
    surfacePresent: profile.surfacePaths.some((path) => existsSync(join(root, path))),
  }));
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

/** null = archivo ilegible (p. ej. race con tool-interoperability-sync que lo
 *  reescribe en paralelo durante el autostart). Degradamos con gracia en vez
 *  de crashear el audit entero. */
function sha256(path: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return null;
  }
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
    else {
      const sourceHash = sha256(join(source, file));
      const targetHash = sha256(join(target, file));
      if (sourceHash === null || targetHash === null) differences.push(`unreadable:${file}`);
      else if (sourceHash !== targetHash) {
        differences.push(`changed:${file}`);
      }
    }
  }
  for (const file of targetFiles) {
    if (!sourceSet.has(file)) differences.push(`unexpected:${file}`);
  }
  return { fresh: differences.length === 0, differences };
}

export function nativeSkillSurfaceReady(
  skillCount: number,
  expectedCount: number,
  fresh: boolean,
): boolean {
  return expectedCount > 0 && skillCount >= expectedCount && fresh;
}

export function zcodeEngramMode(mcpAvailable: boolean): 'mcp' | 'missing' {
  return mcpAvailable ? 'mcp' : 'missing';
}

export function hasAgentCoverage(actual: number, expected: number): boolean {
  return actual >= expected;
}

const CODEX_MANAGED_IMPECCABLE_EXTRAS = new Set([
  'scripts/detector/browser/injected/index.mjs',
  'scripts/detector/injected/index.mjs',
  'scripts/detector/cli/main.mjs',
  'scripts/detector/design-system.mjs',
  'scripts/detector/detect-antipatterns-browser.js',
  'scripts/detector/detect-antipatterns.mjs',
  'scripts/detector/engines/browser/detect-url.mjs',
  'scripts/detector/engines/regex/detect-text.mjs',
  'scripts/detector/engines/static-html/css-cascade.mjs',
  'scripts/detector/engines/static-html/detect-html.mjs',
  'scripts/detector/engines/visual/screenshot-contrast.mjs',
  'scripts/detector/findings.mjs',
  'scripts/detector/node/file-system.mjs',
  'scripts/detector/profile/profiler.mjs',
  'scripts/detector/registry/antipatterns.mjs',
  'scripts/detector/rules/checks.mjs',
  'scripts/detector/shared/color.mjs',
  'scripts/detector/shared/constants.mjs',
  'scripts/detector/shared/fonts.mjs',
  'scripts/detector/shared/inline-ignores.mjs',
  'scripts/detector/shared/page.mjs',
  'scripts/lib/download-providers.js',
  'scripts/lib/impeccable-config.mjs',
]);

// Guardrail de gasto: un perfil sin límites de contexto deja que el thread crezca
// hasta (>300k tokens/request) y quema la cuota 5h sin compactar (medido 2026-11-17).
function codexTokenProblemsFor(root: string): string[] {
  const configPath = join(root, '.codex', 'config.toml');
  if (!existsSync(configPath)) return ['perfil .codex/config.toml ausente'];
  return codexTokenSafetyProblems(parseTomlScalars(readFileSync(configPath, 'utf8')));
}

function criticalSkillsFresh(
  root: string,
  targetRoot: string,
  toleratedUnexpected = new Set<string>(),
): boolean {
  return CRITICAL_SKILLS.every((skill) => {
    const sourceRoot =
      skill.root === 'opencode' ? join(root, '.opencode', 'skills') : join(root, 'skills');
    const comparison = compareSkillTrees(join(sourceRoot, skill.dir), join(targetRoot, skill.dir));
    return (
      comparison.differences.every((difference) => {
        if (!difference.startsWith('unexpected:')) return false;
        return toleratedUnexpected.has(`${skill.dir}/${difference.slice('unexpected:'.length)}`);
      }) || comparison.fresh
    );
  });
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
    const servers = nestedValue(config, container);
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return false;
    const server = (servers as Record<string, unknown>).engram;
    // Check declaration and shape only; never inspect or serialize server values.
    return Boolean(server && typeof server === 'object' && !Array.isArray(server));
  });
}

function fileContains(path: string, pattern: RegExp): boolean {
  try {
    return existsSync(path) && pattern.test(readFileSync(path, 'utf8'));
  } catch {
    return false;
  }
}

export function hasMiniMaxEngramMcpRuntime(path: string): boolean {
  const config = readJson(path);
  const servers = config?.servers;
  if (!Array.isArray(servers)) return false;
  return servers.some((server) => {
    if (!server || typeof server !== 'object') return false;
    const record = server as Record<string, unknown>;
    const name = `${record.raw ?? ''} ${record.segment ?? ''}`.toLowerCase();
    if (!name.includes('engram')) return false;
    const tools = record.tools;
    return (
      Array.isArray(tools) &&
      tools.some((tool) => {
        if (!tool || typeof tool !== 'object') return false;
        const toolRecord = tool as Record<string, unknown>;
        return `${toolRecord.raw ?? ''} ${toolRecord.segment ?? ''}`.includes('mem_');
      })
    );
  });
}

export function auditTools(
  root = process.cwd(),
  home = homedir(),
  appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming'),
): ToolAudit[] {
  const sourceAgents = countMarkdown(join(root, '.opencode', 'agents'));
  const expectedSkills = CRITICAL_SKILLS.length;
  const zcodeSkills = countFiles(join(home, '.zcode', 'skills'), 'SKILL.md');
  const codexSkills = countFiles(join(home, '.codex', 'skills'), 'SKILL.md');
  const minimaxSkills = countFiles(join(home, '.minimax', 'agents', 'mavis', 'skills'), 'SKILL.md');
  const copilotSkills = countFiles(join(root, '.github', 'skills'), 'SKILL.md');
  const antigravitySkills = countFiles(join(root, '.antigravity', 'skills'), 'SKILL.md');
  const kimiSkills = countFiles(join(root, '.kimi-code', 'skills'), 'SKILL.md');
  const qoderSkills = countFiles(join(root, '.qoder', 'skills'), 'SKILL.md');
  const zcodeAgents = countMarkdown(join(home, '.zcode', 'agents'));
  const hookSafe = zcodeHooksSafe(join(home, '.zcode', 'cli', 'config.json'));
  const zcodeAssetsFresh = criticalSkillsFresh(root, join(home, '.zcode', 'skills'));
  const codexAssetsFresh = criticalSkillsFresh(
    root,
    join(home, '.codex', 'skills'),
    new Set([...CODEX_MANAGED_IMPECCABLE_EXTRAS].map((file) => `impeccable/${file}`)),
  );
  const minimaxAssetsFresh = criticalSkillsFresh(
    root,
    join(home, '.minimax', 'agents', 'mavis', 'skills'),
  );
  const copilotAssetsFresh = criticalSkillsFresh(root, join(root, '.github', 'skills'));
  const antigravityAssetsFresh = criticalSkillsFresh(root, join(root, '.antigravity', 'skills'));
  const kimiAssetsFresh = criticalSkillsFresh(root, join(root, '.kimi-code', 'skills'));
  const qoderAssetsFresh = criticalSkillsFresh(root, join(root, '.qoder', 'skills'));

  const openCodeProfile = existsSync(join(root, 'config', 'tool-opencode.json'));
  const openCodeHostConfig = existsSync(join(root, '.opencode'));
  const openCodePlugin = existsSync(join(home, '.config', 'opencode', 'plugins', 'engram.ts'));
  // OpenCode V2 movio los servers a `mcp.servers.<name>`; el shape V1 (`mcp.<name>`)
  // se descarta en silencio. Mirar solo V1 reportaba "engram ausente" con Engram
  // conectado y 23 tools vivas (medido 2026-11-14). Se aceptan ambos por compatibilidad.
  const openCodeMcp = hasEngramJsonServer(join(home, '.config', 'opencode', 'opencode.json'), [
    ['mcp', 'servers'],
    ['mcp'],
  ]);
  const openCodeSkills = countFiles(join(root, '.opencode', 'skills'), 'SKILL.md');
  const openCodeAssetsFresh = criticalSkillsFresh(root, join(root, '.opencode', 'skills'));
  const openCodeProblems = [
    !openCodeProfile && 'perfil ausente',
    !openCodeHostConfig && 'directorio .opencode ausente',
    !(openCodePlugin || openCodeMcp) && 'ni plugin ni MCP de Engram (cualquiera de los dos basta)',
    !nativeSkillSurfaceReady(openCodeSkills, expectedSkills, openCodeAssetsFresh) &&
      `skills nativas ${openCodeSkills}/${expectedSkills} incompletas o desactualizadas`,
  ].filter(Boolean);

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
  const codexTokenProblems = codexTokenProblemsFor(root);

  const zcodeMcp = hasEngramJsonServer(join(root, '.zcode', 'config.json'), [
    ['mcp', 'servers'],
    ['mcpServers'],
  ]);
  const copilotWorkspaceMcp = hasEngramJsonServer(join(root, '.vscode', 'mcp.json'), [['servers']]);
  const copilotUserMcp = hasEngramJsonServer(join(appData, 'Code', 'User', 'mcp.json'), [
    ['servers'],
  ]);
  const copilotMcp = copilotWorkspaceMcp || copilotUserMcp;
  const copilotHostConfig =
    existsSync(join(root, '.vscode', 'settings.json')) ||
    existsSync(join(root, '.vscode', 'mcp.json'));
  const copilotInstructions = existsSync(join(root, '.github', 'copilot-instructions.md'));
  const antigravityMcp = hasEngramJsonServer(join(home, '.gemini', 'config', 'mcp_config.json'), [
    ['mcpServers'],
    ['servers'],
  ]);
  const antigravityInstructions = fileContains(
    join(home, '.gemini', 'GEMINI.md'),
    /Engram|Memory Protocol/i,
  );
  const minimaxMcp = hasMiniMaxEngramMcpRuntime(join(home, '.minimax', 'mcp-runtime-names.json'));
  const kimiProjectMcp = hasEngramJsonServer(join(root, '.kimi-code', 'mcp.json'), [
    ['mcpServers'],
  ]);
  const kimiUserMcp = hasEngramJsonServer(join(home, '.kimi-code', 'mcp.json'), [['mcpServers']]);
  const kimiEngram = kimiProjectMcp || kimiUserMcp;
  const kimiEngramMode = kimiEngram ? 'mcp' : 'missing';
  const qoderRuntimeBridgeActive = jsonHasRuntimeBridge(join(home, '.qoder', 'mcp-router.json'));
  const qoderMcpConfigurationVerified = hasEngramJsonServer(join(home, '.qoder', 'settings.json'), [
    ['mcpServers'],
  ]);
  const qoderEngramConfiguration: ToolAudit['engram'] = qoderMcpConfigurationVerified
    ? 'mcp'
    : 'unverified';

  return [
    {
      tool: 'OpenCode',
      status: openCodeProblems.length === 0 ? 'PASS' : 'WARN',
      profile: openCodeProfile,
      hostConfig: openCodeHostConfig,
      agents: sourceAgents,
      skills: openCodeSkills,
      hooks: 'n/a',
      engram: openCodeMcp || openCodePlugin ? 'mcp' : 'missing',
      instructions: openCodePlugin && existsSync(join(root, 'AGENTS.md')),
      assets: openCodeAssetsFresh ? 'fresh' : 'stale',
      hostType: 'desktop',
      detail:
        openCodeProblems.join('; ') ||
        `Desktop workspace, Engram MCP/plugin y skills nativas ${openCodeSkills}/${expectedSkills} frescas`,
    },
    {
      tool: 'Codex',
      status:
        existsSync(join(home, '.codex')) &&
        codexSkills >= expectedSkills &&
        codexAssetsFresh &&
        existsSync(join(root, 'AGENTS.md')) &&
        codexMcp &&
        codexInstructions &&
        codexTokenProblems.length === 0
          ? 'PASS'
          : 'WARN',
      profile: existsSync(join(root, 'config', 'tool-codex.json')),
      hostConfig: existsSync(join(home, '.codex')),
      agents: sourceAgents,
      skills: codexSkills,
      hooks: 'n/a',
      engram: codexMcp ? 'mcp' : 'missing',
      instructions: codexInstructions,
      assets: codexAssetsFresh ? 'fresh' : 'stale',
      hostType: 'desktop IDE',
      detail:
        codexTokenProblems.join('; ') ||
        'AGENTS.md, skills nativas, MCP Engram y configuración de Codex Desktop',
    },
    {
      tool: 'ZCode',
      status:
        hasAgentCoverage(zcodeAgents, sourceAgents) &&
        zcodeSkills >= expectedSkills &&
        zcodeAssetsFresh &&
        hookSafe &&
        zcodeMcp
          ? 'PASS'
          : 'WARN',
      profile: existsSync(join(root, 'config', 'tool-zcode.json')),
      hostConfig: existsSync(join(home, '.zcode', 'v2')),
      agents: zcodeAgents,
      skills: zcodeSkills,
      hooks: hookSafe ? 'safe' : 'unsafe',
      engram: zcodeEngramMode(zcodeMcp),
      instructions: existsSync(join(root, 'AGENTS.md')) && zcodeSkills >= expectedSkills,
      assets: zcodeAssetsFresh ? 'fresh' : 'stale',
      hostType: 'desktop IDE',
      detail: 'Workspace desktop; MCP, agentes, skills y hooks seguros',
    },
    {
      tool: 'MiniMax Code',
      status:
        existsSync(join(home, '.minimax', 'config.yaml')) &&
        minimaxSkills >= expectedSkills &&
        minimaxAssetsFresh &&
        minimaxMcp &&
        existsSync(join(root, 'AGENTS.md'))
          ? 'PASS'
          : 'WARN',
      profile: existsSync(join(root, 'config', 'tool-minimax.json')),
      hostConfig: existsSync(join(home, '.minimax', 'config.yaml')),
      agents: null,
      skills: minimaxSkills,
      hooks: 'n/a',
      engram: minimaxMcp ? 'mcp' : 'missing',
      instructions: minimaxSkills >= expectedSkills && existsSync(join(root, 'AGENTS.md')),
      assets: minimaxAssetsFresh ? 'fresh' : 'stale',
      hostType: 'desktop IDE/pi-agent',
      detail: minimaxMcp
        ? 'Desktop IDE/pi-agent; Engram MCP detectado en mcp-runtime-names.json'
        : 'Desktop IDE/pi-agent; Engram MCP no configurado',
    },
    {
      tool: 'GitHub Copilot',
      status:
        existsSync(join(root, 'config', 'tool-vscode.json')) &&
        copilotHostConfig &&
        copilotSkills >= expectedSkills &&
        copilotAssetsFresh &&
        copilotMcp &&
        copilotInstructions
          ? 'PASS'
          : 'WARN',
      profile: existsSync(join(root, 'config', 'tool-vscode.json')),
      hostConfig: copilotHostConfig,
      agents: null,
      skills: copilotSkills,
      hooks: 'n/a',
      engram: copilotMcp ? 'mcp' : 'missing',
      instructions:
        copilotInstructions && existsSync(join(root, '.github', 'copilot-instructions.md')),
      assets: copilotAssetsFresh ? 'fresh' : 'stale',
      hostType: 'desktop IDE',
      detail: 'GitHub Copilot en IDE de escritorio; workspace skills, MCP e instrucciones',
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
      hostConfig: existsSync(join(root, '.antigravity', 'config.json')),
      agents: null,
      skills: antigravitySkills,
      hooks: 'n/a',
      engram: antigravityMcp ? 'mcp' : 'missing',
      instructions: antigravityInstructions,
      assets: antigravityAssetsFresh ? 'fresh' : 'stale',
      hostType: 'desktop IDE',
      detail: 'Workspace skills, MCP compartido y Memory Protocol',
    },
    {
      // GB-2026-11-15: superficies identificadas en disco (zondeo medido).
      // Sus skills de proyecto se comparan contra el canon; el PASS no califica
      // inferencia ni ejecución real del host.
      tool: 'Kimi',
      status:
        existsSync(join(root, 'config', 'tool-kimi.json')) &&
        existsSync(join(home, '.kimi-code', 'mcp.json')) &&
        jsonHasServers(join(home, '.kimi-code', 'mcp.json')) &&
        nativeSkillSurfaceReady(kimiSkills, expectedSkills, kimiAssetsFresh) &&
        kimiEngramMode !== 'missing'
          ? 'PASS'
          : 'WARN',
      profile: existsSync(join(root, 'config', 'tool-kimi.json')),
      hostConfig: existsSync(join(home, '.kimi-code')),
      agents: null,
      skills: kimiSkills,
      hooks: 'n/a',
      engram: kimiEngramMode,
      instructions: existsSync(join(root, 'AGENTS.md')),
      assets: kimiAssetsFresh ? 'fresh' : 'stale',
      hostType: 'desktop IDE',
      detail: `Project skills ${kimiSkills}/${expectedSkills}; Engram ${kimiEngramMode}; host execution not qualified`,
    },
    {
      tool: 'Qoder',
      status:
        existsSync(join(root, 'config', 'tool-qoder.json')) &&
        existsSync(join(home, '.qoder')) &&
        nativeSkillSurfaceReady(qoderSkills, expectedSkills, qoderAssetsFresh) &&
        qoderMcpConfigurationVerified
          ? 'PASS'
          : 'WARN',
      profile: existsSync(join(root, 'config', 'tool-qoder.json')),
      hostConfig: existsSync(join(home, '.qoder')),
      agents: null,
      skills: qoderSkills,
      hooks: 'n/a',
      engram: qoderEngramConfiguration,
      instructions: existsSync(join(root, 'AGENTS.md')),
      assets: qoderAssetsFresh ? 'fresh' : 'stale',
      hostType: 'desktop IDE',
      detail: `Project skills ${qoderSkills}/${expectedSkills}; persistent Engram MCP ${qoderMcpConfigurationVerified ? 'configured in IDE settings' : 'not verified'}; runtime bridge ${qoderRuntimeBridgeActive ? 'active' : 'not active'} (ephemeral; no credentials inspected); host execution not qualified`,
    },
  ];
}

/**
 * Verifica que un JSON de config MCP sea parseable y declare al menos un
 * server (mcpServers o servers). No inspecciona valores de servidores.
 */
export function jsonHasServers(path: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      mcpServers?: Record<string, unknown>;
      servers?: Record<string, unknown>;
    };
    const servers = parsed.mcpServers ?? parsed.servers ?? {};
    return Object.keys(servers).length > 0;
  } catch {
    return false;
  }
}

/** Bridge de runtime de Qoder: JSON con schemaVersion — sin leer credenciales. */
export function jsonHasRuntimeBridge(path: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { schemaVersion?: number };
    return typeof parsed.schemaVersion === 'number';
  } catch {
    return false;
  }
}

export function evaluateToolAudit(rows: ToolAudit[]): { passed: boolean; detail: string } {
  const byTool = new Map(rows.map((row) => [row.tool, row]));
  const missing = EXPECTED_TOOL_SURFACES.filter((tool) => !byTool.has(tool));
  if (missing.length > 0) {
    return { passed: false, detail: `missing tool surfaces: ${missing.join(', ')}` };
  }

  const nonPassing = EXPECTED_TOOL_SURFACES.map((tool) => byTool.get(tool)!)
    .filter((row) => row.status !== 'PASS')
    .map((row) => `${row.tool}=${row.status} (${row.detail})`);
  if (nonPassing.length > 0) {
    return { passed: false, detail: `non-PASS tools: ${nonPassing.join(', ')}` };
  }

  return {
    passed: true,
    detail: `${EXPECTED_TOOL_SURFACES.length}/${EXPECTED_TOOL_SURFACES.length} desktop IDE configuration surfaces PASS (not runtime task qualification)`,
  };
}

function markdown(rows: ToolAudit[], generatedAt: string, root: string): string {
  const reference = referenceProfileReports(root);
  const lines = [
    '# Auditoría de interoperabilidad de herramientas',
    '',
    `Generado: ${generatedAt}`,
    '',
    '| IDE | Estado | Tipo | Perfil | Configuración IDE | Agentes | Skills | Assets | Hooks | Engram MCP | Instrucciones |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...rows.map(
      (row) =>
        `| ${row.tool} | ${row.status} | ${row.hostType} | ${row.profile ? 'sí' : 'no'} | ${row.hostConfig ? 'sí' : 'no'} | ${row.agents ?? 'n/a'} | ${row.skills} | ${row.assets} | ${row.hooks} | ${row.engram} | ${row.instructions ? 'sí' : 'no'} |`,
    ),
    '',
    'Alcance: configuración de proyecto/perfil IDE únicamente; sin probes de comandos de productos ni ejecución de tareas en hosts.',
    '',
    '## Perfiles de referencia sin auditoría (fuera del roster de 9)',
    '',
    '| Herramienta | Perfil | Superficie presente | Por qué no se audita |',
    '|---|---|---:|---|',
    ...reference.map(
      (profile) =>
        `| ${profile.tool} | ${profile.profile} | ${profile.profilePresent && profile.surfacePresent ? 'sí' : 'no'} | ${profile.reason} |`,
    ),
    '',
    'Estos perfiles existen como especificación y como instrucciones generadas por el watchtower; no tienen contrato de identificación ni auditoría de skills/MCP. Un perfil sin superficie deja de ser una promesa muda porque está declarado acá.',
    '',
    '## Criterio — configuración de IDE, no calificación de tareas ejecutadas',
    '',
    'Este reporte verifica archivos de proyecto/perfil, skills, instrucciones, MCP y hooks declarados. No busca ni ejecuta comandos de productos, no inspecciona versiones instaladas y no prueba una sesión de IDE. Un PASS no acredita inferencia, invocación real de herramientas ni uso de memoria.',
    '',
  ];
  return lines.join('\n');
}

async function main(): Promise<void> {
  let rows = auditTools();
  // CARRERA con el sync: `tool-interoperability-sync` regenera las superficies
  // en paralelo y el audit puede verlas a medio copiar (medido 2026-11-18:
  // exit 1 dentro del autostart, exit 0 standalone). Un re-intento con espera
  // corta distingue "desactualizado" de "a medio regenerar".
  if (rows.some((row) => row.status !== 'PASS' && row.assets === 'stale')) {
    await new Promise((resolve) => setTimeout(resolve, 15000));
    rows = auditTools();
  }
  const generatedAt = new Date().toISOString();
  const scope =
    'desktop IDE project/configuration surfaces only; no product command probes or host task execution';
  const declaredProfiles = referenceProfileReports(process.cwd());
  console.log(
    JSON.stringify(
      {
        generatedAt,
        scope,
        expectedCriticalSkills: CRITICAL_SKILLS.length,
        tools: rows,
        declaredProfiles,
      },
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
      `${JSON.stringify(
        {
          generatedAt,
          scope,
          expectedCriticalSkills: CRITICAL_SKILLS.length,
          tools: rows,
          declaredProfiles,
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(dir, `tool-interoperability-${day}.md`),
      markdown(rows, generatedAt, process.cwd()),
    );
  }
  if (rows.some((row) => row.status !== 'PASS')) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
