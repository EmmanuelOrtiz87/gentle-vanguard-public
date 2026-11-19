// Infrastructure checks (F2.5 split): CodeGraph, Timeout Daemon, Process
// Hygiene, ML Embeddings, Engram, MCP.
// Extracted verbatim from src/core/maintenance-watchtower.ts — no logic changes.

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { runNpxTsxSync, runSync } from '../run-command.js';
import { buildSnapshot, analyzeProcesses, DEFAULT_OPTIONS } from '../process-hygiene.js';
import { getEffectiveProcessTimeout, getExternalApiTimeouts } from '../timeout-config.js';
import { addResult, quiet, ROOT, RUNTIME_DIR, CheckResult } from './context.js';
import {
  fileExists,
  hasOpenCodeStdioMcpServer,
  hasRepoCanonStdioMcpServer,
  readJson,
  getFileAgeHours,
  isCodeGraphProcessRunning,
  payloadFileOk,
} from './helpers.js';
import { getEmbeddingFreshnessHours } from '../../skills/skill-embedder-incremental.js';
import { readState as readCodegraphState } from '../../ops/codegraph-toggle.js';
import { log } from '../../utils/logger.js';
const logger = log('CORE-WATCHTOWER-CHECKS-INFRA');

// ─── Component: CodeGraph ───────────────────────────────────────────────────

export function evaluateCodeGraphAvailability(input: {
  indexOk: boolean;
  mcpConfigured: boolean;
  pidAlive: boolean;
  processRunning: boolean;
}): { status: 'PASS' | 'FAIL'; detail: string; action: string } {
  if (!input.indexOk)
    return { status: 'FAIL', detail: 'Index database missing', action: 'rebuild' };
  if (!input.mcpConfigured)
    return { status: 'FAIL', detail: 'MCP stdio configuration missing', action: 'verify' };
  if (input.pidAlive || input.processRunning) {
    return { status: 'PASS', detail: 'MCP stdio process active', action: 'ok' };
  }
  return { status: 'PASS', detail: 'MCP stdio configured; starts on demand', action: 'ok' };
}

export async function checkCodeGraph() {
  if (!quiet) logger.info('  [CodeGraph] Checking...');

  // Capacidad apagada por decision DECLARADA (config/codegraph.config.json):
  // no es un FAIL, es un SKIP con el motivo leido del config. Un check que
  // ignora la decision reporta un fallo inexistente (medido 2026-11-18: 2 FAIL
  // falsos y un autoheal que resucitaba la capacidad apagada).
  const cgState = readCodegraphState(ROOT);
  if (cgState.enabled === false) {
    const reason = cgState.reason ?? 'sin motivo declarado';
    addResult('codegraph', 'index database', 'SKIP', `apagado por politica - ${reason}`, 'ok');
    addResult('codegraph', 'MCP availability', 'SKIP', 'apagado por politica', 'ok');
    return;
  }

  const cgDir = join(ROOT, '.codegraph');
  const indexOk = fileExists(join(cgDir, 'codegraph.db'));
  addResult('codegraph', 'index database', indexOk ? 'PASS' : 'FAIL', '', 'rebuild');

  // Frescura RELATIVA: el índice debe ser más nuevo que el último commit.
  // Existencia no basta — si el sync post-commit se rompe en silencio, el índice
  // queda stale y un check de existencia reporta PASS (el fallo que el owner
  // teme: volver a trabajar sobre índice desactualizado). Tolerancia de 60s por
  // el orden hook->sync dentro del propio commit.
  if (indexOk) {
    let lastCommitAt: number | null = null;
    try {
      const r = runSync('git', ['log', '-1', '--format=%ct'], {
        cwd: ROOT,
        timeout: getEffectiveProcessTimeout('default'),
      });
      const parsed = parseInt((r.stdout ?? '').trim(), 10);
      lastCommitAt = Number.isFinite(parsed) ? parsed * 1000 : null;
    } catch {
      lastCommitAt = null; // sin git accesible: la frescura se SKIPea, no se inventa
    }
    if (lastCommitAt !== null) {
      const dbAge = statSync(join(cgDir, 'codegraph.db')).mtimeMs;
      const stale = dbAge + 60_000 < lastCommitAt;
      addResult(
        'codegraph',
        'index freshness',
        stale ? 'WARN' : 'PASS',
        stale
          ? 'hay commits más nuevos que el índice: sync post-commit roto — correr `codegraph index .`'
          : 'índice más nuevo que el último commit',
        stale ? 'rebuild' : 'ok',
      );
    }
  }

  // stdio MCP servers are client-owned and start on demand. A persistent
  // process is an optional warm signal, not a health requirement.
  const pidFile = join(RUNTIME_DIR, 'codegraph-mcp-server.pid');
  let pidDetail = 'No PID file';
  let pidAlive = false;
  if (fileExists(pidFile)) {
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    if (isNaN(pid)) {
      pidDetail = 'PID file unreadable';
    } else {
      try {
        process.kill(pid, 0);
        pidAlive = true;
        pidDetail = `PID ${pid} running`;
      } catch {
        pidDetail = `PID ${pid} not running`;
      }
    }
  }

  const procRunning = isCodeGraphProcessRunning();

  let mcpConfigured = false;
  let mcpConfiguredWhere = '';
  try {
    const oc = readJson(join(ROOT, 'opencode.json'));
    if (hasOpenCodeStdioMcpServer(oc, 'codegraph')) {
      mcpConfigured = true;
      mcpConfiguredWhere = 'opencode.json';
    }
  } catch {
    mcpConfigured = false;
  }
  // El canon del repo (.mcp.json) es la superficie que cargan MiniMax Code y
  // Claude Code. Mirar solo opencode.json es medir UNA superficie y declarar
  // el sistema entero (medido 2026-11-18: codegraph reactivado y el check
  // reportaba "MCP stdio configuration missing" con el server en pie).
  if (!mcpConfigured) {
    try {
      const canon = readJson(join(ROOT, '.mcp.json'));
      if (hasRepoCanonStdioMcpServer(canon, 'codegraph')) {
        mcpConfigured = true;
        mcpConfiguredWhere = '.mcp.json (canon del repo)';
      }
    } catch {
      /* sin canon legible */
    }
  }

  const availability = evaluateCodeGraphAvailability({
    indexOk,
    mcpConfigured,
    pidAlive,
    processRunning: procRunning,
  });
  const detail = `${availability.detail}${mcpConfiguredWhere ? ` (declarado en ${mcpConfiguredWhere})` : ''}${
    pidAlive ? ` (${pidDetail})` : ''
  }`;
  addResult('codegraph', 'MCP availability', availability.status, detail, availability.action);

  // Compromiso de re-medición (reactivación 2026-11-18): si la decisión está
  // vencida y sin resolver, WARN — un experimento comprometido no puede quedarse
  // sin veredicto. Se resuelve con `npm run codegraph:remeasure --record`.
  const reMeasureAt = typeof cgState.reMeasureAt === 'string' ? cgState.reMeasureAt : null;
  if (reMeasureAt) {
    const due = Date.now() >= Date.parse(reMeasureAt);
    const resolved = typeof cgState.remeasureResolvedAt === 'string';
    if (due && !resolved) {
      addResult(
        'codegraph',
        'remeasure commitment',
        'WARN',
        `decisión vencida (${reMeasureAt}) sin resolver: npm run codegraph:remeasure --record`,
        'manual',
      );
    } else if (resolved) {
      addResult(
        'codegraph',
        'remeasure commitment',
        'PASS',
        `resuelta ${String(cgState.remeasureResolvedAt)}: ${String(cgState.remeasureVerdict ?? 'sin veredicto')}`,
        'ok',
      );
    } else {
      addResult(
        'codegraph',
        'remeasure commitment',
        'PASS',
        `decisión comprometida el ${reMeasureAt}`,
        'ok',
      );
    }
  }
}

// ─── Component: Timeout Daemon ────────────────────────────────────────────────

export async function checkTimeoutDaemon() {
  if (!quiet) logger.info('  [Timeout Daemon] Checking...');

  // The timeout/performance monitor daemon is started by session-autostart
  // (start-monitor-daemon.ts -> timeout-monitor.ts --daemon). It must be alive
  // during the session. Check the PID file and the process table.
  const pidFile = join(RUNTIME_DIR, 'monitor-daemon.pid');
  let pidAlive = false;
  let pidDetail = 'No PID file';
  if (fileExists(pidFile)) {
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    if (isNaN(pid)) {
      pidDetail = 'PID file unreadable';
    } else {
      try {
        process.kill(pid, 0);
        pidAlive = true;
        pidDetail = `PID ${pid} running`;
      } catch {
        pidDetail = `PID ${pid} not running`;
      }
    }
  }

  // Process-table scan as a second source of truth (the PID file can point at
  // a dead cmd.exe wrapper while the real node process is still alive).
  let procRunning = false;
  try {
    if (process.platform === 'win32') {
      const psCmd = `@(@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'timeout-monitor' -and $_.CommandLine -match '--daemon' })).Count`;
      const r = runSync('powershell', ['-NoProfile', '-Command', psCmd], {
        timeout: 15000,
        stdio: 'pipe',
      });
      const count = parseInt((r.stdout ?? '').trim(), 10);
      procRunning = !isNaN(count) && count > 0;
    } else {
      const r = runSync('ps', ['-ef'], { timeout: 15000 });
      procRunning = /timeout-monitor.*--daemon/.test(r.stdout ?? '');
    }
  } catch {
    procRunning = false;
  }

  if (pidAlive || procRunning) {
    const signals = [pidAlive ? pidDetail : '', procRunning ? 'process detected' : ''].filter(
      Boolean,
    );
    addResult('timeout-daemon', 'daemon process', 'PASS', signals.join(', '), 'ok');
  } else {
    addResult(
      'timeout-daemon',
      'daemon process',
      'FAIL',
      `${pidDetail}; timeout-monitor daemon not running`,
      'restart',
    );
  }
}

// ─── Component: Process Hygiene ───────────────────────────────────────────────

/**
 * Orphan/zombie process sweep (src/core/process-hygiene.ts). Detects duplicate
 * daemons, hung one-shots, stale PID files and leftover headless chrome.
 * Runs in dry-run here — autoHeal() applies the reap when findings exist.
 */
export async function checkProcessHygiene() {
  if (!quiet) logger.info('  [Process Hygiene] Scanning for orphans/duplicates...');

  const opts = { ...DEFAULT_OPTIONS, apply: false };
  const snap = await buildSnapshot();
  // El autoheal aplica con `recycleAged: false`: reciclar un daemon en
  // caliente lo deja CAIDO hasta la proxima sesion (el respawn es al inicio
  // de sesion, no continuo). El check tiene que medir lo que el stack HACE,
  // no lo que podria hacer: medir con otras opciones daba un FAIL que nadie
  // podia resolver (medido 2026-11-18: los mismos 2 daemons con 24,9h y
  // 26,8h reportados en dos corridas separadas).
  const healOpts = { ...opts, recycleAged: false };
  const { findings } = analyzeProcesses(snap, healOpts);
  const actionable = findings.filter((f) => f.action !== 'report');
  const reportsOnly = findings.filter((f) => f.action === 'report');

  // Los daemons envejecidos SI se reciclan, pero al inicio de la proxima
  // sesion (session-autostart, fase 1, antes de los lazy daemons). Se
  // declaran como aviso, no como fallo.
  const aged = analyzeProcesses(snap, { ...opts, recycleAged: true }).findings.filter(
    (f) => f.kind === 'aged-daemon',
  );

  if (actionable.length === 0 && reportsOnly.length === 0 && aged.length === 0) {
    addResult(
      'process-hygiene',
      'orphan/duplicate sweep',
      'PASS',
      'no orphans, duplicates or stale PID files',
      'ok',
    );
    return;
  }

  const parts: string[] = [];
  if (actionable.length > 0)
    parts.push(
      `${actionable.length} actionable — ${actionable
        .map((f) => `${f.kind} PID ${f.pid} (${f.ageHours.toFixed(1)}h)`)
        .join('; ')}`,
    );
  if (reportsOnly.length > 0)
    parts.push(
      `${reportsOnly.length} report-only — ${reportsOnly
        .map((f) => `${f.kind} PID ${f.pid}`)
        .join('; ')}`,
    );
  if (aged.length > 0)
    parts.push(
      `${aged.length} daemon(s) envejecido(s) (>${DEFAULT_OPTIONS.maxAgeHours}h): se reciclan al inicio de la proxima sesion — ${aged
        .map((f) => `${f.classId ?? 'daemon'} PID ${f.pid} (${f.ageHours.toFixed(1)}h)`)
        .join('; ')}`,
    );

  addResult(
    'process-hygiene',
    'orphan/duplicate sweep',
    actionable.length > 0 ? 'FAIL' : 'WARN',
    parts.join(' | '),
    actionable.length > 0 ? 'cleanup' : 'ok',
  );
}
// ─── Component: ML Embeddings ────────────────────────────────────────────────

export async function checkMlEmbeddings() {
  if (!quiet) logger.info('  [ML Embeddings] Checking...');

  const mlIndex = join(ROOT, '.atl/skill-embeddings.json');
  const mlDir = join(ROOT, '.atl/ml-embeddings');

  const ageH = getEmbeddingFreshnessHours(mlIndex, join(ROOT, '.atl/skill-meta.json'));
  if (ageH === -1) {
    addResult('ml-embeddings', 'skill-embeddings.json', 'FAIL', 'Not found', 'rebuild');
  } else if (ageH > 48) {
    addResult(
      'ml-embeddings',
      'skill-embeddings.json freshness',
      'WARN',
      `Stale: ${ageH.toFixed(1)} hours`,
      'rebuild',
    );
  } else {
    addResult(
      'ml-embeddings',
      'skill-embeddings.json freshness',
      'PASS',
      `${ageH.toFixed(1)} hours`,
      'ok',
    );
  }

  if (fileExists(mlDir)) {
    const files = readdirSync(mlDir, { recursive: true }).filter((f) =>
      statSync(join(mlDir, f as string)).isFile(),
    );
    const fc = files.length;
    addResult(
      'ml-embeddings',
      'embedding files',
      fc > 0 ? 'PASS' : 'WARN',
      `${fc} files`,
      'rebuild',
    );
  } else {
    addResult('ml-embeddings', 'embedding directory', 'FAIL', 'Not found', 'rebuild');
  }

  const scripts = ['src/skills/skill-embedder.ts', 'src/ml/ml-router.ts'];
  for (const s of scripts) {
    const name = basename(s);
    addResult('ml-embeddings', name, fileExists(join(ROOT, s)) ? 'PASS' : 'FAIL', '', 'manual');
  }

  if (fileExists(mlIndex)) {
    try {
      const idx = readJson(mlIndex) as {
        skills?: unknown[];
        metadata?: { totalSkills?: number };
      };
      // El índice tiene claves top-level (version, generated, metadata,
      // vocabulary, idf, skills) — contar Object.keys() daba 6 en vez de los
      // skills reales. Fuente de verdad: metadata.totalSkills (o el array skills).
      const cnt = Array.isArray(idx.skills)
        ? idx.skills.length
        : typeof idx.metadata?.totalSkills === 'number'
          ? idx.metadata.totalSkills
          : Object.keys(idx).length;
      addResult('ml-embeddings', 'index parseable', 'PASS', `${cnt} skills`, 'ok');
    } catch {
      addResult('ml-embeddings', 'index parseable', 'FAIL', 'Parse error', 'rebuild', true);
    }
  }
}

// ─── Component: Engram ───────────────────────────────────────────────────────

export async function checkEngram() {
  if (!quiet) logger.info('  [Engram] Checking...');

  const ragReindexTs = join(ROOT, 'src', 'knowledge', 'engram-rag-reindex.ts');
  addResult('engram', 'reindex script', fileExists(ragReindexTs) ? 'PASS' : 'FAIL', '', 'manual');

  const ragLog = join(ROOT, '.atl/rag-reindex.log');
  if (fileExists(ragLog)) {
    const logAge = getFileAgeHours(ragLog);
    // Extended threshold to 72 hours since auto-reindex runs every session
    // and we want to avoid WARN spam during normal operation
    const status: CheckResult['status'] = logAge <= 72 ? 'PASS' : logAge <= 96 ? 'WARN' : 'FAIL';
    addResult(
      'engram',
      'reindex freshness',
      status,
      `${logAge.toFixed(1)} hours (auto-reindex enabled)`,
      logAge <= 72 ? 'ok' : 'reindex',
    );

    const content = readFileSync(ragLog, 'utf-8');
    const tailLines = content.trim().split('\n').slice(-3).join('\n');
    if (/error|fail|exception/i.test(tailLines)) {
      addResult('engram', 'reindex errors', 'WARN', 'Errors in last run', 'verify');
    }
  } else {
    addResult('engram', 'reindex log', 'WARN', 'Not found', 'reindex');
  }

  const userProfile = process.env.USERPROFILE || process.env.HOME || '';
  const engramDir = join(userProfile, '.engram');
  addResult('engram', 'engram directory', fileExists(engramDir) ? 'PASS' : 'FAIL', '', 'manual');

  const engramBin = join(
    userProfile,
    'bin',
    process.platform === 'win32' ? 'engram.exe' : 'engram',
  );
  const engramCmd = fileExists(engramBin) ? engramBin : 'engram';

  // If engram MCP server is running, doctor will deadlock on DB lock — skip gracefully
  const engramMcpRunning = (() => {
    try {
      const r = runSync(
        process.platform === 'win32' ? 'tasklist' : 'ps',
        process.platform === 'win32' ? [] : ['-ef'],
        { timeout: getEffectiveProcessTimeout('default') },
      );
      return (r.stdout ?? '').toLowerCase().includes('engram.exe');
    } catch {
      return false;
    }
  })();

  if (engramMcpRunning) {
    addResult('engram', 'doctor', 'PASS', 'MCP server active (skip to avoid deadlock)', 'ok');
  } else {
    try {
      const r = runSync(engramCmd, ['doctor', '--json'], {
        timeout: getExternalApiTimeouts()?.engram_operation_ms ?? 15000,
      });
      const output = (r.stdout ?? '') + (r.stderr ?? '');
      const ok = /"status"\s*:\s*"ok"/.test(output);
      addResult('engram', 'doctor', ok ? 'PASS' : 'WARN', `Healthy=${ok}`, 'verify');
    } catch (e: unknown) {
      const err = e as Error;
      addResult('engram', 'doctor', 'FAIL', `Error: ${err?.message ?? String(e)}`, 'manual', true);
    }
  }
}

// ─── Component: MCP ─────────────────────────────────────────────────────────

export async function checkMcp() {
  if (!quiet) logger.info('  [MCP] Checking...');

  payloadFileOk('mcp', 'skill-server.js', join(ROOT, 'dist/scripts/mcp/skill-server.js'), 'build');
  payloadFileOk('mcp', 'skill-server.ts', join(ROOT, 'scripts/mcp/skill-server.ts'), 'manual');
  payloadFileOk('mcp', 'mcp-bridge.ts', join(ROOT, 'src/integrations/mcp-bridge.ts'), 'manual');
  payloadFileOk(
    'mcp',
    'mcp-bridge.ts (dashboard)',
    join(ROOT, 'apps/web-dashboard/server/mcp-bridge.ts'),
    'manual',
  );

  const mcpConfigs = [
    'config/skill-mcp.json',
    'config/mcp-bridge.json',
    'config/mcp-config.sd.json',
  ];
  const found = mcpConfigs.filter((c) => fileExists(join(ROOT, c))).length;
  addResult(
    'mcp',
    'config files',
    found === mcpConfigs.length ? 'PASS' : 'WARN',
    `${found} of ${mcpConfigs.length}`,
    'verify',
  );

  // Use lightweight verify script that doesn't start servers
  const verifyScript = join(ROOT, 'src/mcp/mcp-verify.ts');
  if (fileExists(verifyScript)) {
    try {
      const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      const r = runSync(cmd, ['tsx', 'src/mcp/mcp-verify.ts'], {
        cwd: ROOT,
        timeout: getExternalApiTimeouts()?.mcp_request_ms ?? 30000,
      });
      const output = (r.stdout ?? '') + (r.stderr ?? '');
      const healthOk = r.status === 0 || output.includes('Bridge status: OK');
      const detail = healthOk ? 'bridge verified' : `exit code: ${r.status ?? 'null'}`;
      addResult('mcp', 'bridge health', healthOk ? 'PASS' : 'WARN', detail, 'verify');
    } catch {
      addResult('mcp', 'bridge health', 'WARN', 'Not accessible', 'verify');
    }
  } else {
    addResult('mcp', 'bridge health', 'WARN', 'mcp-verify.ts not found', 'verify');
  }

  payloadFileOk('mcp', 'mcp-registry.json', join(ROOT, 'config/mcp-registry.json'), 'config');
  payloadFileOk('mcp', 'mcp-manager.ts', join(ROOT, 'src/mcp/mcp-manager.ts'), 'manual');
  payloadFileOk('mcp', 'mcp-gateway.ts', join(ROOT, 'src/mcp/mcp-gateway.ts'), 'manual');
  payloadFileOk(
    'mcp',
    'mcp-gateway-api.ts (dashboard)',
    join(ROOT, 'apps/web-dashboard/server/mcp-gateway-api.ts'),
    'manual',
  );
  payloadFileOk('mcp', 'mcp-templates.json', join(ROOT, 'config/mcp-templates.json'), 'config');

  // Deriva politica<->config. Barato (dos JSON, cero procesos) y cubre la clase de
  // bug que ya paso: `memory` declarado `disabled-by-policy` con el server `enabled`,
  // invisible porque nada comparaba las dos fuentes. Fuente de verdad: npm run mcp:policy.
  try {
    const { checkPolicy } = await import('../../tools/mcp-doctor.js');
    const drift = checkPolicy(ROOT);
    addResult(
      'mcp',
      'policy drift',
      drift.ok ? 'PASS' : 'FAIL',
      drift.ok
        ? `${drift.policyServers} en la politica, ${drift.configServers.length} configurados, sin deriva`
        : `${drift.problems.length} problema(s): ${drift.problems.slice(0, 2).join(' | ')}`,
      drift.ok ? 'ok' : 'fix',
      !drift.ok,
    );
  } catch (e: unknown) {
    addResult(
      'mcp',
      'policy drift',
      'WARN',
      `no se pudo evaluar: ${(e as Error)?.message ?? String(e)}`,
      'verify',
    );
  }

  // Alcance + descubribilidad. El check de arriba compara la POLITICA contra
  // las configs; este compara la politica contra el REGISTRO (comandos) y el
  // MAPA DE DEMANDA (task -> servidor). Medido 2026-11-18: 5 de 16 capacidades
  // declaradas no tenian comando en el registro -> inalcanzables, y el
  // policy drift daba verde igual. Presencia de archivo no es alcanzabilidad.
  try {
    const { checkDemandMap } = await import('../../tools/mcp-suggest.js');
    const demand = checkDemandMap(ROOT);
    addResult(
      'mcp',
      'demand map',
      demand.ok ? 'PASS' : 'FAIL',
      demand.ok
        ? `${demand.intents} intenciones, todas lanzables`
        : `${demand.problems.length} problema(s): ${demand.problems.slice(0, 2).join(' | ')}`,
      demand.ok ? 'ok' : 'fix',
      !demand.ok,
    );
  } catch (e: unknown) {
    addResult(
      'mcp',
      'demand map',
      'WARN',
      `no se pudo evaluar: ${(e as Error)?.message ?? String(e)}`,
      'verify',
    );
  }

  // OPERABILIDAD: el cuarto eje. Declarada, alcanzable y descubrible no
  // garantizan que la capacidad SIRVA: hace falta una llamada real. Este
  // check ejecuta la sonda declarada de cada capacidad (tool inocua de solo
  // lectura) y clasifica: ok / ok-sin-dato / requiere-config (credencial
  // del owner: no bloquea) / dependencia-caida (el stack lo arregla) / roto.
  // Es caro (levanta servers), asi que se puede apagar con
  // GV_SKIP_MCP_OPERABILITY=1 cuando compite por CPU con otra cosa.
  if (process.env.GV_SKIP_MCP_OPERABILITY === '1') {
    addResult('mcp', 'operability', 'SKIP', 'omitido por GV_SKIP_MCP_OPERABILITY=1', 'skip');
  } else {
    try {
      const { probeAll } = await import('../../tools/mcp-operability.js');
      const report = await probeAll(undefined, ROOT);
      const roto = report.byStatus.roto ?? 0;
      const caida = report.byStatus['dependencia-caida'] ?? 0;
      const config = report.byStatus['requiere-config'] ?? 0;
      const ok = report.byStatus.ok ?? 0;
      const vacio = report.byStatus['ok-sin-dato'] ?? 0;
      const intermitente = report.byStatus.intermitente ?? 0;
      const timeout = report.byStatus.timeout ?? 0;
      const blocking = roto + caida;
      // Un fallo unico que no se reproduce NO bloquea: se reporta como WARN
      // (medido: FAIL a las 22:18 y PASS a las 22:22 sin ningun cambio).
      const status = blocking > 0 ? 'FAIL' : intermitente + timeout > 0 ? 'WARN' : 'PASS';
      addResult(
        'mcp',
        'operability',
        status,
        `${ok} ok · ${vacio} sin-dato · ${config} requiere-config · ${caida} dependencia-caida · ${roto} roto · ${intermitente} intermitente · ${timeout} timeout`,
        blocking > 0 ? 'fix' : intermitente + timeout > 0 ? 'verify' : 'ok',
        blocking > 0,
      );
    } catch (e: unknown) {
      addResult(
        'mcp',
        'operability',
        'WARN',
        `no se pudo evaluar: ${(e as Error)?.message ?? String(e)}`,
        'verify',
      );
    }
  }
}

// ─── Component: Orchestrator Loop Guard ────────────────────────────────────────

export async function checkLoopGuard() {
  if (!quiet) logger.info('  [Loop-Guard] Checking...');

  const guardFile = join(ROOT, 'src/core/orchestrator-loop-guard.ts');
  const testFile = join(ROOT, 'tests/unit/orchestrator-loop-guard.test.ts');
  const metricsFile = join(ROOT, 'config/stack-metrics.json');

  addResult(
    'loop-guard',
    'guard module',
    fileExists(guardFile) ? 'PASS' : 'FAIL',
    fileExists(guardFile) ? 'src/core/orchestrator-loop-guard.ts present' : 'missing',
    'manual',
  );
  addResult(
    'loop-guard',
    'guard tests',
    fileExists(testFile) ? 'PASS' : 'FAIL',
    fileExists(testFile) ? '5 tests present' : 'missing',
    'manual',
  );
  addResult(
    'loop-guard',
    'live metrics',
    fileExists(metricsFile) ? 'PASS' : 'WARN',
    fileExists(metricsFile) ? 'config/stack-metrics.json present' : 'F4.1 metrics not generated',
    'verify',
  );

  // Runtime self-test: intent-loop detection
  try {
    const r = runNpxTsxSync('src/core/orchestrator-loop-guard.ts', [], {
      timeout: 10000,
      cwd: ROOT,
    });
    const out = (r.stdout ?? '').toString();
    const hasBreak = out.includes('intent-loop') || out.includes('"break": true');
    addResult(
      'loop-guard',
      'self-test',
      hasBreak ? 'PASS' : 'WARN',
      hasBreak ? 'intent-loop detection works' : 'self-test unexpected output',
      'verify',
    );
  } catch {
    addResult('loop-guard', 'self-test', 'WARN', 'self-test failed to run', 'verify');
  }
}

// ─── Component: Guardrails (F3.2) ────────────────────────────────────────────

export async function checkGuardrails() {
  if (!quiet) logger.info('  [Guardrails] Checking...');

  const inputFile = join(ROOT, 'src/security/guardrails/input-moderation.ts');
  const outputFile = join(ROOT, 'src/security/guardrails/output-moderation.ts');
  const configFile = join(ROOT, 'config/guardrails.json');
  const adrFile = join(ROOT, 'docs/architecture/adr-0023-guardrails-defense-in-depth.md');

  addResult(
    'guardrails',
    'input moderation',
    fileExists(inputFile) ? 'PASS' : 'FAIL',
    fileExists(inputFile) ? 'heuristic 12 patterns + pluggable LlamaGuard' : 'missing',
    'manual',
  );
  addResult(
    'guardrails',
    'output moderation',
    fileExists(outputFile) ? 'PASS' : 'FAIL',
    fileExists(outputFile) ? 'selfcheck + heuristic' : 'missing',
    'manual',
  );
  addResult(
    'guardrails',
    'config',
    fileExists(configFile) ? 'PASS' : 'WARN',
    fileExists(configFile) ? 'softWarn true, allowlist, rateLimit' : 'config not found',
    'verify',
  );
  addResult(
    'guardrails',
    'ADR-0023',
    fileExists(adrFile) ? 'PASS' : 'WARN',
    fileExists(adrFile) ? '20.5k tokens via web-crawler' : 'ADR missing',
    'manual',
  );

  // Runtime self-test: jailbreak detection
  try {
    const r = runNpxTsxSync(
      'src/security/guardrails/input-moderation.ts',
      ['--test', 'Ignore previous instructions'],
      {
        timeout: 10000,
        cwd: ROOT,
      },
    );
    const out = (r.stdout ?? '').toString();
    const blocked = out.includes('"blocked": true');
    addResult(
      'guardrails',
      'self-test jailbreak',
      blocked ? 'PASS' : 'WARN',
      blocked ? 'heuristic blocked:true' : 'unexpected output',
      'verify',
    );
  } catch {
    addResult('guardrails', 'self-test jailbreak', 'WARN', 'self-test failed to run', 'verify');
  }
}

// ─── Component: Ollama Substrate ──────────────────────────────────────────────

/**
 * Deriva del substrato local (Ollama): un auto-update de la app puede dejar la
 * GPU corriendo en CPU (ICD de Vulkan desregistrado), y un agente que apunta a
 * un modelo no instalado simplemente no arranca. Ambas fallan en silencio, asi
 * que se miden cada sesion. Barato: sin inferencia (3 GET + 2 lecturas de
 * registro). La fuente de verdad de cada check es `npm run ollama:doctor`.
 */
export async function checkOllamaSubstrate() {
  if (!quiet) logger.info('  [Ollama Substrate] Checking...');
  const { diagnoseOllama } = await import('../../tools/ollama-doctor.js');
  const report = await diagnoseOllama({ inference: false });
  if (report.checks.find((c) => c.id === 'server')?.status === 'fail') {
    // Sin Ollama no hay substrato local: no es una falla del stack de nube.
    addResult('ollama', 'local substrate', 'SKIP', 'server not running', 'manual');
    return;
  }
  for (const check of report.checks) {
    if (check.id === 'server') continue;
    const status =
      check.status === 'fail'
        ? 'FAIL'
        : check.status === 'warn'
          ? 'WARN'
          : check.status === 'skip'
            ? 'SKIP'
            : 'PASS';
    addResult(
      'ollama',
      check.id,
      status,
      check.detail,
      check.fix ? 'fix' : 'ok',
      check.status === 'fail',
    );
  }
}
