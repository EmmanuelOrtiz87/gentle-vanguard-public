#!/usr/bin/env node
/**
 * Safe, read-only diagnostic for Codex assets AND token safety.
 * It never deletes or rewrites files.
 *
 * Token safety audita:
 *  - .codex/config.toml del repo: modelo válido, límites de contexto/compactación,
 *    project_doc_max_bytes suficiente para AGENTS.md.
 *  - ~/.codex/config.toml: mismas claves (host-owned; sólo se reporta).
 *  - Último rollout real: requests, contexto máximo, compactaciones, waits de polling y cuota 5h.
 *
 * Uso:
 *   node --import tsx src/tools/codex-assets-doctor.ts [--strict]
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareSkillTrees } from '../integrations/tool-interoperability-audit.js';
import { parseTomlScalars } from '../tokens/token-safety.js';
import { codexSessionRoots, readRolloutText, walkJsonl } from '../tokens/token-ingest/readers.js';

const ROOT = resolve(process.cwd());
const SOURCE = join(ROOT, 'skills');
export const CODEX_HOME = join(homedir(), '.codex');
export const TARGET = join(CODEX_HOME, 'skills');
const CHECKED_SKILLS = ['gv-shorts-skill', 'impeccable'];
const REPO_CONFIG = join(ROOT, '.codex', 'config.toml');
const GLOBAL_CONFIG = join(CODEX_HOME, 'config.toml');
const AGENTS_MD = join(ROOT, 'AGENTS.md');
const MODELS_CACHE = join(CODEX_HOME, 'models_cache.json');

const REQUIRED_KEYS = [
  'model_context_window',
  'model_auto_compact_token_limit',
  'model_post_turn_compact_threshold_percent',
  'project_doc_max_bytes',
] as const;

type Status = 'PASS' | 'WARN' | 'FAIL';
type Scalar = string | number | boolean;

export type ConfigAudit = {
  path: string;
  exists: boolean;
  values: Record<string, Scalar>;
  problems: string[];
  warnings: string[];
};

export type RolloutAudit = {
  file: string | null;
  cwd: string | null;
  model: string | null;
  requests: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  maxRequestInput: number;
  lastRequestInput: number;
  compactions: number;
  waitCalls: number;
  toolCalls: number;
  userPrompts: number;
  quotaUsedPercentStart: number | null;
  quotaUsedPercentEnd: number | null;
};

export type TokenSafetyAudit = {
  status: Status;
  repo: ConfigAudit;
  global: ConfigAudit;
  agents: { path: string; bytes: number; maxBytes: number | null; truncated: boolean };
  model: { value: string | null; valid: boolean };
  rollout: RolloutAudit | null;
  warnings: string[];
};

export type CodexAssetsDoctorReport = {
  ok: boolean;
  source: string;
  target: string;
  status: Status;
  missingTarget: boolean;
  critical: { skill: string; status: 'fresh' | 'missing' | 'changed' | 'extra' }[];
  unknownExtras: string[];
  managedExtras: string[];
  tokenSafety: TokenSafetyAudit;
  safe: true;
};

function collectModelIds(node: unknown, acc: string[] = []): string[] {
  if (typeof node === 'string') {
    if (/^gpt-[a-z0-9.-]+$/i.test(node)) acc.push(node);
  } else if (Array.isArray(node)) {
    for (const item of node) collectModelIds(item, acc);
  } else if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectModelIds(value, acc);
  }
  return acc;
}

export function readKnownModels(path = MODELS_CACHE): string[] {
  try {
    return [...new Set(collectModelIds(JSON.parse(readFileSync(path, 'utf8'))))];
  } catch {
    return [];
  }
}

function asNumber(value: Scalar | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function auditConfig(
  path: string,
  label: 'repo' | 'global',
  knownModels: string[] = [],
): ConfigAudit {
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      values: {},
      problems: label === 'repo' ? ['config de Codex del repo ausente'] : [],
      warnings: [],
    };
  }
  const values = parseTomlScalars(readFileSync(path, 'utf8'));
  const problems: string[] = [];
  const warnings: string[] = [];

  for (const key of REQUIRED_KEYS) {
    if (!(key in values)) warnings.push(`${label}: falta ${key}`);
  }

  const window = asNumber(values.model_context_window);
  const compact = asNumber(values.model_auto_compact_token_limit);
  const postTurn = asNumber(values.model_post_turn_compact_threshold_percent);
  const docBytes = asNumber(values.project_doc_max_bytes);

  if (window !== null && window < 128_000)
    problems.push(`${label}: model_context_window ${window} < 128000`);
  if (window !== null && window > 400_000)
    warnings.push(`${label}: model_context_window ${window} > 400000 (contexto caro)`);
  if (window !== null && compact !== null && compact >= window * 0.9) {
    problems.push(`${label}: auto_compact ${compact} >= 90% del window ${window}`);
  }
  if (compact !== null && compact <= 0) problems.push(`${label}: auto_compact debe ser > 0`);
  if (postTurn !== null && (postTurn < 0 || postTurn > 100)) {
    problems.push(`${label}: post_turn_compact ${postTurn} fuera de 0-100`);
  }
  if (docBytes !== null && docBytes < 16_384)
    warnings.push(`${label}: project_doc_max_bytes ${docBytes} trunca AGENTS.md`);

  const model = typeof values.model === 'string' ? values.model : null;
  if (model && knownModels.length > 0 && !knownModels.includes(model)) {
    problems.push(`${label}: modelo "${model}" no está en models_cache`);
  }

  return { path, exists: true, values, problems, warnings };
}

function newestRollout(): string | null {
  const roots = codexSessionRoots();
  if (roots.length === 0) return null;
  const files = roots
    .flatMap((root) => walkJsonl(root))
    .map((file) => ({ file, mtime: statSync(file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0]?.file ?? null;
}

type CodexEvent = {
  type?: string;
  payload?: {
    type?: string;
    cwd?: string;
    model?: string;
    name?: string;
    info?: {
      last_token_usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cached_input_tokens?: number;
        reasoning_output_tokens?: number;
      };
    };
    rate_limits?: { primary?: { used_percent?: number } };
  };
};

export function summarizeRollout(file: string): RolloutAudit {
  const audit: RolloutAudit = {
    file,
    cwd: null,
    model: null,
    requests: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    maxRequestInput: 0,
    lastRequestInput: 0,
    compactions: 0,
    waitCalls: 0,
    toolCalls: 0,
    userPrompts: 0,
    quotaUsedPercentStart: null,
    quotaUsedPercentEnd: null,
  };
  for (const line of readRolloutText(file).split('\n')) {
    if (!line) continue;
    let event: CodexEvent;
    try {
      event = JSON.parse(line) as CodexEvent;
    } catch {
      continue;
    }
    const payload = event.payload ?? {};
    if (event.type === 'session_meta') {
      audit.cwd = typeof payload.cwd === 'string' ? payload.cwd : audit.cwd;
    }
    if (event.type === 'turn_context' && !audit.model && typeof payload.model === 'string') {
      audit.model = payload.model;
    }
    if (`${event.type ?? ''}:${payload.type ?? ''}`.toLowerCase().includes('compact')) {
      audit.compactions++;
    }
    if (event.type === 'event_msg' && payload.type === 'task_started') audit.userPrompts++;
    if (event.type === 'event_msg' && payload.type === 'token_count') {
      const usage = payload.info?.last_token_usage ?? {};
      const input = Number(usage.input_tokens ?? 0);
      const output = Number(usage.output_tokens ?? 0);
      if (input > 0 || output > 0) {
        audit.requests++;
        audit.inputTokens += input;
        audit.cachedInputTokens += Number(usage.cached_input_tokens ?? 0);
        audit.outputTokens += output;
        audit.reasoningTokens += Number(usage.reasoning_output_tokens ?? 0);
        audit.maxRequestInput = Math.max(audit.maxRequestInput, input);
        audit.lastRequestInput = input;
      }
      const quota = payload.rate_limits?.primary?.used_percent;
      if (typeof quota === 'number') {
        if (audit.quotaUsedPercentStart === null) audit.quotaUsedPercentStart = quota;
        audit.quotaUsedPercentEnd = quota;
      }
    }
    if (
      event.type === 'response_item' &&
      (payload.type === 'custom_tool_call' || payload.type === 'function_call')
    ) {
      audit.toolCalls++;
      if (payload.name === 'wait') audit.waitCalls++;
    }
  }
  return audit;
}

function tokenSafetyReport(): TokenSafetyAudit {
  const knownModels = readKnownModels();
  const repo = auditConfig(REPO_CONFIG, 'repo', knownModels);
  const global = auditConfig(GLOBAL_CONFIG, 'global', knownModels);
  const agentsBytes = existsSync(AGENTS_MD) ? statSync(AGENTS_MD).size : 0;
  const maxBytes =
    asNumber(repo.values.project_doc_max_bytes) ?? asNumber(global.values.project_doc_max_bytes);
  const truncated = maxBytes !== null && agentsBytes > maxBytes;
  const modelValue =
    (typeof repo.values.model === 'string' ? repo.values.model : null) ??
    (typeof global.values.model === 'string' ? global.values.model : null);
  const modelValid = !modelValue || knownModels.length === 0 || knownModels.includes(modelValue);
  const rolloutFile = newestRollout();
  const rollout = rolloutFile ? summarizeRollout(rolloutFile) : null;
  const warnings = [...repo.warnings, ...global.warnings];

  if (truncated && maxBytes !== null) {
    repo.problems.push(`project_doc_max_bytes ${maxBytes} < AGENTS.md ${agentsBytes}`);
  }
  if (rollout) {
    if (rollout.lastRequestInput > 250_000) {
      warnings.push(`rollout: último request ${rollout.lastRequestInput} tokens (>250k)`);
    }
    if (rollout.requests > 100 && rollout.compactions === 0) {
      warnings.push(`rollout: ${rollout.requests} requests sin compactación`);
    }
    if (rollout.waitCalls >= 10) {
      warnings.push(`rollout: ${rollout.waitCalls} waits de polling (reenvían contexto completo)`);
    }
    if ((rollout.quotaUsedPercentEnd ?? 0) >= 95) {
      warnings.push(`rollout: cuota 5h al ${rollout.quotaUsedPercentEnd}%`);
    }
  }

  const problems = [...repo.problems, ...global.problems];
  const status: Status = problems.length > 0 ? 'FAIL' : warnings.length > 0 ? 'WARN' : 'PASS';
  return {
    status,
    repo,
    global,
    agents: { path: AGENTS_MD, bytes: agentsBytes, maxBytes, truncated },
    model: { value: modelValue, valid: modelValid },
    rollout,
    warnings,
  };
}

function doctor(): CodexAssetsDoctorReport {
  const tokenSafety = tokenSafetyReport();
  if (!existsSync(TARGET)) {
    return {
      ok: false,
      source: SOURCE,
      target: TARGET,
      status: 'FAIL',
      missingTarget: true,
      critical: [],
      unknownExtras: [],
      managedExtras: [],
      tokenSafety,
      safe: true,
    };
  }
  const critical: CodexAssetsDoctorReport['critical'] = [];
  const managedExtras: string[] = [];
  const unknownExtras: string[] = [];
  for (const skill of CHECKED_SKILLS) {
    const sourceSkill = join(SOURCE, skill);
    const targetSkill = join(TARGET, skill);
    if (!existsSync(targetSkill)) {
      critical.push({ skill, status: 'missing' });
      continue;
    }
    const comparison = compareSkillTrees(sourceSkill, targetSkill);
    const differences = comparison.differences;
    const meaningful = differences.filter((item) => !item.startsWith('unexpected:'));
    if (meaningful.some((item) => item.startsWith('missing:')))
      critical.push({ skill, status: 'missing' });
    else if (meaningful.some((item) => item.startsWith('changed:')))
      critical.push({ skill, status: 'changed' });
    else if (differences.some((item) => item.startsWith('unexpected:')))
      critical.push({ skill, status: 'extra' });
    else critical.push({ skill, status: 'fresh' });
    for (const item of differences
      .filter((entry) => entry.startsWith('unexpected:'))
      .map((entry) => entry.slice(11))) {
      if (skill === 'impeccable') managedExtras.push(`${skill}/${item}`);
      else unknownExtras.push(`${skill}/${item}`);
    }
  }
  const skillsStatus: Status =
    critical.some((item) => item.status === 'missing' || item.status === 'changed') ||
    unknownExtras.length
      ? 'WARN'
      : 'PASS';
  const status: Status =
    tokenSafety.status === 'FAIL'
      ? 'FAIL'
      : skillsStatus === 'WARN' || tokenSafety.status === 'WARN'
        ? 'WARN'
        : 'PASS';
  return {
    ok: status !== 'FAIL',
    source: SOURCE,
    target: TARGET,
    status,
    missingTarget: false,
    critical,
    unknownExtras,
    managedExtras,
    tokenSafety,
    safe: true,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = doctor();
  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes('--strict') && report.status === 'FAIL') process.exitCode = 1;
}
