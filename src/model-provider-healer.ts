#!/usr/bin/env node
/**
 * Model Provider Healer — auto-detect y auto-recovery de errores de proveedor LLM.
 *
 * PROBLEMA QUE RESUELVE:
 *   opencode falla con errores de proveedor (p.ej.
 *   "litellm.UnsupportedParamsError: Bedrock doesn't support tool calling without
 *   `tools=` param" con model group kimi-2-5) y el stack no detecta ni recupera.
 *   Los mecanismos existentes (correction-rules-engine, self-diagnosis, watchtower)
 *   operan sobre session scores / infraestructura, NO sobre errores de proveedor LLM.
 *
 * SOLUCION:
 *   Escanea los logs de opencode + .session buscando firmas de error conocidas
 *   (config/model-health.json). Cuando el modelo ACTIVO falla, lo marca como
 *   unhealthy en .runtime/model-health.json (con cooldown) y auto-switch al
 *   modelo nativo opencode/deepseek-v4-flash-free vía model-switch.ts.
 *
 * Uso:
 *   npx tsx src/model-provider-healer.ts            # scan + auto-switch si aplica
 *   npx tsx src/model-provider-healer.ts --scan     # solo detectar (no cambia nada)
 *   npx tsx src/model-provider-healer.ts --status   # estado de salud actual
 *   npx tsx src/model-provider-healer.ts --clear    # limpiar estado de salud
 *   npx tsx src/model-provider-healer.ts --quiet    # minimo output (pipeline)
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  appendFileSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from 'fs';
import { join, dirname, resolve } from 'path';
import { homedir } from 'os';
import { runNpxTsxSync } from './core/run-command.js';
import { loadConfigFile } from './core/config-loader.js';
import { pathToFileURL } from 'url';

const ROOT = resolve(process.cwd());
const CONFIG_PATH = join(ROOT, 'config', 'model-health.json');
const STATE_PATH = join(ROOT, '.runtime', 'model-health.json');
const ACTIVE_MODEL_PATH = join(ROOT, '.runtime', 'model-active.json');
const CORRECTION_LOG = join(ROOT, '.session', 'corrections-log.jsonl');
const GLOBAL_OPENCODE_CONFIG = join(homedir(), '.config', 'opencode', 'opencode.json');

interface HealthConfig {
  enabled: boolean;
  fallbackModel: string;
  cooldownMinutes: number;
  maxDetectionsPerModel: number;
  stateFile: string;
  logSources: string[];
  signatures: Array<{
    id: string;
    pattern: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    action: 'switch-to-fallback' | 'record-only';
    description: string;
  }>;
}

interface ModelHealthEntry {
  model: string;
  provider: string;
  status: 'healthy' | 'unhealthy';
  reason: string;
  signatureId: string;
  detections: number;
  lastDetectedAt: string;
  cooldownUntil: string;
  autoSwitched: boolean;
}

interface HealthState {
  version: string;
  updatedAt: string;
  models: Record<string, ModelHealthEntry>;
}

const DEFAULT_STATE: HealthState = {
  version: '1.0.0',
  updatedAt: new Date().toISOString(),
  models: {},
};

// ─── Config / State helpers ───────────────────────────────────────────

function loadJsonSafe<T>(path: string, fallback: T | null = null): T | null {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function loadConfig(): HealthConfig {
  return loadConfigFile<HealthConfig>('model-health').data;
}

function loadState(): HealthState {
  const state = loadJsonSafe<HealthState>(STATE_PATH, { ...DEFAULT_STATE });
  return { ...DEFAULT_STATE, ...state };
}

function saveState(state: HealthState): void {
  state.updatedAt = new Date().toISOString();
  const dir = dirname(STATE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

function loadActiveModel(): { model: string; provider: string } {
  const state = loadJsonSafe<{ model?: string; provider?: string }>(ACTIVE_MODEL_PATH, null);
  if (state?.model) return { model: state.model, provider: state.provider || 'unknown' };
  // Fallback: read from global opencode config
  const global = loadJsonSafe<{ model?: string }>(GLOBAL_OPENCODE_CONFIG, null);
  return { model: global?.model || 'opencode/deepseek-v4-flash-free', provider: 'opencode' };
}

function log(msg: string, level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' = 'INFO'): void {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const colors: Record<string, string> = {
    INFO: '\x1b[36m',
    WARN: '\x1b[33m',
    ERROR: '\x1b[31m',
    SUCCESS: '\x1b[32m',
  };
  console.log(`${colors[level] ?? ''}[${ts}] [${level}] ${msg}\x1b[0m`);
  try {
    if (!existsSync(dirname(CORRECTION_LOG)))
      mkdirSync(dirname(CORRECTION_LOG), { recursive: true });
    appendFileSync(CORRECTION_LOG, `${ts} [${level}] ${msg}\n`);
  } catch {
    /* non-fatal */
  }
}

// ─── Log scanning ─────────────────────────────────────────────────────

function expandLogSource(source: string): string[] {
  // Support ~/ prefix and .session glob
  let path = source;
  if (path.startsWith('~/')) {
    path = join(homedir(), path.slice(2));
  }
  if (!path.includes('*')) {
    return [resolve(ROOT, path)];
  }
  const dirPart = dirname(path);
  const filePart = resolve(ROOT, path).split(/[\\/]/).pop() || '';
  const absDir = resolve(ROOT, dirPart);
  if (!existsSync(absDir)) return [];
  return readdirSync(absDir)
    .filter((f) =>
      new RegExp(`^${filePart.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(
        f,
      ),
    )
    .map((f) => join(absDir, f));
}

function tailLogFile(filePath: string, maxBytes = 2 * 1024 * 1024): string {
  try {
    const stats = statSync(filePath);
    if (stats.size === 0) return '';
    const offset = Math.max(0, stats.size - maxBytes);
    const fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(Math.min(stats.size, maxBytes));
    readSync(fd, buf, 0, buf.length, offset);
    closeSync(fd);
    return buf.toString('utf-8');
  } catch {
    return '';
  }
}

function scanLogs(config: HealthConfig): Array<{
  signatureId: string;
  pattern: string;
  severity: string;
  action: string;
  model: string | null;
  provider: string | null;
  snippet: string;
  at: string;
}> {
  const hits: Array<{
    signatureId: string;
    pattern: string;
    severity: string;
    action: string;
    model: string | null;
    provider: string | null;
    snippet: string;
    at: string;
  }> = [];

  const files = new Set<string>();
  for (const source of config.logSources) {
    for (const f of expandLogSource(source)) {
      if (existsSync(f)) files.add(f);
    }
  }

  for (const file of files) {
    const content = tailLogFile(file);
    if (!content) continue;
    // Only consider ERROR-level lines to avoid matching our own commands/permissions
    const errorLines = content.split(/\r?\n/).filter((l) => /level=ERROR/.test(l));
    if (errorLines.length === 0) continue;
    for (const sig of config.signatures) {
      const re = new RegExp(sig.pattern, 'i');
      const line = errorLines.find((l) => re.test(l));
      if (!line) continue;
      const match = line.match(re);
      const idx = match?.index ?? 0;
      const snippet = line
        .slice(Math.max(0, idx - 120), idx + 220)
        .replace(/\s+/g, ' ')
        .trim();
      // Extract model/provider from the ERROR line (not our own INFO commands)
      const modelMatch = line.match(/model(?:ID)?=([^\s,]+)/);
      const providerMatch = line.match(/provider(?:ID)?=([^\s,]+)/);
      hits.push({
        signatureId: sig.id,
        pattern: sig.pattern,
        severity: sig.severity,
        action: sig.action,
        model: modelMatch?.[1] ?? null,
        provider: providerMatch?.[1] ?? null,
        snippet,
        at: new Date().toISOString(),
      });
    }
  }
  return hits;
}

// ─── Heal logic ───────────────────────────────────────────────────────

function switchToFallback(config: HealthConfig): boolean {
  const target = config.fallbackModel || 'opencode/deepseek-v4-flash-free';
  const modelSwitch = join(ROOT, 'scripts', 'utilities', 'MODEL-ROUTER', 'model-switch.ts');
  if (existsSync(modelSwitch)) {
    const res = runNpxTsxSync(modelSwitch, ['switch', target], {
      cwd: ROOT,
      stdio: 'pipe',
      timeout: 30000,
    });
    return res.status === 0;
  }
  // Manual fallback: write model-active.json + global config
  try {
    const state = {
      model: target,
      provider: target.split('/')[0],
      changedAt: new Date().toISOString(),
      source: 'model-healer',
    };
    if (!existsSync(dirname(ACTIVE_MODEL_PATH)))
      mkdirSync(dirname(ACTIVE_MODEL_PATH), { recursive: true });
    writeFileSync(ACTIVE_MODEL_PATH, JSON.stringify(state, null, 2), 'utf-8');
    if (existsSync(GLOBAL_OPENCODE_CONFIG)) {
      const global = loadJsonSafe<Record<string, unknown>>(GLOBAL_OPENCODE_CONFIG, {}) ?? {};
      global.model = target;
      global.small_model = global.small_model ?? target;
      writeFileSync(GLOBAL_OPENCODE_CONFIG, JSON.stringify(global, null, 2) + '\n', 'utf-8');
    }
    return true;
  } catch {
    return false;
  }
}

function heal(quiet: boolean): {
  scannedFiles: number;
  detections: number;
  activeModel: string;
  activeUnhealthy: boolean;
  switched: boolean;
  switchTarget: string | null;
  unhealthy: string[];
} {
  const config = loadConfig();
  if (!config?.enabled) {
    if (!quiet) log('Model health checking disabled in config', 'WARN');
    return {
      scannedFiles: 0,
      detections: 0,
      activeModel: '',
      activeUnhealthy: false,
      switched: false,
      switchTarget: null,
      unhealthy: [],
    };
  }

  const hits = scanLogs(config);
  const state = loadState();
  const active = loadActiveModel();
  const activeUnhealthy = state.models[active.model]?.status === 'unhealthy';

  if (hits.length === 0) {
    if (!quiet) log('No provider error signatures found in logs', 'INFO');
    return {
      scannedFiles: 0,
      detections: 0,
      activeModel: active.model,
      activeUnhealthy,
      switched: false,
      switchTarget: null,
      unhealthy: [],
    };
  }

  if (!quiet) log(`Found ${hits.length} provider error signature(s)`, 'WARN');
  let switched = false;
  let switchTarget: string | null = null;
  const unhealthy: string[] = [];

  for (const hit of hits) {
    const model = hit.model;
    const provider = hit.provider;
    if (!model) continue;

    const entry = state.models[model] || {
      model,
      provider: provider || '',
      status: 'healthy',
      reason: '',
      signatureId: '',
      detections: 0,
      lastDetectedAt: '',
      cooldownUntil: '',
      autoSwitched: false,
    };
    const reason = hit.snippet.slice(0, 200);
    const sameCooldownHit =
      entry.status === 'unhealthy' &&
      entry.signatureId === hit.signatureId &&
      entry.reason === reason &&
      entry.cooldownUntil &&
      new Date(entry.cooldownUntil).getTime() > Date.now();
    if (!sameCooldownHit) {
      entry.detections++;
    }
    entry.reason = reason;
    entry.signatureId = hit.signatureId;
    entry.lastDetectedAt = hit.at;
    if (sameCooldownHit) {
      unhealthy.push(model);
      state.models[model] = entry;
      continue;
    }

    const cooldownMs = config.cooldownMinutes * 60000;
    const inCooldown = entry.cooldownUntil && new Date(entry.cooldownUntil).getTime() > Date.now();
    const maxed = entry.detections >= config.maxDetectionsPerModel;

    if (
      hit.action === 'switch-to-fallback' &&
      (inCooldown || maxed || hit.severity === 'critical')
    ) {
      entry.status = 'unhealthy';
      entry.cooldownUntil = new Date(Date.now() + cooldownMs).toISOString();
      entry.autoSwitched = true;
      unhealthy.push(model);
      if (!quiet)
        log(
          `Model ${model} marked unhealthy (${hit.signatureId}) — will switch to fallback`,
          'ERROR',
        );
      if (model === active.model) {
        switchTarget = config.fallbackModel;
      }
    } else if (hit.action === 'switch-to-fallback' && hit.severity === 'critical') {
      entry.status = 'unhealthy';
      entry.cooldownUntil = new Date(Date.now() + cooldownMs).toISOString();
      unhealthy.push(model);
      if (model === active.model) {
        switchTarget = config.fallbackModel;
      }
    } else {
      entry.status = 'unhealthy';
      entry.cooldownUntil = new Date(Date.now() + cooldownMs).toISOString();
      unhealthy.push(model);
      if (model === active.model && hit.action === 'switch-to-fallback') {
        switchTarget = config.fallbackModel;
      }
    }
    state.models[model] = entry;
  }

  if (switchTarget && !activeUnhealthy) {
    if (!quiet)
      log(`Active model ${active.model} is unhealthy — switching to ${switchTarget}`, 'ERROR');
    switched = switchToFallback(config);
    if (switched) {
      log(`[MODEL-HEALER] Auto-switched active model to ${switchTarget}`, 'SUCCESS');
    } else {
      log(
        `[MODEL-HEALER] FAILED to switch to ${switchTarget} — manual intervention required`,
        'ERROR',
      );
    }
  } else if (activeUnhealthy) {
    if (!quiet) log(`Active model ${active.model} already marked unhealthy — in cooldown`, 'WARN');
  }

  saveState(state);
  if (!quiet)
    log(`Health state updated: ${Object.keys(state.models).length} models tracked`, 'INFO');
  return {
    scannedFiles: 0,
    detections: hits.length,
    activeModel: active.model,
    activeUnhealthy: activeUnhealthy || switchTarget !== null,
    switched,
    switchTarget,
    unhealthy,
  };
}

// ─── CLI ──────────────────────────────────────────────────────────────

function printStatus(): void {
  const state = loadState();
  const active = loadActiveModel();
  console.log('=== MODEL PROVIDER HEALTH ===');
  console.log(`Active model: ${active.model}`);
  const entries = Object.entries(state.models);
  if (entries.length === 0) {
    console.log('  No models tracked yet. Run scan to detect provider errors.');
    return;
  }
  for (const [model, e] of entries) {
    const icon = e.status === 'unhealthy' ? '❌' : '✅';
    console.log(`  ${icon} ${model} (${e.provider || 'unknown'}) — ${e.status}`);
    if (e.status === 'unhealthy') {
      console.log(`     reason: ${e.reason.slice(0, 120)}`);
      console.log(
        `     detections: ${e.detections} | cooldown until: ${e.cooldownUntil} | auto-switched: ${e.autoSwitched}`,
      );
    }
  }
  console.log(`\nConfig: ${CONFIG_PATH}`);
  console.log(`State: ${STATE_PATH}`);
}

function main(): void {
  const args = process.argv.slice(2);
  const quiet = args.includes('--quiet');
  const mode = args.includes('--scan')
    ? 'scan'
    : args.includes('--status')
      ? 'status'
      : args.includes('--clear')
        ? 'clear'
        : 'heal';

  if (mode === 'status') {
    printStatus();
    return;
  }
  if (mode === 'clear') {
    saveState({ ...DEFAULT_STATE });
    if (!quiet) log('Model health state cleared', 'SUCCESS');
    return;
  }
  if (mode === 'scan') {
    const config = loadConfig();
    const hits = scanLogs(config);
    console.log(JSON.stringify({ status: 'ok', detections: hits.length, hits }, null, 2));
    return;
  }

  const result = heal(quiet);
  if (!quiet) {
    console.log(
      JSON.stringify(
        {
          status: result.switched ? 'recovered' : result.activeUnhealthy ? 'degraded' : 'ok',
          ...result,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      JSON.stringify({
        status: result.switched ? 'recovered' : result.activeUnhealthy ? 'degraded' : 'ok',
        activeModel: result.activeModel,
        unhealthy: result.unhealthy,
        switched: result.switched,
        switchTarget: result.switchTarget,
      }),
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
