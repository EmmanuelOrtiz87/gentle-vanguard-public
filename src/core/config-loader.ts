#!/usr/bin/env node
/**
 * Unified Config Loader — single entry point for all config/*.json reads.
 *
 * Replaces the ~17 scattered loadConfig() implementations with:
 *  - mtime-based cache (long-running daemons pick up edits automatically)
 *  - deep merge over caller-provided defaults
 *  - native JSON Schema subset validation (auto-detects <name>.schema.json)
 *  - CLI sweep: npx tsx src/core/config-loader.ts --validate-all
 *
 * Usage (library):
 *   import { loadConfigFile } from './core/config-loader.js';
 *   const cfg = loadConfigFile<MyCfg>('token-budget-guard', { defaults });
 *
 * Usage (CLI):
 *   npx tsx src/core/config-loader.ts --validate-all [--json]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(process.cwd());
const CONFIG_DIR = join(ROOT, 'config');

// ─── Minimal JSON Schema validator (draft 2020-12 subset) ──────────────────

type Schema = {
  type?: string | string[];
  required?: string[] | string;
  properties?: Record<string, Schema>;
  items?: Schema;
  enum?: unknown[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  additionalProperties?: boolean | Schema;
};

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function matchesType(value: unknown, expected: string): boolean {
  const actual = typeOf(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  if (expected === 'integer') return actual === 'integer';
  return actual === expected;
}

/** Validate `value` against schema; returns list of human-readable errors. */
export function validateAgainstSchema(
  value: unknown,
  schema: Schema,
  path = '$',
): string[] {
  const errors: string[] = [];

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${path}: expected ${types.join('|')}, got ${typeOf(value)}`);
      return errors;
    }
  }

  if (schema.enum && !schema.enum.some((e) => e === value)) {
    errors.push(`${path}: value not in enum [${schema.enum.join(', ')}]`);
  }

  if (typeof value === 'string' && schema.pattern) {
    try {
      if (!new RegExp(schema.pattern).test(value)) {
        errors.push(`${path}: does not match pattern ${schema.pattern}`);
      }
    } catch {
      /* invalid regex in schema — skip */
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum)
      errors.push(`${path}: ${value} < minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum)
      errors.push(`${path}: ${value} > maximum ${schema.maximum}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      errors.push(`${path}: array length ${value.length} < minItems ${schema.minItems}`);
    if (schema.items) {
      value.forEach((item, i) => {
        errors.push(...validateAgainstSchema(item, schema.items as Schema, `${path}[${i}]`));
      });
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    // Normalize sloppy "required": "a b c" (space-separated string) seen in some schemas
    let required: string[] = [];
    if (Array.isArray(schema.required)) required = schema.required;
    else if (typeof schema.required === 'string')
      required = schema.required.split(/\s+/).filter(Boolean);

    const obj = value as Record<string, unknown>;
    for (const key of required) {
      if (!(key in obj)) errors.push(`${path}: missing required property '${key}'`);
    }
    if (schema.properties) {
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (key in obj) {
          errors.push(...validateAgainstSchema(obj[key], sub, `${path}.${key}`));
        }
      }
    }
    if (schema.additionalProperties && schema.properties) {
      const known = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(obj)) {
        if (!known.has(key)) {
          if (schema.additionalProperties === true) continue;
          errors.push(
            ...validateAgainstSchema(
              obj[key],
              schema.additionalProperties as Schema,
              `${path}.${key}`,
            ),
          );
        }
      }
    }
  }

  return errors;
}

// ─── Deep merge (defaults under file content) ──────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge<T extends object>(base: T, override: unknown): T {
  if (!isPlainObject(override) || !isPlainObject(base)) {
    return (override === undefined ? base : (override as T));
  }
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

// ─── Cache (mtime-based) ───────────────────────────────────────────────────

interface CacheEntry {
  data: unknown;
  mtimeMs: number;
  loadedAt: number;
  path: string;
}

const cache = new Map<string, CacheEntry>();
const stats = { hits: 0, misses: 0, invalidations: 0 };

export interface LoadedConfig<T> {
  data: T;
  /** Absolute path the data was loaded from ('' if only defaults were used). */
  source: string;
  /** Non-fatal issues: schema violations, parse fallbacks, missing files. */
  warnings: string[];
}

export interface LoadOptions<T extends object> {
  /** Deep-merged UNDER the file content. */
  defaults?: Partial<T>;
  /** Force schema validation using config/<name>.schema.json when present. Default: true. */
  validate?: boolean;
  /** Bypass/read-through cache. Default: false. */
  noCache?: boolean;
  /** Custom directory (default: <root>/config). */
  dir?: string;
}

/**
 * Load config/<name>.json with caching, defaults merge and optional schema
 * validation. Never throws for missing files — returns defaults with a warning.
 */
export function loadConfigFile<T extends object>(
  name: string,
  options: LoadOptions<T> = {},
): LoadedConfig<T> {
  const dir = options.dir ?? CONFIG_DIR;
  const filePath = join(dir, `${name}.json`);
  const warnings: string[] = [];

  let entry = cache.get(filePath);
  if (entry && !options.noCache) {
    try {
      const mtime = statSync(filePath).mtimeMs;
      if (mtime === entry.mtimeMs) {
        stats.hits++;
        return { data: entry.data as T, source: entry.path, warnings };
      }
    } catch {
      /* file vanished — fall through to reload */
    }
  }

  stats.misses++;
  let data: unknown;

  if (existsSync(filePath)) {
    try {
      const mtime = statSync(filePath).mtimeMs;
      data = JSON.parse(readFileSync(filePath, 'utf-8'));
      entry = { data, mtimeMs: mtime, loadedAt: Date.now(), path: filePath };
    } catch (e) {
      warnings.push(`parse error in ${filePath}: ${(e as Error).message}`);
      data = undefined;
    }
  } else {
    warnings.push(`config not found: ${filePath}`);
  }

  // Schema validation (auto-detect sibling .schema.json)
  if ((options.validate ?? true) && data !== undefined) {
    const schemaPath = join(dir, `${name}.schema.json`);
    if (existsSync(schemaPath)) {
      try {
        const schema = JSON.parse(readFileSync(schemaPath, 'utf-8')) as Schema;
        const errs = validateAgainstSchema(data, schema);
        if (errs.length) {
          warnings.push(`schema violations in ${name}.json: ${errs.slice(0, 10).join('; ')}`);
        }
      } catch (e) {
        warnings.push(`schema unreadable (${schemaPath}): ${(e as Error).message}`);
      }
    }
  }

  if (data === undefined) data = {};

  const merged = options.defaults ? deepMerge(options.defaults, data) : (data as T);
  if (entry) cache.set(filePath, entry);
  return { data: merged as T, source: entry?.path ?? '', warnings };
}

/** Drop cached entries (all, or one config name). */
export function invalidateConfig(name?: string): number {
  let removed = 0;
  if (!name) {
    removed = cache.size;
    cache.clear();
  } else {
    const filePath = join(CONFIG_DIR, `${name}.json`);
    if (cache.delete(filePath)) removed = 1;
  }
  stats.invalidations += removed;
  return removed;
}

/** Cache observability for dashboards/watchtower. */
export function getConfigStats(): {
  size: number;
  hits: number;
  misses: number;
  invalidations: number;
  hitRate: number;
} {
  const total = stats.hits + stats.misses;
  return {
    size: cache.size,
    hits: stats.hits,
    misses: stats.misses,
    invalidations: stats.invalidations,
    hitRate: total === 0 ? 0 : stats.hits / total,
  };
}

// ─── CLI: validate every config that has a schema ──────────────────────────

function cliValidateAll(asJson: boolean): number {
  if (!existsSync(CONFIG_DIR)) {
    console.error(`[CONFIG-LOADER] no config dir at ${CONFIG_DIR}`);
    return 1;
  }
  const schemas = readdirSync(CONFIG_DIR).filter((f) => f.endsWith('.schema.json'));
  const results: Array<{ name: string; ok: boolean; errors: string[] }> = [];

  for (const schemaFile of schemas) {
    const name = schemaFile.replace(/\.schema\.json$/, '');
    const res = loadConfigFile(name, { noCache: true });
    const schemaErrors = res.warnings.filter((w) => w.startsWith('schema violations'));
    results.push({
      name,
      ok: schemaErrors.length === 0 && existsSync(join(CONFIG_DIR, `${name}.json`)),
      errors: schemaErrors.map((w) => w.replace(/^schema violations in [^:]+: /, '')),
    });
  }

  const failed = results.filter((r) => !r.ok);
  if (asJson) {
    console.log(JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2));
  } else {
    for (const r of results) {
      console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.errors.length ? ` — ${r.errors.join('; ')}` : ''}`);
    }
    console.log(`\n[CONFIG-LOADER] ${results.length - failed.length}/${results.length} configs valid`);
  }
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('src/core/config-loader.ts')) {
  const args = process.argv.slice(2);
  if (args.includes('--validate-all')) {
    process.exit(cliValidateAll(args.includes('--json')));
  }
  console.log('Usage: npx tsx src/core/config-loader.ts --validate-all [--json]');
  process.exit(0);
}
