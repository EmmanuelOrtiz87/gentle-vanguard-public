/**
 * Resolucion de configuracion de proveedores OpenCode (config + auth + baseURL).
 *
 * Por que existe (2026-11-06): tres herramientas distintas (el probe de salud
 * de proveedores, el doctor de modelos y el nuevo probe de inferencia)
 * resolvian la MISMA cosa de tres maneras distintas. Cada copia era una
 * oportunidad de divergir: el probe de salud resolvia el bearer token desde
 * `options.headers.Authorization` sin quitar el prefijo "Bearer ", el doctor
 * si lo hacia. Misma config, dos verdades.
 *
 * Este modulo es la unica fuente: una funcion, una verdad.
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface ProviderConfig {
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

export interface OpenCodeConfig {
  provider?: Record<string, ProviderConfig>;
  disabled_providers?: string[];
}

export interface AuthEntry {
  type?: string;
  key: string;
}

type AuthFile = Record<string, AuthEntry>;

export type AuthSource =
  | 'auth.json'
  | 'options.apiKey'
  | 'options.headers.Authorization'
  | 'options.headers.x-api-key'
  | 'NONE';

function openCodeConfigPath(): string {
  return (
    process.env.OPENCODE_CONFIG ||
    join(homedir(), '.config', 'opencode', 'opencode.json')
  );
}

function openCodeAuthPath(): string {
  return (
    process.env.OPENCODE_AUTH_FILE ||
    join(homedir(), '.local', 'share', 'opencode', 'auth.json')
  );
}

function readJsonFile<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function loadOpenCodeConfig(path = openCodeConfigPath()): OpenCodeConfig | null {
  return readJsonFile<OpenCodeConfig>(path);
}

export function loadAuthFile(path = openCodeAuthPath()): AuthFile {
  if (!existsSync(path)) return {};
  return readJsonFile<AuthFile>(path) ?? {};
}

/**
 * Resuelve la credencial del proveedor. Orden (identico al que usaba el doctor,
 * que es el que mas caso real tiene):
 *   1. auth.json
 *   2. provider.options.apiKey
 *   3. provider.options.headers.Authorization (sin el prefijo "Bearer ")
 *   4. provider.options.headers['x-api-key'] y variantes
 *   5. Authorization literal (sin Bearer)
 */
export function detectAuthKey(
  providerId: string,
  provider: ProviderConfig,
  auth: AuthFile,
): { key: string; source: AuthSource } | null {
  if (auth[providerId]?.key) {
    return { key: auth[providerId].key, source: 'auth.json' };
  }
  if (provider.options?.apiKey) {
    return { key: provider.options.apiKey, source: 'options.apiKey' };
  }
  const authHeader =
    provider.options?.headers?.Authorization || provider.options?.headers?.authorization;
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) return { key: match[1], source: 'options.headers.Authorization' };
  }
  const customHeader =
    provider.options?.headers?.['x-api-key'] ||
    provider.options?.headers?.['X-Api-Key'] ||
    provider.options?.headers?.['x-api-Key'];
  if (customHeader) {
    return { key: customHeader, source: 'options.headers.x-api-key' };
  }
  if (authHeader) {
    return { key: authHeader, source: 'options.headers.Authorization' };
  }
  return null;
}

/** BaseURL efectiva del proveedor (config explicita o derivada del npm). */
export function providerBaseURL(provider: ProviderConfig): string {
  if (provider.options?.baseURL) return provider.options.baseURL;
  if (provider.npm) return `https://${provider.npm}.com/api/v1`;
  return '';
}

/**
 * Headers para llamar al proveedor: los del config + el bearer de la
 * credencial resuelta, sin duplicar un Authorization ya presente.
 */
export function providerHeaders(
  provider: ProviderConfig,
  key: string | null,
): Record<string, string> {
  const headers: Record<string, string> = { ...(provider.options?.headers || {}) };
  if (key && !headers.Authorization && !headers.authorization) {
    headers['Authorization'] = `Bearer ${key}`;
  }
  return headers;
}
