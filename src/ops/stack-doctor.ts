#!/usr/bin/env node
/**
 * Read-only aggregate doctor for the local stack.
 *
 * This command intentionally inspects local state only. It never starts a
 * daemon, calls a provider, repairs files, or rewrites configuration.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateOpencodeConfigObject } from '../tools/validate-opencode-config.js';

export type DoctorState = 'healthy' | 'stale' | 'conflict' | 'unverified';

export interface DoctorCheck {
  id: string;
  state: DoctorState;
  message: string;
  action?: string;
}

export interface StackDoctorReport {
  generatedAt: string;
  readOnly: true;
  scope: 'local-fast';
  status: 'PASS' | 'WARN' | 'FAIL';
  checks: DoctorCheck[];
}

export interface StackDoctorOptions {
  codexSkillsRoot?: string;
  codexConfigPath?: string;
  checkCodexEngramRuntime?: boolean;
  commandRunner?: (command: string, args: string[]) => string;
  jsonReader?: (url: string) => unknown;
  jsonRequester?: (url: string, method: 'GET' | 'POST', body?: unknown) => unknown;
  currentCodexSessionId?: string;
  currentCodexCwd?: string;
}

interface ModelCatalogSnapshot {
  timestamp?: string;
  summary?: {
    totalProviders?: number;
    providersWithAuth?: number;
    providersReachable?: number;
    totalConfiguredModels?: number;
    totalUpstreamModels?: number;
    missingInUpstream?: number;
    brokenModelProbes?: number;
  };
}

const MODEL_CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ENGRAM_WINDOWS_HOOK_MARKER = '# engram-windows-hook-command-v1: ';
const ENGRAM_HEALTH_URL = 'http://127.0.0.1:7437/health';

function checkPath(
  root: string,
  id: string,
  relativePath: string,
  message: string,
  action: string,
): DoctorCheck {
  const path = resolve(root, relativePath);
  if (!existsSync(path)) {
    return { id, state: 'stale', message: `${message}: missing`, action };
  }
  try {
    statSync(path);
    return { id, state: 'healthy', message };
  } catch {
    return { id, state: 'conflict', message: `${message}: inaccessible`, action };
  }
}

function checkJson(root: string, id: string, relativePath: string, action: string): DoctorCheck {
  const path = resolve(root, relativePath);
  if (!existsSync(path)) {
    return { id, state: 'stale', message: `${relativePath}: missing`, action };
  }
  try {
    JSON.parse(readFileSync(path, 'utf8'));
    return { id, state: 'healthy', message: `${relativePath}: parseable` };
  } catch {
    return { id, state: 'conflict', message: `${relativePath}: invalid JSON`, action };
  }
}

function checkToolProfiles(root: string): DoctorCheck {
  const tools = ['opencode', 'codex', 'zcode', 'minimax', 'vscode', 'antigravity'];
  const missing = tools.filter((tool) => !existsSync(join(root, 'config', `tool-${tool}.json`)));
  return missing.length === 0
    ? {
        id: 'tool-profiles',
        state: 'healthy',
        message: `${tools.length} tool profiles present (runtime audit remains on demand)`,
      }
    : {
        id: 'tool-profiles',
        state: 'stale',
        message: `Missing profiles: ${missing.join(', ')}`,
        action: 'npm run tools:audit',
      };
}

function checkOpencodeConfig(root: string): DoctorCheck {
  const relativePath = 'opencode.json';
  const path = resolve(root, relativePath);
  if (!existsSync(path)) {
    return {
      id: 'opencode-config',
      state: 'stale',
      message: `${relativePath}: missing`,
      action: 'node --import tsx src/tools/validate-opencode-config.ts --config opencode.json',
    };
  }
  try {
    const config = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const errors = validateOpencodeConfigObject(config);
    if (errors.length === 0) {
      return { id: 'opencode-config', state: 'healthy', message: `${relativePath}: stack-valid` };
    }
    return {
      id: 'opencode-config',
      state: 'conflict',
      message: `${relativePath}: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}`,
      action: 'node --import tsx src/tools/validate-opencode-config.ts --config opencode.json',
    };
  } catch {
    return {
      id: 'opencode-config',
      state: 'conflict',
      message: `${relativePath}: invalid JSON`,
      action: 'node --import tsx src/tools/validate-opencode-config.ts --config opencode.json',
    };
  }
}

function checkModelCatalog(root: string): DoctorCheck {
  const relativePath = 'reports/audits/model-catalog-latest.json';
  const path = resolve(root, relativePath);
  const action = 'npm run models:check:write';
  if (!existsSync(path)) {
    return {
      id: 'model-catalog',
      state: 'unverified',
      message: 'External provider catalogs have no cached probe report',
      action,
    };
  }

  try {
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as ModelCatalogSnapshot;
    const generatedAt = snapshot.timestamp ? Date.parse(snapshot.timestamp) : NaN;
    if (!Number.isFinite(generatedAt)) {
      return {
        id: 'model-catalog',
        state: 'unverified',
        message: `${relativePath}: missing or invalid timestamp`,
        action,
      };
    }
    if (Date.now() - generatedAt > MODEL_CATALOG_MAX_AGE_MS) {
      return {
        id: 'model-catalog',
        state: 'unverified',
        message: `${relativePath}: cached probe is older than 24h`,
        action,
      };
    }

    const summary = snapshot.summary ?? {};
    const missing = summary.missingInUpstream ?? 0;
    const broken = summary.brokenModelProbes ?? 0;
    if (missing > 0 || broken > 0) {
      return {
        id: 'model-catalog',
        state: 'conflict',
        message: `${relativePath}: ${missing} stale configured model(s), ${broken} broken probe(s)`,
        action,
      };
    }

    const reachable = summary.providersReachable ?? 0;
    const totalProviders = summary.totalProviders ?? 0;
    const configured = summary.totalConfiguredModels ?? 0;
    const upstream = summary.totalUpstreamModels ?? 0;
    return {
      id: 'model-catalog',
      state: 'healthy',
      message: `${relativePath}: fresh (${reachable}/${totalProviders} providers reachable, ${configured}/${upstream} models cfg/up)`,
    };
  } catch {
    return {
      id: 'model-catalog',
      state: 'unverified',
      message: `${relativePath}: invalid JSON`,
      action,
    };
  }
}

function parseTomlStringValue(line: string): string | undefined {
  const match = line.match(/=\s*(['"])(.*)\1\s*$/);
  return match?.[2]?.replace(/\\\\/g, '\\');
}

function parseEngramVersion(output: string): string | undefined {
  const tokens = output.trim().split(/\s+/);
  const engramIndex = tokens.findIndex((token) => token.toLowerCase() === 'engram');
  const candidate = engramIndex >= 0 ? tokens[engramIndex + 1] : undefined;
  if (!candidate) return undefined;
  const parts = candidate.split('.');
  if (parts.length < 2 || parts.length > 3) return undefined;
  return parts.every((part) => /^\d+$/.test(part)) ? candidate : undefined;
}

function defaultCommandRunner(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5000,
    windowsHide: true,
  }).trim();
}

function defaultJsonReader(url: string): unknown {
  return defaultJsonRequester(url, 'GET');
}

function defaultJsonRequester(url: string, method: 'GET' | 'POST', body?: unknown): unknown {
  const response = execFileSync(
    process.execPath,
    [
      '-e',
      [
        'const [url, method, body] = process.argv.slice(1);',
        'const init = { method };',
        'if (body) { init.headers = { "content-type": "application/json" }; init.body = body; }',
        'fetch(url, init).then(async r=>{const text=await r.text(); if(!r.ok){console.error(text); process.exit(2)} console.log(text)}).catch(()=>process.exit(1))',
      ].join(' '),
      url,
      method,
      body === undefined ? '' : JSON.stringify(body),
    ],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
      windowsHide: true,
    },
  );
  return JSON.parse(response);
}

function trustedProjectSource(source: string): boolean {
  return ['config', 'git_remote', 'git_root', 'git_child', 'dir_basename', 'process_override'].includes(source);
}

function checkCurrentCodexEngramSession(
  requester: (url: string, method: 'GET' | 'POST', body?: unknown) => unknown,
  sessionId: string | undefined,
  cwd: string | undefined,
): DoctorCheck | undefined {
  const id = sessionId?.trim();
  const directory = cwd?.trim();
  if (!id || !directory) return undefined;

  try {
    const authority = requester(`${ENGRAM_HEALTH_URL.replace('/health', '')}/project/current?cwd=${encodeURIComponent(directory)}`, 'GET') as {
      project?: string;
      project_source?: string;
      error_hint?: string;
    };
    const project = authority.project?.trim();
    const source = authority.project_source?.trim() ?? '';
    if (!project || authority.error_hint || !trustedProjectSource(source)) {
      return {
        id: 'codex-engram-session',
        state: 'conflict',
        message: 'Current Codex session project authority could not be confirmed',
        action: 'check Engram project detection, then start a new Codex session',
      };
    }
    const resolved = requester(`${ENGRAM_HEALTH_URL.replace('/health', '')}/runtime-sessions/resolve`, 'POST', {
      id,
      directory,
      project,
    }) as {
      id?: string;
      status?: string;
      resumed_from?: string;
    };
    const resolvedId = resolved.id?.trim() ?? '';
    const validResume = resolved.resumed_from === id && resolvedId.startsWith(`${id}:resume:`);
    if (resolved.status !== 'resolved' || (resolvedId !== id && !validResume)) {
      return {
        id: 'codex-engram-session',
        state: 'conflict',
        message: 'Current Codex session runtime identity returned an unexpected binding',
        action: 'start a new Codex session so the Engram SessionStart hook can register it',
      };
    }
    return {
      id: 'codex-engram-session',
      state: 'healthy',
      message: `Current Codex session resolves to Engram runtime ${resolvedId}`,
    };
  } catch {
    return {
      id: 'codex-engram-session',
      state: 'conflict',
      message: 'Current Codex session is not registered in Engram runtime',
      action: 'start a new Codex session, or rerun the Engram SessionStart hook with the host-provided session identity',
    };
  }
}

function checkCodexEngramIntegration(configPath: string, options: StackDoctorOptions = {}): DoctorCheck {
  const action = 'engram setup codex';
  if (!existsSync(configPath)) {
    return {
      id: 'codex-engram',
      state: 'stale',
      message: `${configPath}: missing`,
      action,
    };
  }

  try {
    const text = readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const firstLine = lines[0] ?? '';
    const markerPath = firstLine.startsWith(ENGRAM_WINDOWS_HOOK_MARKER)
      ? firstLine.slice(ENGRAM_WINDOWS_HOOK_MARKER.length).trim().replace(/^"|"$/g, '').replace(/\\\\/g, '\\')
      : undefined;
    const hasWindowsMarker =
      process.platform !== 'win32' || firstLine.startsWith(ENGRAM_WINDOWS_HOOK_MARKER);
    const mcpBlockIndex = lines.findIndex((line) => line.trim() === '[mcp_servers.engram]');
    const hasMcpBlock = mcpBlockIndex >= 0;
    const mcpBlockEnd =
      mcpBlockIndex >= 0
        ? lines.findIndex((line, index) => index > mcpBlockIndex && line.trim().startsWith('['))
        : -1;
    const mcpLines =
      mcpBlockIndex >= 0
        ? lines.slice(mcpBlockIndex + 1, mcpBlockEnd >= 0 ? mcpBlockEnd : undefined)
        : [];
    const hasMcpArgs = lines.some((line) => line.trim() === 'args = ["mcp", "--tools=agent"]');
    const commandLine = mcpLines.find((line) => line.trimStart().startsWith('command = '));
    const commandPath = commandLine ? parseTomlStringValue(commandLine) : undefined;
    const hasPromptOverride = lines.some((line) => {
      const trimmed = line.trimStart();
      return (
        trimmed.startsWith('model_instructions_file') ||
        trimmed.startsWith('experimental_compact_prompt_file')
      );
    });

    const issues: string[] = [];
    if (!hasWindowsMarker) issues.push('missing Windows hook marker');
    if (!hasMcpBlock) issues.push('missing [mcp_servers.engram]');
    if (!hasMcpArgs) issues.push('missing mcp --tools=agent args');
    if (process.platform === 'win32' && markerPath && commandPath && markerPath !== commandPath) {
      issues.push('Windows hook marker and MCP command point to different binaries');
    }
    if (hasPromptOverride) issues.push('prompt override present');

    if (issues.length > 0) {
      return {
        id: 'codex-engram',
        state: 'conflict',
        message: `Codex Engram integration: ${issues.join(', ')}`,
        action,
      };
    }

    if (options.checkCodexEngramRuntime !== false) {
      const runner = options.commandRunner ?? defaultCommandRunner;
      const readJson = options.jsonReader ?? defaultJsonReader;
      const engramCommand = commandPath ?? markerPath ?? 'engram';
      if (engramCommand !== 'engram' && !existsSync(engramCommand)) {
        return {
          id: 'codex-engram',
          state: 'conflict',
          message: `Codex Engram integration: configured binary missing (${engramCommand})`,
          action,
        };
      }

      try {
        const binaryVersion = parseEngramVersion(runner(engramCommand, ['--version']));
        const requester = options.jsonRequester ?? defaultJsonRequester;
        const health = readJson(ENGRAM_HEALTH_URL) as {
          status?: string;
          version?: string;
          capabilities?: Record<string, unknown>;
        };
        const capabilities = health.capabilities ?? {};
        const missingCapabilities = [
          'isolated_session_registration',
          'root_session_resume',
          'runtime_session_resolution',
        ].filter((capability) => capabilities[capability] !== true);
        if (health.status !== 'ok') {
          return {
            id: 'codex-engram',
            state: 'conflict',
            message: `Codex Engram runtime unhealthy (${health.status ?? 'unknown status'})`,
            action,
          };
        }
        if (binaryVersion && health.version && binaryVersion !== health.version) {
          return {
            id: 'codex-engram',
            state: 'conflict',
            message: `Codex Engram runtime version mismatch: config binary ${binaryVersion}, server ${health.version}`,
            action: 'restart Engram server, then run engram setup codex',
          };
        }
        if (missingCapabilities.length > 0) {
          return {
            id: 'codex-engram',
            state: 'conflict',
            message: `Codex Engram runtime missing capabilities: ${missingCapabilities.join(', ')}`,
            action: 'update Engram and run engram setup codex',
          };
        }
        const currentSessionCheck = checkCurrentCodexEngramSession(
          requester,
          options.currentCodexSessionId ?? process.env.CODEX_SESSION_ID,
          options.currentCodexCwd ?? process.cwd(),
        );
        if (currentSessionCheck && currentSessionCheck.state !== 'healthy') return currentSessionCheck;
        return {
          id: 'codex-engram',
          state: 'healthy',
          message: currentSessionCheck
            ? `Codex Engram integration configured (runtime ${health.version ?? binaryVersion ?? 'unknown'}; current session registered)`
            : `Codex Engram integration configured (runtime ${health.version ?? binaryVersion ?? 'unknown'})`,
        };
      } catch {
        return {
          id: 'codex-engram',
          state: 'unverified',
          message: 'Codex Engram integration configured; local runtime health not reachable',
          action: 'start Engram server, then run npm run stack:doctor',
        };
      }
    }

    return {
      id: 'codex-engram',
      state: 'healthy',
      message: 'Codex Engram integration configured',
    };
  } catch {
    return {
      id: 'codex-engram',
      state: 'conflict',
      message: `${configPath}: inaccessible`,
      action,
    };
  }
}

export function collectStackDoctorReport(
  root = process.cwd(),
  options: StackDoctorOptions = {},
): StackDoctorReport {
  const resolved = resolve(root);
  const codexSkillsRoot = options.codexSkillsRoot ?? join(homedir(), '.codex', 'skills');
  const codexConfigPath = options.codexConfigPath ?? join(homedir(), '.codex', 'config.toml');
  const checks: DoctorCheck[] = [
    checkJson(resolved, 'model-router', 'config/model-router.json', 'npm run models:check'),
    checkJson(
      resolved,
      'session-config',
      'config/session-autostart.config.json',
      'npm run session:autostart:detached',
    ),
    checkOpencodeConfig(resolved),
    checkPath(
      resolved,
      'nexus',
      '.runtime/gentle-vanguard.db',
      'Nexus operational database present',
      'npm run db:init',
    ),
    checkPath(
      resolved,
      'graphify',
      'graphify-out/graph.json',
      'Graphify snapshot present',
      'npm run graphify -- update .',
    ),
    checkPath(
      resolved,
      'skills-registry',
      '.atl/skill-registry.md',
      'Skill registry present',
      'npm run skills:sync',
    ),
    checkPath(
      resolved,
      'codex-gv-shorts',
      resolve(codexSkillsRoot, 'gv-shorts-skill'),
      'Codex gv-shorts skill synchronized',
      'npm run tools:codex-assets',
    ),
    checkToolProfiles(resolved),
    checkCodexEngramIntegration(codexConfigPath, options),
    checkModelCatalog(resolved),
  ];

  const blocking = checks.filter((check) => check.state === 'stale' || check.state === 'conflict');
  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    scope: 'local-fast',
    status: blocking.length > 0 ? 'FAIL' : checks.some((check) => check.state === 'unverified') ? 'WARN' : 'PASS',
    checks,
  };
}

function render(report: StackDoctorReport): void {
  console.log(`Stack doctor (${report.scope}, read-only): ${report.status}`);
  for (const check of report.checks) {
    const action = check.action ? ` -> ${check.action}` : '';
    console.log(`  [${check.state.toUpperCase()}] ${check.id}: ${check.message}${action}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = collectStackDoctorReport();
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else render(report);
  if (report.status === 'FAIL') process.exitCode = 1;
}
