#!/usr/bin/env node
/**
 * Key Registry — donde vive la verdad de "qué provider ya está configurado".
 *
 * Por qué existe: cada app pedía su propia key (localStorage, prompt pegado a
 * mano) y el owner repetía el mismo procedimiento en cada superficie. Acá el
 * stack resuelve las keys UNA vez (env, archivos locales, config del stack) y
 * las expone a las apps locales por loopback, con la key redactada y un proxy
 * de LLM para que el secreto NUNCA viaje al navegador.
 *
 * Fuentes (en este orden de prioridad):
 *   1. Variables de entorno del proceso.
 *   2. Archivos locales de keys: `<ROOT>/.env.local`, `<ROOT>/config/keys.local.json`,
 *      `${HOME}/.gentle-vanguard/keys.json`, `apps/<app>/.env.local`, `apps/<app>/.env`
 *      (+ `GV_KEY_FILES` extra, separada por `;`).
 *   3. `config/model-router.json`: entradas de provider con `apiKey` literal.
 *
 * Local-first (ADR-0017): el servicio escucha SOLO en 127.0.0.1.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export type KeySource = 'environment' | 'local-file' | 'stack-config' | 'none';

export interface ProviderKeyStatus {
  id: string;
  label: string;
  configured: boolean;
  source: KeySource;
  /** 'abcd****wxyz' — nunca la key completa. */
  keyRedacted: string;
  /** Ruta/origen exacto (sin el valor). */
  origin: string;
}

export interface ResolvedProviderKey {
  id: string;
  key: string;
  source: KeySource;
  origin: string;
}

interface ProviderSpec {
  id: string;
  label: string;
  env: string[];
  /** alias de provider en config/model-router.json */
  routerAliases: string[];
}

export const PROVIDER_SPECS: readonly ProviderSpec[] = [
  { id: 'gemini', label: 'Google Gemini', env: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_API_KEY'], routerAliases: ['gemini', 'google', 'google-gemini'] },
  { id: 'openai', label: 'OpenAI', env: ['OPENAI_API_KEY'], routerAliases: ['openai'] },
  { id: 'anthropic', label: 'Anthropic', env: ['ANTHROPIC_API_KEY'], routerAliases: ['anthropic', 'claude'] },
  { id: 'groq', label: 'Groq', env: ['GROQ_API_KEY'], routerAliases: ['groq'] },
  { id: 'deepseek', label: 'DeepSeek', env: ['DEEPSEEK_API_KEY'], routerAliases: ['deepseek'] },
  { id: 'openrouter', label: 'OpenRouter', env: ['OPENROUTER_API_KEY'], routerAliases: ['openrouter'] },
  { id: 'mistral', label: 'Mistral', env: ['MISTRAL_API_KEY'], routerAliases: ['mistral'] },
  { id: 'xai', label: 'xAI', env: ['XAI_API_KEY', 'GROK_API_KEY'], routerAliases: ['xai', 'grok'] },
] as const;

const ROOT = resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd());

/** Redacta: nunca se expone la key completa. */
export function redactKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

/** Archivos locales donde puede haber keys ya configuradas. */
export function keyFileCandidates(root = ROOT): string[] {
  const extra = (process.env.GV_KEY_FILES ?? '')
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  return [
    join(root, '.env.local'),
    join(root, 'config', 'keys.local.json'),
    join(homedir(), '.gentle-vanguard', 'keys.json'),
    ...extra,
  ];
}

/**
 * Archivos de env de las apps del stack: `apps/<app>/.env.local` y `apps/<app>/.env`.
 *
 * Por qué: el owner ya tenía keys pasted en apps (ej. `apps/gv-music/.env.local`).
 * El registry las reconoce sin pedir el procedimiento otra vez.
 */
export function appEnvCandidates(root = ROOT): string[] {
  const appsDir = join(root, 'apps');
  try {
    if (!existsSync(appsDir)) return [];
    return readdirSync(appsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => [join(appsDir, entry.name, '.env.local'), join(appsDir, entry.name, '.env')])
      .filter((file) => existsSync(file));
  } catch {
    return [];
  }
}

/** Lee un .env local (KEY=VALUE, ignora comentarios y comillas). */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/gu, '');
    if (key) out[key] = value;
  }
  return out;
}

/** Keys declaradas en config/model-router.json (apiKey literal). */
export function readRouterKeys(root = ROOT): Record<string, { key: string; origin: string }> {
  const path = join(root, 'config', 'model-router.json');
  const out: Record<string, { key: string; origin: string }> = {};
  try {
    if (!existsSync(path)) return out;
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    const visit = (node: unknown, trail: string[]): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach((item, i) => visit(item, [...trail, String(i)]));
        return;
      }
      const record = node as Record<string, unknown>;
      for (const [key, value] of Object.entries(record)) {
        if (typeof value === 'string' && /apiKey|api_key|^key$/iu.test(key) && value.length > 12) {
          out[trail.join('.')] = { key: value, origin: `config/model-router.json:${trail.join('.')}` };
          continue;
        }
        visit(value, [...trail, key]);
      }
    };
    visit(raw, []);
  } catch {
    /* config ilegible = sin keys del router */
  }
  return out;
}

/** Resuelve la key de un provider (env → archivos → router). */
export function resolveProviderKey(id: string, root = ROOT): ResolvedProviderKey | null {
  const spec = PROVIDER_SPECS.find((p) => p.id === id);
  if (!spec) return null;

  for (const name of spec.env) {
    const value = process.env[name]?.trim();
    if (value) return { id, key: value, source: 'environment', origin: `env:${name}` };
  }

  for (const file of [...keyFileCandidates(root), ...appEnvCandidates(root)]) {
    try {
      if (!existsSync(file)) continue;
      const content = readFileSync(file, 'utf-8');
      if (file.endsWith('.json')) {
        const parsed = JSON.parse(content) as Record<string, unknown>;
        for (const name of [...spec.env, spec.id.toUpperCase() + '_API_KEY', spec.id.toUpperCase()]) {
          const value = parsed[name];
          if (typeof value === 'string' && value.trim()) {
            return { id, key: value.trim(), source: 'local-file', origin: file };
          }
        }
        continue;
      }
      const envMap = parseEnvFile(content);
      for (const name of spec.env) {
        const value = envMap[name]?.trim();
        if (value) return { id, key: value, source: 'local-file', origin: file };
      }
    } catch {
      /* archivo ilegible = se sigue con la siguiente fuente */
    }
  }

  const routerKeys = readRouterKeys(root);
  for (const [trail, entry] of Object.entries(routerKeys)) {
    const providerName = trail.split('.').find((part) => spec.routerAliases.includes(part.toLowerCase()));
    if (providerName) return { id, key: entry.key, source: 'stack-config', origin: entry.origin };
  }

  return null;
}

/** Estado de TODOS los providers (redactado: seguro para exponer). */
export function resolveProviderKeyStatuses(root = ROOT): ProviderKeyStatus[] {
  return PROVIDER_SPECS.map((spec) => {
    const resolved = resolveProviderKey(spec.id, root);
    return {
      id: spec.id,
      label: spec.label,
      configured: Boolean(resolved),
      source: resolved?.source ?? 'none',
      keyRedacted: resolved ? redactKey(resolved.key) : '',
      origin: resolved?.origin ?? '',
    };
  });
}

// ─── CLI: `node --import tsx src/integrations/key-registry.ts --status` ───────
// Imprime el estado redactado de cada provider. Nunca imprime la key completa.
if (process.argv.includes('--status')) {
  const statuses = resolveProviderKeyStatuses();
  const configured = statuses.filter((s) => s.configured);
  console.log(`[key-registry] ${configured.length}/${statuses.length} providers con key`);
  for (const status of statuses) {
    const detail = status.configured ? `${status.keyRedacted}  (${status.source}) ${status.origin}` : '—';
    console.log(`  ${status.configured ? '✓' : '·'} ${status.id.padEnd(11)} ${status.label.padEnd(16)} ${detail}`);
  }
  process.exit(0);
}
