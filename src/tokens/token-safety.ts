#!/usr/bin/env node
/**
 * Token safety cross-tool — audita las superficies de contexto/compactación
 * de las 8 herramientas de escritorio que operan sobre el stack.
 *
 * Read-only: nunca modifica configuración host-owned (~/.kimi-code, ~/.minimax,
 * ~/.zcode, ~/.qoder, ...). Donde la herramienta no expone umbrales locales
 * (compactación server-side) el reporte es INFO con hábitos operativos, para
 * no fingir cobertura que el producto no permite.
 *
 * Uso:
 *   npm run token:safety            # tabla legible
 *   npm run token:safety -- --json  # salida estructurada
 *   npm run token:safety -- --strict  # exit 1 si una superficie auditable está en WARN
 */

import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { nativeCompaction } from './native-compaction.js';
import {
  minimaxDbPath,
  opencodeDbPath,
  readRolloutText,
  walkJsonl,
} from './token-ingest/readers.js';

export type TokenSafetyStatus = 'PASS' | 'WARN' | 'INFO';

export type TomlScalar = string | number | boolean;

export interface TokenSafetyReport {
  tool: string;
  surface: 'config-local' | 'server-managed';
  status: TokenSafetyStatus;
  checks: string[];
  notes: string[];
}

function readText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** Lee escalares top-level de un TOML sin dependencias (se detiene en la primera tabla). */
export function parseTomlScalars(raw: string): Record<string, TomlScalar> {
  const out: Record<string, TomlScalar> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) break;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z0-9_]+$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (!value.startsWith('"') && !value.startsWith("'")) {
      const comment = value.indexOf('#');
      if (comment >= 0) value = value.slice(0, comment).trim();
    }
    if (value === 'true' || value === 'false') out[key] = value === 'true';
    else if (value !== '' && Number.isFinite(Number(value))) out[key] = Number(value);
    else if (
      value.length >= 2 &&
      (value[0] === '"' || value[0] === "'") &&
      value[value.length - 1] === value[0]
    )
      out[key] = value.slice(1, -1);
    else out[key] = value;
  }
  return out;
}

/** Fuente única del guardrail de Codex: la usan doctor, tools:audit y token:safety. */
export function codexTokenSafetyProblems(scalars: Record<string, TomlScalar>): string[] {
  const window = Number(scalars.model_context_window);
  const compact = Number(scalars.model_auto_compact_token_limit);
  const problems: string[] = [];
  if (!Number.isFinite(window) || window <= 0) problems.push('model_context_window ausente');
  if (!Number.isFinite(compact) || compact <= 0)
    problems.push('model_auto_compact_token_limit ausente');
  if (Number.isFinite(window) && Number.isFinite(compact) && compact >= window * 0.9)
    problems.push('auto-compact >= 90% del contexto (no compacta a tiempo)');
  if (!(Number(scalars.project_doc_max_bytes) > 0)) problems.push('project_doc_max_bytes ausente');
  return problems;
}

function tomlSectionScalars(raw: string, section: string): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  let current = '';
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      current = trimmed.slice(1, -1).trim();
      continue;
    }
    if (current !== section) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z0-9_]+$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    const comment = value.indexOf('#');
    if (comment >= 0) value = value.slice(0, comment).trim();
    if (value !== '' && Number.isFinite(Number(value))) out[key] = Number(value);
    else if (value.length >= 2) out[key] = value.slice(1, -1);
  }
  return out;
}

/** Claves de seguridad que deben coincidir entre el perfil del repo y el host. */
const CODEX_PARITY_KEYS = [
  'model',
  'model_context_window',
  'model_auto_compact_token_limit',
  'model_post_turn_compact_threshold_percent',
  'project_doc_max_bytes',
] as const;

export interface CodexConfigParity {
  hostPresent: boolean;
  conflicts: Array<{ key: string; repo: TomlScalar; host: TomlScalar }>;
  /** ¿El host marca ESTE repo como trusted? null si no hay config de host. */
  repoTrusted: boolean | null;
}

/**
 * Paridad repo vs host de la config de Codex (2026-11-18): el perfil del repo
 * es la política y el host es la sesión real. Si divergen en las claves de
 * seguridad, la config "correcta" del repo no se aplica — el mismo patron del
 * incidente projectless. Read-only: el host nunca se modifica.
 */
export function codexConfigParity(
  repoRaw: string | null,
  hostRaw: string | null,
  repoRoot: string,
): CodexConfigParity {
  if (hostRaw === null) return { hostPresent: false, conflicts: [], repoTrusted: null };
  const repo = repoRaw === null ? {} : parseTomlScalars(repoRaw);
  const host = parseTomlScalars(hostRaw);
  const conflicts: CodexConfigParity['conflicts'] = [];
  for (const key of CODEX_PARITY_KEYS) {
    if (repo[key] === undefined || host[key] === undefined) continue;
    if (repo[key] !== host[key]) conflicts.push({ key, repo: repo[key], host: host[key] });
  }
  return { hostPresent: true, conflicts, repoTrusted: repoTrustedInHostConfig(hostRaw, repoRoot) };
}

/** Busca `[projects.'<repoRoot>'] trust_level = "trusted"` en la config del host. */
export function repoTrustedInHostConfig(hostRaw: string, repoRoot: string): boolean {
  const target = repoRoot.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  let inTarget = false;
  for (const line of hostRaw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const section = trimmed.slice(1, -1).trim();
      const match = section.match(/^projects\.(['"])(.+)\1$/);
      const path = match?.[2].replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      inTarget = path === target;
      continue;
    }
    if (!inTarget) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0 || trimmed.slice(0, eq).trim() !== 'trust_level') continue;
    const value = trimmed
      .slice(eq + 1)
      .replace(/#.*$/, '')
      .trim()
      .replace(/^["']|["']$/g, '');
    return value === 'trusted';
  }
  return false;
}

export function auditCodexTokenSafety(configPath: string): TokenSafetyReport {
  const raw = readText(configPath);
  if (raw === null) {
    return {
      tool: 'Codex',
      surface: 'config-local',
      status: 'WARN',
      checks: ['perfil .codex/config.toml ausente'],
      notes: [],
    };
  }
  const scalars = parseTomlScalars(raw);
  const window = Number(scalars.model_context_window);
  const compact = Number(scalars.model_auto_compact_token_limit);
  const checks = codexTokenSafetyProblems(scalars);
  return {
    tool: 'Codex',
    surface: 'config-local',
    status: checks.length === 0 ? 'PASS' : 'WARN',
    checks,
    notes:
      checks.length === 0
        ? [`compact ${compact}/${window} (${Math.round((compact / window) * 100)}%)`]
        : [],
  };
}

export function auditKimiTokenSafety(configPath: string): TokenSafetyReport {
  const raw = readText(configPath);
  if (raw === null) {
    return {
      tool: 'Kimi',
      surface: 'server-managed',
      status: 'INFO',
      checks: [],
      notes: [
        'sin ~/.kimi-code/config.toml: aplican defaults del CLI; la app de escritorio compacta server-side',
        'si se usa Kimi Code CLI, declarar [loop_control] reserved_context_size para compactar antes del límite',
      ],
    };
  }
  const loop = tomlSectionScalars(raw, 'loop_control');
  const reserved = Number(loop.reserved_context_size);
  const checks: string[] = [];
  if (!Number.isFinite(reserved) || reserved <= 0)
    checks.push('[loop_control] reserved_context_size ausente (sin gatillo de compactación)');
  if (!/max_context_size\s*=/.test(raw)) checks.push('ningún modelo declara max_context_size');
  if (Number.isFinite(reserved) && reserved > 0 && reserved < 16000)
    checks.push(`reserved_context_size=${reserved} deja margen corto para el resumen`);
  return {
    tool: 'Kimi',
    surface: 'config-local',
    status: checks.length === 0 ? 'PASS' : 'WARN',
    checks,
    notes: checks.length === 0 ? [`reserved_context_size=${reserved}`] : [],
  };
}

interface MinimaxProfile {
  models: number;
  missingContext: number;
  oneMillionOption: boolean;
  defaultWindow: number | null;
}

export function parseMinimaxConfig(raw: string): MinimaxProfile {
  let models = 0;
  let missingContext = 0;
  let inLimit = false;
  let sawContext = false;
  let defaultWindow: number | null = null;
  let oneMillionOption = false;
  for (const line of raw.split(/\r?\n/)) {
    if (
      /^\s{6}[A-Za-z0-9_.-]+:\s*$/.test(line) &&
      !/^\s{6}(limit|variants|options|capabilities|modalities|thinking_config|contextWindow)/.test(
        line,
      )
    ) {
      if (models > 0 && !sawContext) missingContext += 1;
      models += 1;
      sawContext = false;
      inLimit = false;
      continue;
    }
    if (/^\s{8}limit:\s*$/.test(line)) {
      inLimit = true;
      continue;
    }
    if (inLimit) {
      const match = /^\s{10}context:\s*(\d+)\s*$/.exec(line);
      if (match) {
        sawContext = true;
        inLimit = false;
      } else if (/^\s{8}\S/.test(line)) {
        inLimit = false;
      }
    }
    const defaultMatch = /^defaultModelContextWindow:\s*(\d+)\s*$/.exec(line);
    if (defaultMatch) defaultWindow = Number(defaultMatch[1]);
    if (/^\s+-\s+1000000\s*$/.test(line)) oneMillionOption = true;
  }
  if (models > 0 && !sawContext) missingContext += 1;
  return { models, missingContext, oneMillionOption, defaultWindow };
}

export function auditMinimaxTokenSafety(configPath: string): TokenSafetyReport {
  const raw = readText(configPath);
  if (raw === null) {
    return {
      tool: 'MiniMax Code',
      surface: 'server-managed',
      status: 'INFO',
      checks: [],
      notes: ['sin ~/.minimax/config.yaml local: ventana de contexto definida por la app/servidor'],
    };
  }
  const profile = parseMinimaxConfig(raw);
  const checks: string[] = [];
  if (profile.models === 0) checks.push('no se declararon modelos en config.yaml');
  if (profile.missingContext > 0)
    checks.push(`${profile.missingContext} modelo(s) sin limit.context explícito`);
  const notes: string[] = [];
  if (profile.defaultWindow !== null)
    notes.push(`defaultModelContextWindow=${profile.defaultWindow}`);
  if (profile.oneMillionOption)
    notes.push('ventana 1M disponible con hint higher_usage: usar 512k salvo necesidad real');
  return {
    tool: 'MiniMax Code',
    surface: 'config-local',
    status: checks.length === 0 ? 'PASS' : 'WARN',
    checks,
    notes,
  };
}

interface ZcodeProfile {
  models: number;
  missingContext: number;
  maxContext: number;
}

export function parseZcodeConfig(raw: string): ZcodeProfile {
  const profile: ZcodeProfile = { models: 0, missingContext: 0, maxContext: 0 };
  try {
    const parsed = JSON.parse(raw) as {
      provider?: Record<string, { models?: Record<string, { limit?: { context?: unknown } }> }>;
    };
    for (const provider of Object.values(parsed.provider ?? {})) {
      for (const model of Object.values(provider.models ?? {})) {
        profile.models += 1;
        const context = Number(model.limit?.context);
        if (!Number.isFinite(context) || context <= 0) profile.missingContext += 1;
        else profile.maxContext = Math.max(profile.maxContext, context);
      }
    }
  } catch {
    return { models: 0, missingContext: 0, maxContext: 0 };
  }
  return profile;
}

export function auditZcodeTokenSafety(configPath: string): TokenSafetyReport {
  const raw = readText(configPath);
  if (raw === null) {
    return {
      tool: 'ZCode',
      surface: 'server-managed',
      status: 'INFO',
      checks: [],
      notes: ['sin ~/.zcode/v2/config.json local'],
    };
  }
  const profile = parseZcodeConfig(raw);
  const checks: string[] = [];
  if (profile.models === 0) checks.push('config.json ilegible o sin providers/modelos');
  if (profile.missingContext > 0)
    checks.push(`${profile.missingContext} modelo(s) sin limit.context`);
  return {
    tool: 'ZCode',
    surface: 'config-local',
    status: checks.length === 0 ? 'PASS' : 'WARN',
    checks,
    notes: [
      ...(profile.maxContext > 0 ? [`contexto máximo declarado=${profile.maxContext}`] : []),
      'umbral de compactación no expuesto: gestión de la app (verificar comportamiento con GLM-5.3)',
    ],
  };
}

export function auditOpencodeTokenSafety(configPath: string): TokenSafetyReport {
  const raw = readText(configPath);
  if (raw === null) {
    return {
      tool: 'OpenCode',
      surface: 'config-local',
      status: 'WARN',
      checks: ['opencode.json (canon del repo) ausente'],
      notes: [],
    };
  }
  let compaction: { auto?: unknown; prune?: unknown } = {};
  try {
    const parsed = JSON.parse(raw) as { compaction?: { auto?: unknown; prune?: unknown } };
    compaction = parsed.compaction ?? {};
  } catch {
    return {
      tool: 'OpenCode',
      surface: 'config-local',
      status: 'WARN',
      checks: ['opencode.json no parsea como JSON'],
      notes: [],
    };
  }
  const checks: string[] = [];
  if (compaction.auto !== true) checks.push('compaction.auto no está en true');
  if (compaction.prune !== true) checks.push('compaction.prune no está en true');
  return {
    tool: 'OpenCode',
    surface: 'config-local',
    status: checks.length === 0 ? 'PASS' : 'WARN',
    checks,
    notes: checks.length === 0 ? ['compaction auto+prune activos'] : [],
  };
}

function serverManaged(tool: string, notes: string[]): TokenSafetyReport {
  return { tool, surface: 'server-managed', status: 'INFO', checks: [], notes };
}

// ─── Efectividad: ¿la sesión corrió donde vive la config? ─────────────────────
// Presencia ≠ aplicación. Una config en disco no gobierna nada si la app abrió
// otra carpeta (caso medido: sesiones Codex projectless quemaron la cuota 5h con
// el perfil del repo intacto). La evidencia de aplicación la emiten las propias
// apps y ya se ingiere para telemetría; acá solo se lee.

export type EffectivenessStatus = 'applied' | 'not-applied' | 'unknown';

export interface EffectivenessReport {
  tool: string;
  status: EffectivenessStatus;
  workspace: string | null;
  detail: string;
  /** warn = el repo declara config para esta tool; not-applied es un hallazgo real. */
  severity: 'warn' | 'info';
}

export function normalizeWorkspace(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function workspaceMatchesRoot(workspace: string | null, root: string): boolean {
  if (!workspace) return false;
  const w = normalizeWorkspace(workspace);
  const r = normalizeWorkspace(root);
  return w === r || w.startsWith(`${r}/`) || r.startsWith(`${w}/`);
}

function readFirstLine(path: string, maxBytes = 262144): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const buffer = Buffer.alloc(maxBytes);
    const read = readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, read).toString('utf8').split('\n')[0];
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

export function latestCodexWorkspace(home: string): string | null {
  const roots = [
    join(home, '.codex', 'sessions'),
    join(home, '.codex', 'archived_sessions'),
  ].filter((dir) => existsSync(dir));
  let latest: { path: string; mtime: number } | null = null;
  for (const file of roots.flatMap((root) => walkJsonl(root))) {
    try {
      const mtime = statSync(file).mtimeMs;
      if (!latest || mtime > latest.mtime) latest = { path: file, mtime };
    } catch {
      /* ignore */
    }
  }
  if (!latest) return null;
  let firstLine: string | null;
  if (latest.path.endsWith('.zst')) {
    try {
      firstLine = readRolloutText(latest.path).split('\n')[0] ?? null;
    } catch {
      return null;
    }
  } else {
    firstLine = readFirstLine(latest.path);
  }
  if (!firstLine) return null;
  try {
    const payload = (JSON.parse(firstLine) as { payload?: { cwd?: unknown } }).payload;
    return typeof payload?.cwd === 'string' ? payload.cwd : null;
  } catch {
    return null;
  }
}

function sqliteLatest(dbPath: string | null, query: string, column: string): string | null {
  if (!dbPath || !existsSync(dbPath)) return null;
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const row = db.prepare(query).get() as Record<string, unknown> | undefined;
    const value = row?.[column];
    return typeof value === 'string' && value !== '' ? value : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function effectiveness(
  tool: string,
  root: string,
  workspace: string | null,
  severity: 'warn' | 'info',
  source: string,
): EffectivenessReport {
  if (workspace === null) {
    return {
      tool,
      status: 'unknown',
      workspace: null,
      detail: `sin evidencia local (${source})`,
      severity,
    };
  }
  const applied = workspaceMatchesRoot(workspace, root);
  return {
    tool,
    status: applied ? 'applied' : 'not-applied',
    workspace,
    detail: applied
      ? `última sesión dentro del repo (${source})`
      : `última sesión fuera del repo: ${workspace} (${source})`,
    severity,
  };
}

export function codexEffectiveness(root: string, home = homedir()): EffectivenessReport {
  return effectiveness('Codex', root, latestCodexWorkspace(home), 'warn', 'session_meta.cwd');
}

export function opencodeEffectiveness(
  root: string,
  dbPath = opencodeDbPath(),
): EffectivenessReport {
  const workspace = sqliteLatest(
    dbPath,
    'SELECT directory FROM session ORDER BY time_updated DESC LIMIT 1',
    'directory',
  );
  return effectiveness('OpenCode', root, workspace, 'warn', 'session.directory');
}

export function minimaxEffectiveness(root: string, dbPath = minimaxDbPath()): EffectivenessReport {
  const workspace = sqliteLatest(
    dbPath,
    "SELECT COALESCE(NULLIF(workspace_dir, ''), project_workspace_dir) AS dir FROM local_runtime_sessions ORDER BY updated_at_ms DESC LIMIT 1",
    'dir',
  );
  return effectiveness(
    'MiniMax Code',
    root,
    workspace,
    'info',
    'local_runtime_sessions.workspace_dir',
  );
}

export function zcodeEffectiveness(root: string, dbPath: string | null): EffectivenessReport {
  const workspace = sqliteLatest(
    dbPath,
    'SELECT workspace_path FROM tasks ORDER BY updated_at DESC LIMIT 1',
    'workspace_path',
  );
  return effectiveness('ZCode', root, workspace, 'info', 'tasks.workspace_path');
}

export interface QoderSessionEvidence {
  file: string;
  workspace: string | null;
  compactions: number;
  lastCompaction: { preTokens: number; postTokens: number } | null;
  /**
   * Uso medido SOLO en eventos de compactación (`compactUsage`). Es evidencia
   * parcial: Qoder no emite usage por request y sumarlo como total sería una
   * cifra falsa (el owner rechazó esa práctica).
   */
  compactionUsage: {
    events: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    credits: number;
  } | null;
}

/**
 * Transcript más reciente de Qoder (~/.qoder/projects/<slug>/*.jsonl).
 * Qoder no emite usage por request, pero cada entrada registra `cwd` y los
 * eventos de compactación (`compactMetadata.preTokens/postTokens`): alcanza
 * para probar en qué workspace corrió y si la compactación se disparó.
 */
export function latestQoderSession(home = homedir()): QoderSessionEvidence | null {
  const base = join(home, '.qoder', 'projects');
  if (!existsSync(base)) return null;
  let latest: { path: string; mtime: number } | null = null;
  let dirs: string[];
  try {
    dirs = readdirSync(base);
  } catch {
    return null;
  }
  for (const dir of dirs) {
    let files: string[];
    try {
      files = readdirSync(join(base, dir)).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const name of files) {
      const path = join(base, dir, name);
      try {
        const mtime = statSync(path).mtimeMs;
        if (!latest || mtime > latest.mtime) latest = { path, mtime };
      } catch {
        /* ignore */
      }
    }
  }
  if (!latest) return null;
  let lines: string[];
  try {
    lines = readFileSync(latest.path, 'utf8').split('\n');
  } catch {
    return null;
  }
  let workspace: string | null = null;
  let compactions = 0;
  let lastCompaction: QoderSessionEvidence['lastCompaction'] = null;
  const usage = { events: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, credits: 0 };
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !/"(cwd|compactMetadata|compactUsage)"/.test(line)) continue;
    let entry: {
      cwd?: unknown;
      compactMetadata?: { preTokens?: unknown; postTokens?: unknown };
      compactUsage?: {
        input_tokens?: unknown;
        output_tokens?: unknown;
        cache_read_input_tokens?: unknown;
        credits?: unknown;
      };
    };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      continue;
    }
    if (workspace === null && typeof entry.cwd === 'string' && entry.cwd.length > 0) {
      workspace = entry.cwd;
    }
    const meta = entry.compactMetadata;
    if (meta && typeof meta === 'object') {
      compactions++;
      const pre = typeof meta.preTokens === 'number' ? meta.preTokens : null;
      const post = typeof meta.postTokens === 'number' ? meta.postTokens : null;
      if (lastCompaction === null && pre !== null && post !== null) {
        lastCompaction = { preTokens: pre, postTokens: post };
      }
    }
    const u = entry.compactUsage;
    if (u && typeof u === 'object') {
      usage.events++;
      usage.inputTokens += typeof u.input_tokens === 'number' ? u.input_tokens : 0;
      usage.outputTokens += typeof u.output_tokens === 'number' ? u.output_tokens : 0;
      usage.cacheReadTokens +=
        typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : 0;
      usage.credits += typeof u.credits === 'number' ? u.credits : 0;
    }
  }
  return {
    file: latest.path,
    workspace,
    compactions,
    lastCompaction,
    compactionUsage: usage.events > 0 ? usage : null,
  };
}

export function qoderEffectiveness(root: string, home = homedir()): EffectivenessReport {
  const evidence = latestQoderSession(home);
  if (!evidence?.workspace) {
    return {
      tool: 'Qoder',
      status: 'unknown',
      workspace: null,
      detail: 'transcripts sin cwd en ~/.qoder/projects',
      severity: 'info',
    };
  }
  const applied = workspaceMatchesRoot(evidence.workspace, root);
  const compact =
    evidence.lastCompaction !== null
      ? `; ${evidence.compactions} compactación(es), última ${evidence.lastCompaction.preTokens}→${evidence.lastCompaction.postTokens} tokens`
      : '';
  const usage = evidence.compactionUsage;
  const usageNote = usage
    ? `; uso medido en ${usage.events} compactación(es): ${usage.inputTokens} in / ${usage.outputTokens} out, ${usage.credits.toFixed(2)} créditos (parcial, no es el total de la sesión)`
    : '';
  return {
    tool: 'Qoder',
    status: applied ? 'applied' : 'not-applied',
    workspace: evidence.workspace,
    detail: applied
      ? `última sesión dentro del repo (transcript cwd${compact}${usageNote})`
      : `última sesión fuera del repo: ${evidence.workspace} (transcript cwd${compact}${usageNote})`,
    severity: 'info',
  };
}

export function auditEffectiveness(env: TokenSafetyEnv): EffectivenessReport[] {
  const home = env.home ?? homedir();
  const unknown = (tool: string, source: string): EffectivenessReport => ({
    tool,
    status: 'unknown',
    workspace: null,
    detail: `sin evidencia de workspace en almacenes locales (${source})`,
    severity: 'info',
  });
  return [
    codexEffectiveness(env.root, home),
    opencodeEffectiveness(env.root),
    minimaxEffectiveness(env.root),
    zcodeEffectiveness(env.root, join(home, '.zcode', 'v2', 'tasks-index.sqlite')),
    qoderEffectiveness(env.root, home),
    unknown('Kimi', 'CLI sin sesiones locales; desktop server-side'),
    unknown('GitHub Copilot', 'sin almacén de sesiones local'),
    unknown('Antigravity', 'conversation_summaries.db sin workspace'),
  ];
}

export interface TokenSafetyEnv {
  root: string;
  home?: string;
  appData?: string;
}

export function auditAllTokenSafety(env: TokenSafetyEnv): TokenSafetyReport[] {
  const home = env.home ?? homedir();
  const appData = env.appData ?? process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
  const codex = auditCodexTokenSafety(join(env.root, '.codex', 'config.toml'));
  const parity = codexConfigParity(
    readText(join(env.root, '.codex', 'config.toml')),
    readText(join(home, '.codex', 'config.toml')),
    env.root,
  );
  if (!parity.hostPresent) {
    codex.notes.push(
      'host ~/.codex/config.toml ausente: no se puede verificar paridad ni trust del repo',
    );
  } else {
    for (const c of parity.conflicts) {
      codex.checks.push(
        `paridad repo/host: ${c.key} repo=${String(c.repo)} host=${String(c.host)}`,
      );
    }
    if (parity.conflicts.length && codex.status === 'PASS') codex.status = 'WARN';
    codex.notes.push(
      parity.repoTrusted
        ? 'host marca este repo como trusted'
        : 'host NO marca este repo como trusted: abrir la carpeta como proyecto en Codex y fijar trust_level = "trusted" (una sesión projectless ignora .codex/config.toml y no compacta)',
    );
  }
  return [
    codex,
    auditKimiTokenSafety(join(home, '.kimi-code', 'config.toml')),
    auditMinimaxTokenSafety(join(home, '.minimax', 'config.yaml')),
    auditZcodeTokenSafety(join(home, '.zcode', 'v2', 'config.json')),
    auditOpencodeTokenSafety(join(env.root, 'opencode.json')),
    serverManaged('Qoder', [
      'compactación automática + /compact manual; sin umbral configurable local',
      'no emite usage por request; los transcripts locales registran cwd, compactaciones (preTokens→postTokens) y compactUsage (input/output/créditos solo de los eventos de compactación — evidencia parcial, no consumo total)',
      'hábito: /compact en cambios de fase y hilo nuevo por tarea (no hilos eternos)',
    ]),
    serverManaged('GitHub Copilot', [
      'contexto y compactación gestionados por el servicio; sin claves de compactación en VS Code',
      `settings locales en ${join(appData, 'Code', 'User', 'settings.json')}`,
      'no emite tokens locales: cobertura de telemetría limitada a cuota de Copilot',
    ]),
    serverManaged('Antigravity', [
      'contexto server-side; el almacén local solo guarda resúmenes de conversación (sin tokens)',
      'hábito: sesiones cortas por objetivo para evitar arrastrar contexto',
    ]),
  ];
}

function printTable(reports: TokenSafetyReport[]): void {
  for (const report of reports) {
    const head = `${report.status.padEnd(4)} ${report.tool.padEnd(15)} ${report.surface}`;
    console.log(head);
    for (const check of report.checks) console.log(`     problema: ${check}`);
    for (const note of report.notes) console.log(`     nota: ${note}`);
  }
  const count = (status: TokenSafetyStatus) => reports.filter((r) => r.status === status).length;
  console.log(
    `\n${count('PASS')} PASS · ${count('WARN')} WARN · ${count('INFO')} INFO (server-managed) de ${reports.length} superficies`,
  );
}

function printEffectiveness(rows: EffectivenessReport[]): void {
  console.log('\nEfectividad de sesión (última evidencia local por herramienta)');
  for (const row of rows) {
    const head = `${row.status.padEnd(11)} ${row.tool.padEnd(15)}`;
    console.log(`${head} ${row.detail}`);
  }
  const warnings = rows.filter((row) => row.severity === 'warn' && row.status === 'not-applied');
  for (const row of warnings) {
    console.log(
      `     hallazgo: ${row.tool} declara config en el repo pero la última sesión no la aplicó`,
    );
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const env = { root: process.cwd() };
  const reports = auditAllTokenSafety(env);
  const effectiveness = auditEffectiveness(env);
  const home = homedir();
  const compaction = [
    nativeCompaction('OpenCode', env.root, opencodeDbPath()),
    nativeCompaction(
      'MiniMax Code',
      env.root,
      minimaxDbPath(),
      join(home, '.minimax', 'v2', 'sessions'),
    ),
    nativeCompaction('ZCode', env.root, join(home, '.zcode', 'cli', 'db', 'db.sqlite')),
  ];
  const configWarn = reports.some((report) => report.status === 'WARN');
  const unapplied = effectiveness.filter(
    (row) => row.severity === 'warn' && row.status === 'not-applied',
  );
  if (args.includes('--json')) {
    console.log(JSON.stringify({ reports, effectiveness, compaction }, null, 2));
  } else if (args.includes('--autostart')) {
    for (const report of reports.filter((report) => report.status === 'WARN')) {
      console.log(`[TOKEN-SAFETY] ${report.tool}: ${report.checks.join('; ')}`);
    }
    for (const row of unapplied) {
      console.log(`[TOKEN-SAFETY] ${row.tool}: ${row.detail}`);
    }
  } else {
    printTable(reports);
    printEffectiveness(effectiveness);
    console.log('\nCompactación nativa (historia del workspace; no prueba del perfil actual)');
    for (const row of compaction) {
      const last = row.last
        ? `; última ${row.last.at === null ? 'sin fecha' : new Date(row.last.at).toISOString()} ${row.last.beforeTokens ?? '?'}→${row.last.afterTokens ?? '?'} tokens`
        : '';
      console.log(
        `${row.status.padEnd(12)} ${row.tool}: ${row.completed} completadas, ${row.requested} solicitudes, ${row.failed} fallidas, ${row.interrupted} interrumpidas${last}; ${row.detail}`,
      );
    }
  }
  // --strict cubre la config declarada, no el historial de sesiones: un run
  // fuera del repo se reporta como hallazgo pero no rompe el gate.
  if (args.includes('--strict') && configWarn) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    // Contrato §4 de la normativa: 2 = indeterminado por infraestructura,
    // nunca capturado como FAIL del check (ni como limpieza).
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[TOKEN-SAFETY] indeterminado: ${message}`);
    process.exitCode = 2;
  }
}
