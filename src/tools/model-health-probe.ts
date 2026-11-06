#!/usr/bin/env node
/**
 * Probe de salud de proveedores de modelo.
 *
 * Por que existe (2026-11-06): el `model-enforcer` decide que modelo impone,
 * y hasta hoy lo decide contra `config/model-health-registry.json`, cuyo
 * `health.status` esta escrito a MANO y con evidencia VIEJA (el ultimo
 * `lastChecked` era de agosto). Con esa evidencia el enforcer impuso un modelo
 * que el propio registry marcaba como no disponible.
 *
 * La ausencia de evidencia NO es evidencia de salud. Este probe produce
 * evidencia FRESCA y con timestamp, en un archivo de runtime (no en el
 * catalogo versionado, para no ensuciar git en cada sesion):
 *
 *   .runtime/model-health-evidence.json
 *     { generatedAt, providers: { <id>: { reachable, models[], error?, checkedAt } } }
 *
 * El enforcer lo consulta: un modelo cuyo proveedor fue sondeado y resulto
 * INALCANZABLE queda descalificado, aunque el registry lo declare disponible.
 *
 * Uso:
 *   npx tsx src/tools/model-health-probe.ts           # sondea y escribe evidencia
 *   npx tsx src/tools/model-health-probe.ts --json    # salida machine-readable
 *   npx tsx src/tools/model-health-probe.ts --check   # no escribe, solo evalua
 *
 * Exit codes (contrato de la norma de verificaciones):
 *   0 = evidencia escrita y el proveedor activo es alcanzable
 *   1 = el proveedor activo NO es alcanzable (comprobado)
 *   2 = INDETERMINADO (sin red / config ausente) — nunca se interpreta como 0
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

const ROOT = process.cwd();
const OPENCODE_CONFIG =
  process.env.OPENCODE_CONFIG ||
  join(process.env.USERPROFILE || process.env.HOME || ROOT, '.config', 'opencode', 'opencode.json');
const AUTH_FILE = join(
  process.env.USERPROFILE || process.env.HOME || ROOT,
  '.local',
  'share',
  'opencode',
  'auth.json',
);
const EVIDENCE_PATH = join(ROOT, '.runtime', 'model-health-evidence.json');
const ACTIVE_MODEL_PATH = join(ROOT, '.runtime', 'model-active.json');

const PROBE_TIMEOUT_MS = 8000;

interface ProviderConfig {
  npm?: string;
  options?: {
    baseURL?: string;
    apiKey?: string;
    headers?: Record<string, string>;
  };
}

interface ProviderEvidence {
  reachable: boolean;
  models: number;
  error?: string;
  checkedAt: string;
}

interface EvidenceFile {
  generatedAt: string;
  providers: Record<string, ProviderEvidence>;
}

function log(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Mismo orden de prioridad que el doctor de modelos. */
function detectAuthKey(
  providerId: string,
  provider: ProviderConfig,
  auth: Record<string, { key?: string }>,
): string | null {
  if (auth[providerId]?.key) return auth[providerId]!.key!;
  if (provider.options?.apiKey) return provider.options.apiKey;
  const authHeader =
    provider.options?.headers?.Authorization || provider.options?.headers?.authorization;
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1];
    return authHeader;
  }
  const custom =
    provider.options?.headers?.['x-api-key'] ||
    provider.options?.headers?.['X-Api-Key'] ||
    provider.options?.headers?.['x-api-Key'];
  return custom ?? null;
}

async function probeProvider(
  providerId: string,
  provider: ProviderConfig,
  auth: Record<string, { key?: string }>,
): Promise<ProviderEvidence> {
  const checkedAt = new Date().toISOString();
  const baseURL =
    provider.options?.baseURL || (provider.npm ? `https://${provider.npm}.com/api/v1` : '');
  if (!baseURL) {
    return { reachable: false, models: 0, error: 'sin baseURL', checkedAt };
  }
  const key = detectAuthKey(providerId, provider, auth);
  const headers: Record<string, string> = { ...(provider.options?.headers || {}) };
  if (key && !headers.Authorization && !headers.authorization) {
    headers['Authorization'] = `Bearer ${key}`;
  }
  const url = `${baseURL.replace(/\/+$/, '')}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    if (!res.ok) {
      await res.body?.cancel();
      return { reachable: false, models: 0, error: `HTTP ${res.status}`, checkedAt };
    }
    const data = (await res.json()) as { data?: Array<{ id?: string }> } | Array<{ id?: string }>;
    const items = Array.isArray(data) ? data : data.data || [];
    return {
      reachable: true,
      models: items.length,
      checkedAt,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { reachable: false, models: 0, error: msg, checkedAt };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<number> {
  const jsonMode = process.argv.includes('--json');
  const checkOnly = process.argv.includes('--check');

  const config = readJson<{ provider?: Record<string, ProviderConfig> }>(OPENCODE_CONFIG);
  if (!config?.provider || Object.keys(config.provider).length === 0) {
    if (jsonMode) log(JSON.stringify({ status: 'indeterminate', reason: 'sin providers' }));
    else log('[model-health-probe] INDETERMINADO: opencode.json no declara providers');
    return 2;
  }

  const auth = existsSync(AUTH_FILE)
    ? (readJson<Record<string, { key?: string }>>(AUTH_FILE) ?? {})
    : {};

  const providers: Record<string, ProviderEvidence> = {};
  for (const [id, provider] of Object.entries(config.provider)) {
    providers[id] = await probeProvider(id, provider, auth);
  }

  const evidence: EvidenceFile = {
    generatedAt: new Date().toISOString(),
    providers,
  };

  if (!checkOnly) {
    mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
    writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  }

  const active = readJson<{ model?: string; provider?: string }>(ACTIVE_MODEL_PATH);
  const activeModel = active?.model ?? '';
  const activeProvider = active?.provider ?? activeModel.split('/')[0] ?? '';
  const activeEvidence = providers[activeProvider];

  const reachable = Object.values(providers).filter((p) => p.reachable).length;
  const total = Object.keys(providers).length;

  if (jsonMode) {
    log(
      JSON.stringify(
        {
          status: activeEvidence?.reachable
            ? 'ok'
            : activeEvidence
              ? 'unreachable'
              : 'indeterminate',
          generatedAt: evidence.generatedAt,
          providersReachable: reachable,
          providersTotal: total,
          activeProvider,
          activeReachable: activeEvidence?.reachable ?? null,
          evidencePath: EVIDENCE_PATH,
        },
        null,
        2,
      ),
    );
  } else {
    log(`[model-health-probe] ${reachable}/${total} proveedores alcanzables`);
    for (const [id, p] of Object.entries(providers)) {
      log(
        `  ${p.reachable ? 'OK  ' : 'FAIL'} ${id}: ${p.reachable ? `${p.models} modelos` : p.error}`,
      );
    }
    log(`[model-health-probe] evidencia -> ${EVIDENCE_PATH}`);
    if (activeProvider) {
      log(
        `[model-health-probe] proveedor activo '${activeProvider}': ${
          activeEvidence
            ? activeEvidence.reachable
              ? 'alcanzable'
              : `NO alcanzable (${activeEvidence.error})`
            : 'sin evidencia'
        }`,
      );
    }
  }

  if (!activeEvidence) return 2;
  return activeEvidence.reachable ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(
      `[model-health-probe] fatal: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 2;
  });
