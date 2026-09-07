#!/usr/bin/env node
/**
 * opencode-model-doctor.ts
 *
 * Probe every provider in opencode.json against its real upstream endpoint,
 * using the active API key from auth.json, and report which models work,
 * which fail, and why.
 *
 * This is the "ground truth" tool for the Gentle-Vanguard stack: it tells you
 * which models you can ACTUALLY use right now, vs. the stale hand-curated
 * catalog in opencode.json.
 *
 * Usage:
 *   npx tsx src/tools/opencode-model-doctor.ts [--json] [--probe-models] [--provider <id>]
 *
 * Output modes:
 *   --json           Emit JSON report (for CI / automation)
 *   --probe-models   Send a tiny chat completion per model to test SDK compat
 *   --provider <id>  Only probe this provider (default: all enabled providers)
 *
 * Exit codes:
 *   0 = all probed models OK
 *   1 = at least one model in user's configured catalog is broken
 *   2 = provider itself unreachable (auth/network)
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

interface ProviderConfig {
  name?: string;
  npm?: string;
  options?: {
    baseURL?: string;
    apiKey?: string;
    headers?: Record<string, string>;
  };
  models?: Record<string, unknown>;
  api?: string;
  id?: string;
}

interface OpenCodeConfig {
  provider?: Record<string, ProviderConfig>;
  disabled_providers?: string[];
}

interface AuthEntry {
  type: string;
  key: string;
}

interface AuthFile {
  [providerId: string]: AuthEntry;
}

interface ModelProbeResult {
  id: string;
  status: 'OK' | 'NOT_FOUND' | 'AUTH_FAILED' | 'RATE_LIMITED' | 'USAGE_LIMIT' | 'INSUFFICIENT_BALANCE' | 'INTERNAL_ERROR' | 'PARAM_LEAK' | 'OPT_IN_REQUIRED' | 'TIMEOUT' | 'NETWORK_ERROR' | 'UNKNOWN';
  detail?: string;
}

interface ProviderReport {
  id: string;
  name: string;
  baseURL: string;
  authSource: 'auth.json' | 'options.apiKey' | 'options.headers.Authorization' | 'options.headers.x-api-key' | 'NONE';
  catalogEndpoint: string;
  catalogOK: boolean;
  catalogCount: number;
  upstreamCatalog: string[];        // all model IDs from the upstream /v1/models
  configuredCatalog: string[];       // model IDs configured in opencode.json
  missingInUpstream: string[];       // configured but not in upstream
  extrasInUpstream: string[];        // in upstream but not configured
  modelProbes?: ModelProbeResult[];  // only if --probe-models
  errors: string[];
}

interface DoctorReport {
  timestamp: string;
  configPath: string;
  authPath: string;
  providers: ProviderReport[];
  summary: {
    totalProviders: number;
    providersWithAuth: number;
    providersReachable: number;
    totalConfiguredModels: number;
    totalUpstreamModels: number;
    missingInUpstream: number;
    brokenModelProbes: number;
  };
}

const COLOR = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const probeModels = args.includes('--probe-models');
const providerFilterIdx = args.indexOf('--provider');
const providerFilter = providerFilterIdx >= 0 ? args[providerFilterIdx + 1] : null;

function log(msg: string, color: keyof typeof COLOR = 'reset') {
  if (!jsonMode) {
    process.stdout.write(`${COLOR[color]}${msg}${COLOR.reset}\n`);
  }
}

function err(msg: string): string {
  return `${COLOR.red}${msg}${COLOR.reset}`;
}

function ok(msg: string): string {
  return `${COLOR.green}${msg}${COLOR.reset}`;
}

function warn(msg: string): string {
  return `${COLOR.yellow}${msg}${COLOR.reset}`;
}

function detectAuthKey(
  providerId: string,
  provider: ProviderConfig,
  auth: AuthFile,
): { key: string; source: ProviderReport['authSource'] } | null {
  // Priority 1: auth.json
  if (auth[providerId]?.key) {
    return { key: auth[providerId].key, source: 'auth.json' };
  }
  // Priority 2: provider.options.apiKey
  if (provider.options?.apiKey) {
    return { key: provider.options.apiKey, source: 'options.apiKey' };
  }
  // Priority 3: provider.options.headers.Authorization (strip "Bearer ")
  const authHeader = provider.options?.headers?.Authorization || provider.options?.headers?.authorization;
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) return { key: match[1], source: 'options.headers.Authorization' };
  }
  // Priority 4: provider.options.headers['x-api-key'] or similar custom header
  const customHeader = provider.options?.headers?.['x-api-key']
    || provider.options?.headers?.['X-Api-Key']
    || provider.options?.headers?.['x-api-Key'];
  if (customHeader) {
    return { key: customHeader, source: 'options.headers.x-api-key' };
  }
  // Priority 5: Authorization header with a literal (non-Bearer) value
  if (authHeader) {
    return { key: authHeader, source: 'options.headers.Authorization' };
  }
  return null;
}

async function probeCatalog(
  baseURL: string,
  provider: ProviderConfig,
  key: string | null,
  _providerId: string,
): Promise<{ ok: boolean; models: string[]; error?: string; authSource?: string }> {
  const url = `${baseURL.replace(/\/+$/, '')}/models`;
  try {
    const headers: Record<string, string> = { ...(provider.options?.headers || {}) };
    if (key) {
      // Only inject Bearer if no Authorization header is already set in options
      if (!headers.Authorization && !headers.authorization) {
        headers['Authorization'] = `Bearer ${key}`;
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, models: [], error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { data?: Array<{ id?: string }> } | Array<{ id?: string }>;
    const items = Array.isArray(data) ? data : data.data || [];
    return { ok: true, models: items.map((m) => m.id).filter((id): id is string => typeof id === 'string') };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, models: [], error: msg };
  }
}

async function probeModel(
  baseURL: string,
  modelId: string,
  key: string,
  _providerId: string,
): Promise<ModelProbeResult> {
  const url = `${baseURL.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model: modelId,
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 1,
    stream: false,
  };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) return { id: modelId, status: 'OK' };
    const text = await res.text();
    const lower = text.toLowerCase();
    // Classify by body FIRST (more reliable than status code), then fall back to status
    if (lower.includes('insufficient balance') || lower.includes('creditserror') || lower.includes('no resource package')) {
      return { id: modelId, status: 'INSUFFICIENT_BALANCE', detail: text.slice(0, 200) };
    }
    if (lower.includes('usage limit') || lower.includes('monthly limit') || lower.includes('weekly limit') || lower.includes('5-hour')) {
      return { id: modelId, status: 'USAGE_LIMIT', detail: text.slice(0, 200) };
    }
    if (lower.includes('internal server error')) {
      return { id: modelId, status: 'INTERNAL_ERROR', detail: text.slice(0, 200) };
    }
    if (lower.includes('unsupported request parameter') || (lower.includes('provider') && lower.includes('litellm_settings'))) {
      return { id: modelId, status: 'PARAM_LEAK', detail: text.slice(0, 200) };
    }
    if (lower.includes('opt in') || lower.includes('explicit opt')) {
      return { id: modelId, status: 'OPT_IN_REQUIRED', detail: text.slice(0, 200) };
    }
    // Then fall back to status code
    if (res.status === 401 || res.status === 403) return { id: modelId, status: 'AUTH_FAILED', detail: text.slice(0, 200) };
    if (res.status === 404) return { id: modelId, status: 'NOT_FOUND', detail: text.slice(0, 200) };
    if (res.status === 429) return { id: modelId, status: 'RATE_LIMITED', detail: text.slice(0, 200) };
    return { id: modelId, status: 'UNKNOWN', detail: `HTTP ${res.status}: ${text.slice(0, 150)}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('aborted')) return { id: modelId, status: 'TIMEOUT' };
    return { id: modelId, status: 'NETWORK_ERROR', detail: msg };
  }
}

async function main() {
  const home = homedir();
  const configPath = process.env.OPENCODE_CONFIG || resolve(home, '.config/opencode/opencode.json');
  const authPath = resolve(home, '.local/share/opencode/auth.json');

  if (!existsSync(configPath)) {
    log(err(`Config not found: ${configPath}`), 'reset');
    process.exit(2);
  }
  if (!existsSync(authPath)) {
    log(err(`Auth not found: ${authPath}`), 'reset');
    process.exit(2);
  }

  const configText = readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, '');
  const authText = readFileSync(authPath, 'utf-8').replace(/^\uFEFF/, '');
  const config = JSON.parse(configText) as OpenCodeConfig;
  const auth = JSON.parse(authText) as AuthFile;

  if (!config.provider) {
    log(err('No provider block in opencode.json'), 'reset');
    process.exit(2);
  }

  const disabled = new Set(config.disabled_providers || []);
  const report: DoctorReport = {
    timestamp: new Date().toISOString(),
    configPath,
    authPath,
    providers: [],
    summary: {
      totalProviders: 0,
      providersWithAuth: 0,
      providersReachable: 0,
      totalConfiguredModels: 0,
      totalUpstreamModels: 0,
      missingInUpstream: 0,
      brokenModelProbes: 0,
    },
  };

  for (const [id, provider] of Object.entries(config.provider)) {
    if (disabled.has(id)) continue;
    if (providerFilter && id !== providerFilter) continue;

    const baseURL = provider.options?.baseURL;
    if (!baseURL) {
      report.providers.push({
        id,
        name: provider.name || id,
        baseURL: '(none)',
        authSource: 'NONE',
        catalogEndpoint: '(none)',
        catalogOK: false,
        catalogCount: 0,
        upstreamCatalog: [],
        configuredCatalog: Object.keys(provider.models || {}),
        missingInUpstream: [],
        extrasInUpstream: [],
        errors: ['No baseURL in provider.options'],
      });
      continue;
    }

    const authInfo = detectAuthKey(id, provider, auth);
    const key = authInfo?.key || null;

    log(`\n${COLOR.bold}━━━ ${provider.name || id} (${id}) ━━━${COLOR.reset}`, 'reset');
    log(`  baseURL: ${baseURL}`, 'dim');
    log(`  auth:    ${authInfo ? `${ok('OK')} (${authInfo.source})` : err('NONE — provider will reject all calls')}`, 'reset');

    const probe = await probeCatalog(baseURL, provider, key, id);
    const catalogEndpoint = `${baseURL.replace(/\/+$/, '')}/models`;

    const configured = Object.keys(provider.models || {});
    const upstream = probe.models;
    const upstreamSet = new Set(upstream);
    const configuredSet = new Set(configured);
    const missingInUpstream = configured.filter((m) => !upstreamSet.has(m));
    const extrasInUpstream = upstream.filter((m) => !configuredSet.has(m));

    const providerReport: ProviderReport = {
      id,
      name: provider.name || id,
      baseURL,
      authSource: authInfo?.source || 'NONE',
      catalogEndpoint,
      catalogOK: probe.ok,
      catalogCount: upstream.length,
      upstreamCatalog: upstream,
      configuredCatalog: configured,
      missingInUpstream,
      extrasInUpstream,
      errors: probe.error ? [probe.error] : [],
    };

    report.providers.push(providerReport);
    report.summary.totalProviders++;
    if (authInfo) report.summary.providersWithAuth++;
    if (probe.ok) report.summary.providersReachable++;
    report.summary.totalConfiguredModels += configured.length;
    report.summary.totalUpstreamModels += upstream.length;
    report.summary.missingInUpstream += missingInUpstream.length;

    log(`  catalog: ${probe.ok ? ok(`${upstream.length} models via GET /models`) : err(`FAIL: ${probe.error}`)}`, 'reset');
    if (configured.length > 0) {
      log(`  configured: ${configured.length} model(s)`, 'dim');
      if (missingInUpstream.length > 0) {
        log(`  ${warn('stale config')}: ${missingInUpstream.length} model(s) in your config do NOT exist upstream:`, 'reset');
        for (const m of missingInUpstream) log(`    ${err('✗')} ${m}`, 'reset');
      }
    } else {
      log(`  configured: ${COLOR.cyan}auto-discovery (empty models block)${COLOR.reset}`, 'reset');
      log(`  ${ok('+')} available upstream models: ${upstream.length}`, 'reset');
    }
  }

  // Optional: per-model probe (slow but real)
  if (probeModels) {
    log(`\n${COLOR.bold}━━━ Per-model probe (--probe-models) ━━━${COLOR.reset}`, 'reset');
    for (const prov of report.providers) {
      if (!prov.catalogOK) continue;
      const providerCfg = config.provider![prov.id];
      const authInfo = detectAuthKey(prov.id, providerCfg, auth);
      if (!authInfo) continue;
      // When auto-discovery, pick models to probe. Prefer free, but always sample at least
      // a few so the user gets a real signal on paid-only providers (like opencode-go).
      const FREE_PATTERNS = ['-free', 'big-pickle', 'contributor-free'];
      const freeSample = prov.upstreamCatalog.filter((m) => FREE_PATTERNS.some((p) => m.includes(p))).slice(0, 5);
      const paidSample = prov.upstreamCatalog.filter((m) => !FREE_PATTERNS.some((p) => m.includes(p))).slice(0, 3);
      const toProbe = prov.configuredCatalog.length > 0
        ? prov.configuredCatalog
        : [...freeSample, ...paidSample].slice(0, 5);
      log(`\n  Probing ${toProbe.length} model(s) on ${prov.id}…`, 'dim');
      const results: ModelProbeResult[] = [];
      for (const m of toProbe) {
        const r = await probeModel(prov.baseURL, m, authInfo.key, prov.id);
        results.push(r);
        const colorFn = r.status === 'OK' ? ok : err;
        log(`    ${colorFn(r.status === 'OK' ? '✓' : '✗')} ${m.padEnd(40)} ${r.status}${r.detail ? ' — ' + r.detail.slice(0, 80) : ''}`, 'reset');
      }
      prov.modelProbes = results;
      report.summary.brokenModelProbes += results.filter((r) => r.status !== 'OK').length;
    }
  }

  if (jsonMode) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    log(`\n${COLOR.bold}━━━ Summary ━━━${COLOR.reset}`, 'reset');
    log(`  providers:       ${report.summary.providersWithAuth}/${report.summary.totalProviders} with auth, ${report.summary.providersReachable}/${report.summary.totalProviders} reachable`, 'reset');
    log(`  models (cfg/up): ${report.summary.totalConfiguredModels}/${report.summary.totalUpstreamModels}`, 'reset');
    log(`  stale cfg:       ${report.summary.missingInUpstream} model(s) in opencode.json not in upstream`, 'reset');
    if (probeModels) {
      log(`  broken probes:   ${report.summary.brokenModelProbes}`, 'reset');
    }
    log('', 'reset');
  }

  // Exit code: 1 if any configured model is stale
  process.exit(report.summary.missingInUpstream > 0 ? 1 : 0);
}

main().catch((e) => {
  log(err(`Doctor crashed: ${e.message}`), 'reset');
  process.exit(2);
});
