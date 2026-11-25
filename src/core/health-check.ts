#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import type { ChildProcess } from 'child_process';
import { run, runNpxTsx } from '../../adapters/command-runner.js';
import { readDashboardPorts } from '../ops/dashboard-common.js';
import { getEffectiveProcessTimeout } from './timeout-config.js';
import { printBanner } from '../cli/banner.js';

const ROOT = process.cwd();
let quiet = false;

interface CheckLog {
  lines: string[];
  failures: number;
}

function newLog(): CheckLog {
  return { lines: [], failures: 0 };
}

function writeCheck(log: CheckLog, name: string, passed: boolean, detail?: string) {
  if (!quiet || !passed) {
    const icon = passed ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
    log.lines.push(`${icon} ${name}`);
    if (detail) log.lines.push(`       \x1b[90m${detail}\x1b[0m`);
  }
  if (!passed) log.failures++;
}

function header(log: CheckLog, title: string) {
  log.lines.push(`\n\x1b[36m=== ${title} ===\x1b[0m`);
}

/** Emite el log de un componente completo para que el orden de salida sea estable. */
function flush(log: CheckLog) {
  for (const line of log.lines) console.log(line);
}

function exists(...parts: string[]) {
  return fs.existsSync(path.resolve(ROOT, ...parts));
}

function bin(name: string): string {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function isValidPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535;
}

function readJson(...parts: string[]) {
  return JSON.parse(fs.readFileSync(path.resolve(ROOT, ...parts), 'utf-8'));
}

interface AsyncRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

/**
 * Colecta stdout/stderr de un child async con timeout y maxBuffer.
 * Base del paralelismo real: `runSync` bloquea el event loop, `run` no.
 */
function collect(
  spawnChild: () => ChildProcess,
  options: { timeout?: number; input?: string; maxBuffer?: number } = {},
): Promise<AsyncRunResult> {
  const timeout = options.timeout ?? getEffectiveProcessTimeout('default');
  const maxBuffer = options.maxBuffer ?? 1024 * 1024;
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer: { id?: NodeJS.Timeout } = {};
    const finish = (result: AsyncRunResult) => {
      if (settled) return;
      settled = true;
      if (timer.id) clearTimeout(timer.id);
      resolve(result);
    };

    let child: ChildProcess;
    try {
      child = spawnChild();
    } catch (error) {
      resolve({ status: null, stdout, stderr, error: error as Error });
      return;
    }

    const append = (current: string, chunk: Buffer | string) =>
      current.length >= maxBuffer ? current : (current + chunk.toString()).slice(0, maxBuffer);
    child.stdout?.on('data', (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.on('error', (error) => finish({ status: null, stdout, stderr, error }));
    child.on('close', (code) => finish({ status: code, stdout, stderr }));
    timer.id = setTimeout(() => {
      child.kill();
      finish({ status: null, stdout, stderr, error: new Error(`timeout after ${timeout}ms`) });
    }, timeout);

    if (child.stdin) {
      child.stdin.end(options.input ?? '');
    }
  });
}

function runAsync(
  command: string,
  args: string[],
  options: { timeout?: number; input?: string; maxBuffer?: number } = {},
): Promise<AsyncRunResult> {
  return collect(() => run(command, args, { cwd: ROOT, stdio: 'pipe' }), options);
}

async function isEngramMcpRunning(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  const r = await runAsync('tasklist', [], { timeout: 3000 });
  return r.stdout.toLowerCase().includes('engram.exe');
}

// ---- 14 checks ----

async function checkMCP(log: CheckLog) {
  header(log, 'MCP Server');
  const mcpJs = path.resolve(ROOT, 'dist/scripts/mcp/skill-server.js');
  const mcpTs = path.resolve(ROOT, 'scripts/mcp/skill-server.ts');
  writeCheck(log, 'MCP JS exists', fs.existsSync(mcpJs), 'dist/scripts/mcp/skill-server.js');
  writeCheck(log, 'MCP TS exists', fs.existsSync(mcpTs), 'scripts/mcp/skill-server.ts');
  if (!fs.existsSync(mcpJs)) return;

  const compile = () => {
    fs.mkdirSync(path.resolve(ROOT, '.runtime'), { recursive: true });
    return runAsync(
      bin('npx'),
      [
        'tsc',
        '--noEmit',
        '--noEmitOnError',
        '-p',
        'tsconfig.json',
        '--skipLibCheck',
        '--incremental',
        '--tsBuildInfoFile',
        '.runtime/tsc-health.tsbuildinfo',
      ],
      { timeout: getEffectiveProcessTimeout('tsc') },
    );
  };

  const handshake = async (): Promise<{ toolsCount: number; error?: Error }> => {
    const input =
      [
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'gentle-vanguard-health-check', version: '1.0.0' },
          },
        }),
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      ].join('\n') + '\n';
    const r = await runAsync('node', [mcpJs], {
      input,
      timeout: getEffectiveProcessTimeout('default'),
    });
    if (r.error && r.status === null) return { toolsCount: 0, error: r.error };
    const allOutput = r.stdout + '\n' + r.stderr;
    let toolsCount = 0;
    for (const line of allOutput.split('\n').filter((l) => l.trim())) {
      try {
        const parsed = JSON.parse(line);
        const tools = parsed.result?.tools || [];
        toolsCount = tools.length;
        if (toolsCount > 0) break;
      } catch {
        /* skip */
      }
    }
    return { toolsCount };
  };

  // Compilación y handshake son independientes: corren en paralelo.
  const [compileResult, handshakeResult] = await Promise.all([compile(), handshake()]);
  writeCheck(log, 'MCP TS compiles clean', compileResult.status === 0);
  writeCheck(
    log,
    'MCP tools/list responds',
    handshakeResult.toolsCount > 0,
    handshakeResult.error ? handshakeResult.error.message : `${handshakeResult.toolsCount} tools`,
  );
}

async function checkTeamMode(log: CheckLog) {
  header(log, 'Team Mode');
  const tsScript = 'src/orchestration/team-orchestrator.ts';
  writeCheck(log, 'Team Orchestrator (TS)', exists(tsScript), tsScript);
  if (!exists(tsScript)) return;
  const r = await collect(() =>
    runNpxTsx(tsScript, ['--task', 'health-check'], {
      cwd: ROOT,
      timeout: getEffectiveProcessTimeout('default'),
    }),
  );
  writeCheck(log, 'Team orchestrator responds', r.status === 0);
}

function checkSessionRef(log: CheckLog) {
  header(log, 'Session Reference System');
  writeCheck(
    log,
    'Session Ref (TS)',
    exists('src/session/session-reference-system.ts'),
    'src/session/session-reference-system.ts',
  );
}

function checkSkillFactory(log: CheckLog) {
  header(log, 'Skill Factory');
  writeCheck(
    log,
    'Skill Factory (TS)',
    exists('src/skills/skill-factory.ts'),
    'src/skills/skill-factory.ts',
  );
  writeCheck(log, 'Skill registry exists', exists('.atl', 'skill-registry.md'));
  const regPath = path.resolve(ROOT, '.atl/skill-registry.md');
  if (fs.existsSync(regPath)) {
    const lines = fs.readFileSync(regPath, 'utf-8').split('\n').length;
    writeCheck(log, 'Registry has entries', lines > 5, `${lines} lines`);
  }
}

function checkSDD(log: CheckLog) {
  header(log, 'SDD Pipeline');
  writeCheck(
    log,
    'SDD Pipeline (TS)',
    exists('src/sdd/sdd-pipeline.ts'),
    'src/sdd/sdd-pipeline.ts',
  );
}

async function checkPnpm(log: CheckLog) {
  header(log, 'pnpm Security');
  writeCheck(log, 'pnpm-lock.yaml exists', exists('pnpm-lock.yaml'));
  writeCheck(log, 'pnpm security normativa exists', exists('rules/NORMATIVA-PNPM-SECURITY.md'));
  const r = await runAsync(bin('pnpm'), ['--version'], {
    timeout: getEffectiveProcessTimeout('pnpm'),
  });
  const v = r.stdout.trim();
  writeCheck(log, 'pnpm installed', r.status === 0, `v${v}`);
}

function checkLefthook(log: CheckLog) {
  header(log, 'Lefthook Hooks');
  const candidates = ['.lefthook.yml', 'config/lefthook.yml'];
  let found = false;
  for (const f of candidates) {
    if (exists(f)) {
      writeCheck(log, 'lefthook config', true, f);
      found = true;
      break;
    }
  }
  if (!found) writeCheck(log, 'lefthook config', false);
}

function checkOptimizationStack(log: CheckLog) {
  header(log, 'Optimization Stack');
  // No dedicated TS equivalent — check cross-workspace-validator as proxy
  writeCheck(
    log,
    'Cross-workspace validator (TS)',
    exists('src/integrations/cross-workspace-validator.ts'),
    'src/integrations/cross-workspace-validator.ts',
  );
}

function parseGateguardOutput(output: string): string {
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return 'responded';
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return `server=${parsed.Status || parsed.status} latency=${parsed.LatencyMs || '?'}ms`;
  } catch {
    return 'responded';
  }
}

async function checkGateGuard(log: CheckLog) {
  header(log, 'GateGuard');
  writeCheck(
    log,
    'GateGuard (TS)',
    exists('src/security/gateguard-mcp.ts'),
    'src/security/gateguard-mcp.ts',
  );
  if (!exists('src/security/gateguard-mcp.ts')) return;
  const r = await collect(() =>
    runNpxTsx('src/security/gateguard-mcp.ts', ['--server', 'codegraph'], {
      cwd: ROOT,
      timeout: getEffectiveProcessTimeout('health_check'),
    }),
  );
  writeCheck(
    log,
    'GateGuard responds',
    r.status === 0,
    r.status === 0 ? parseGateguardOutput(r.stdout) : 'TS execution failed',
  );
}

function checkMlEmbeddings(log: CheckLog) {
  header(log, 'ML Embeddings (Auto-Delegation)');
  // Check both ml-index.json and skill-embeddings.json.
  // ml-index.json is a legacy alias — skill-embeddings.json is the active file
  // generated by skill-embedder.ts. The check passes as long as at least one
  // of the two exists (ml-index.json may be a copy/symlink created for compat).
  const mlIndexPath = path.resolve(ROOT, '.atl/ml-index.json');
  const skillEmbeddingsPath = path.resolve(ROOT, '.atl/skill-embeddings.json');

  const hasMlIndex = fs.existsSync(mlIndexPath);
  const hasSkillEmbeddings = fs.existsSync(skillEmbeddingsPath);

  writeCheck(
    log,
    'ml-index.json exists',
    hasMlIndex || hasSkillEmbeddings,
    '.atl/ml-index.json (alias for skill-embeddings.json)',
  );
  writeCheck(log, 'skill-embeddings.json exists', hasSkillEmbeddings, '.atl/skill-embeddings.json');
  writeCheck(
    log,
    'skill-embedder.ts exists',
    exists('src/skills/skill-embedder.ts'),
    'src/skills/skill-embedder.ts',
  );
  writeCheck(log, 'ml-router.ts exists', exists('src/ml/ml-router.ts'), 'src/ml/ml-router.ts');

  const primaryPath = hasSkillEmbeddings ? skillEmbeddingsPath : mlIndexPath;
  if (fs.existsSync(primaryPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(primaryPath, 'utf-8'));
      // The embeddings file nests entries under `skills`; counting top-level keys
      // reported the 6 metadata keys as "6 skills indexed".
      const cnt = Array.isArray(data.skills)
        ? data.skills.length
        : Array.isArray(data.entries)
          ? data.entries.length
          : Object.keys(data).length;
      writeCheck(log, 'embeddings parseable', true, `${cnt} skills indexed`);
    } catch {
      writeCheck(log, 'embeddings parseable', false);
    }
    const stat = fs.statSync(primaryPath);
    const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
    writeCheck(log, 'embeddings fresh (<48h)', ageHours <= 48, `${ageHours.toFixed(1)} hours old`);
  }
}

async function checkEngramRag(log: CheckLog) {
  header(log, 'Engram RAG Index');
  writeCheck(
    log,
    'engram-rag-reindex.ts exists',
    exists('src/knowledge/engram-rag-reindex.ts'),
    'src/knowledge/engram-rag-reindex.ts',
  );
  if (await isEngramMcpRunning()) {
    writeCheck(
      log,
      'engram doctor',
      true,
      'MCP server active (CLI doctor skipped to avoid DB lock)',
    );
    return;
  }
  try {
    const r = await runAsync('engram', ['doctor', '--json', '--project', 'gentle-vanguard'], {
      timeout: getEffectiveProcessTimeout('health_check'),
    });
    const output = r.stdout + r.stderr;
    const healthy =
      output.includes('"status":"ok"') ||
      output.includes('"status": "ok"') ||
      output.includes('Engram Doctor: ok');
    writeCheck(log, 'engram doctor', healthy, r.error?.message);
  } catch (e: unknown) {
    writeCheck(log, 'engram doctor', false, e instanceof Error ? e.message : 'Not accessible');
  }
}

async function checkDashboardV3(log: CheckLog) {
  header(log, 'Dashboard v3');
  const dashboardDir = path.resolve(ROOT, 'apps/web-dashboard');
  writeCheck(log, 'apps/web-dashboard exists', fs.existsSync(dashboardDir));

  // Import and use the new robust health checker
  const { checkDashboardHealth } = await import('../ops/dashboard-health-checker.js');
  const ports = readDashboardPorts();
  const envWsPort = Number(process.env.WS_PORT);
  const envVitePort = Number(process.env.VITE_DEV_PORT);
  const wsPort = isValidPort(ports?.wsPort)
    ? ports.wsPort
    : isValidPort(envWsPort)
      ? envWsPort
      : 8080;
  const vitePort = isValidPort(ports?.vitePort)
    ? ports.vitePort
    : isValidPort(envVitePort)
      ? envVitePort
      : 5173;
  const health = await checkDashboardHealth(wsPort, vitePort);
  // Decisión owner 2026-10-21: el dev server de Vite corre ON-DEMAND desde
  // command-center (no daemon del autostart). Que la UI no esté arriba NO es
  // fallo; un API proxy roto con UI arriba sí continúa siendo FAIL real.
  const onDemandNote = 'no iniciado — on-demand vía command-center (decisión owner 2026-10-21)';
  const viteVerdict = (up: boolean, ok: boolean, tail: string) => ({
    pass: up ? ok : true,
    detail: up
      ? ok
        ? tail
        : `Dashboard UI is up but API proxy failed on ${health.vitePort}`
      : `Dashboard dev server ${onDemandNote}`,
  });

  switch (health.status) {
    case 'healthy': {
      const dev = viteVerdict(
        health.viteOk,
        health.viteApiOk,
        `Dashboard UI and API proxy responding on ${health.vitePort}`,
      );
      writeCheck(
        log,
        `dashboard WS server (port ${health.port})`,
        true,
        `HTTP API responding, Vite:${health.vitePort}`,
      );
      writeCheck(log, 'dashboard dev server', dev.pass, dev.detail);
      break;
    }
    case 'degraded': {
      const dev = viteVerdict(
        health.viteOk,
        health.viteApiOk,
        `Dashboard UI and API proxy responding on ${health.vitePort}`,
      );
      writeCheck(
        log,
        `dashboard WS server (port ${health.port})`,
        false,
        'TCP open but HTTP API not responding',
      );
      writeCheck(log, 'dashboard dev server', dev.pass, dev.detail);
      break;
    }
    case 'down':
      writeCheck(
        log,
        `dashboard WS server (port ${health.port})`,
        true,
        `Not started — on-demand vía command-center (decisión owner 2026-10-21). Arrancar: npm run dashboard:start`,
      );
      writeCheck(log, 'dashboard dev server', true, `Dashboard WS + dev server ${onDemandNote}`);
      break;
  }
}

function checkMcpBridge(log: CheckLog) {
  header(log, 'MCP Bridge');
  writeCheck(
    log,
    'mcp-bridge.ts exists',
    exists('src/integrations/mcp-bridge.ts'),
    'src/integrations/mcp-bridge.ts',
  );
  const configs = ['config/skill-mcp.json', 'config/mcp-bridge.json'];
  const found = configs.filter((c) => exists(c)).length;
  writeCheck(log, 'MCP configs present', found === configs.length, `${found} of ${configs.length}`);
}

function checkCostTracking(log: CheckLog) {
  header(log, 'Cost Tracking');
  const configPath = path.resolve(ROOT, 'config/model-router.json');
  if (!fs.existsSync(configPath)) {
    writeCheck(log, 'model-router.json exists', false);
    return;
  }
  writeCheck(log, 'model-router.json exists', true);
  try {
    const config = readJson('config/model-router.json');
    writeCheck(log, 'costTracking section present', config.costTracking !== undefined);
    writeCheck(
      log,
      'routingPolicy section present',
      config.routingPolicy?.fastCheapToStrongReasoning !== undefined,
    );
  } catch (e: unknown) {
    writeCheck(
      log,
      'costTracking section present',
      false,
      e instanceof Error ? e.message : String(e),
    );
    writeCheck(log, 'routingPolicy section present', false);
  }
}

// ---- dispatch map ----

const checkMap: Record<string, (log: CheckLog) => void | Promise<void>> = {
  mcp: checkMCP,
  team: checkTeamMode,
  session: checkSessionRef,
  factory: checkSkillFactory,
  sdd: checkSDD,
  pnpm: checkPnpm,
  lefthook: checkLefthook,
  optimization: checkOptimizationStack,
  gateguard: checkGateGuard,
  costtracking: checkCostTracking,
  ml: checkMlEmbeddings,
  rag: checkEngramRag,
  dashboard: checkDashboardV3,
  mcpbridge: checkMcpBridge,
};

/**
 * Componentes con spawns/IO costosos. Corren en paralelo (spawns async, no
 * spawnSync) y su salida se emite después en el orden canónico del mapa.
 */
const PARALLEL_COMPONENTS = new Set(['mcp', 'team', 'gateguard', 'rag', 'dashboard']);

// ---- main ----

async function runAll(): Promise<number> {
  const logs = new Map<string, CheckLog>();
  const running = new Map<string, Promise<void>>();
  const order = Object.keys(checkMap);

  for (const key of order) {
    const log = newLog();
    logs.set(key, log);
    if (PARALLEL_COMPONENTS.has(key)) {
      running.set(key, Promise.resolve(checkMap[key](log)));
    }
  }
  for (const key of order) {
    if (!PARALLEL_COMPONENTS.has(key)) await checkMap[key](logs.get(key)!);
  }

  let failures = 0;
  for (const key of order) {
    const pending = running.get(key);
    if (pending) await pending;
    flush(logs.get(key)!);
    failures += logs.get(key)!.failures;
  }
  return failures;
}

async function main() {
  const args = process.argv.slice(2);
  const components: string[] = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--quiet':
      case '-q':
        quiet = true;
        break;
      case '--component':
      case '-c':
        if (i + 1 < args.length) components.push(...args[++i].split(',').map((s) => s.trim()));
        break;
      default:
        if (!args[i].startsWith('-')) components.push(args[i]);
        break;
    }
  }

  if (!quiet) printBanner('Health Check');

  let failures = 0;
  if (components.length === 0 || components.includes('all')) {
    failures = await runAll();
  } else {
    for (const comp of components) {
      const fn = checkMap[comp];
      if (!fn) {
        console.error(`\x1b[33mUnknown component: ${comp}\x1b[0m`);
        failures++;
        continue;
      }
      const log = newLog();
      await fn(log);
      flush(log);
      failures += log.failures;
    }
  }

  console.log(`\n\x1b[36m=== Health Check Complete ===\x1b[0m`);
  const ok = failures === 0;
  console.log(
    `${ok ? '\x1b[32m' : '\x1b[31m'}Status: ${ok ? 'ALL PASS' : `${failures} FAILURES`}\x1b[0m`,
  );
  process.exit(failures);
}

main().catch((e) => {
  console.error('\x1b[31mFATAL:\x1b[0m', e.message);
  process.exit(1);
});
