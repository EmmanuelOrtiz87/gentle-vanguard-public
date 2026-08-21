#!/usr/bin/env node
/**
 * plugin-manager.ts — Sistema de plugins local-first para Gentle-Vanguard.
 *
 * Los plugins son directorios locales con un manifest (plugin.json) y scripts TS/JS.
 * Se descubren desde:
 *   - plugins/                        (repo — plugins incluidos/bundled)
 *   - ~/.gentle-vanguard/plugins      (usuario — plugins instalados a mano)
 *   - rutas extra definidas en config/plugins.json (pluginsPaths)
 *
 * SEGURIDAD: la carga de plugins NUNCA importa código en el proceso principal del
 * stack. El hook runner lanza los scripts de hooks en procesos separados vía
 * runNpxTsxSync/runSync (src/core/run-command.ts). Un plugin no puede corromper
 * ni inyectar estado en el proceso que lo gestiona.
 *
 * Uso:
 *   npx tsx src/plugin-manager.ts list
 *   npx tsx src/plugin-manager.ts --status
 *   npx tsx src/plugin-manager.ts install <git-url|path> [--user] [--name <dir>]
 *   npx tsx src/plugin-manager.ts remove <id> [--keep-files]
 *   npx tsx src/plugin-manager.ts enable <id>
 *   npx tsx src/plugin-manager.ts disable <id>
 *   npx tsx src/plugin-manager.ts hooks <event> [--json]
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { basename, dirname, join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { runNpxTsxSync, runSync, type RunSyncResult } from './core/run-command.js';
import { ROOT } from './core/repo-root';

// ─── Paths y config ──────────────────────────────────────────────────────────

const REPO_PLUGINS_DIR = join(ROOT, 'plugins');
const USER_PLUGINS_DIR = join(homedir(), '.gentle-vanguard', 'plugins');
const PLUGINS_CONFIG_PATH = join(ROOT, 'config', 'plugins.json');
const REGISTRY_PATH = join(ROOT, 'config', 'plugin-registry.json');
const MANIFEST_FILE = 'plugin.json';

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const GIT_URL_RE = /^(https?|ssh|git|git\+ssh|file):\/\//i;

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type PluginSource = 'repo' | 'user' | 'custom';

export interface PluginHook {
  event: string;
  script: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  entry: string;
  hooks: PluginHook[];
  enabled?: boolean;
}

export interface DiscoveredPlugin {
  id: string;
  dir: string;
  source: PluginSource;
  manifestPath: string;
  manifest: PluginManifest;
  valid: boolean;
  error?: string;
  enabled: boolean;
  hooks: PluginHook[];
}

export interface HookRunResult {
  pluginId: string;
  event: string;
  script: string;
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

interface PluginsConfig {
  pluginsPaths?: string[];
  enabledPlugins?: string[];
  security?: {
    requireSignature?: boolean;
    allowUnsigned?: boolean;
    sandboxedExecution?: boolean;
  };
  autoDiscover?: boolean;
}

interface PluginRegistryEntry {
  enabled: boolean;
  source: PluginSource;
  installedAt?: string;
}

interface PluginRegistry {
  version: string;
  plugins: Record<string, PluginRegistryEntry>;
}

// ─── Carga de config y registry ──────────────────────────────────────────────

function loadPluginsConfig(): PluginsConfig {
  try {
    if (!existsSync(PLUGINS_CONFIG_PATH)) return {};
    return JSON.parse(readFileSync(PLUGINS_CONFIG_PATH, 'utf-8')) as PluginsConfig;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[PLUGIN-MANAGER] No se pudo leer config/plugins.json: ${msg}`);
    return {};
  }
}

function loadRegistry(): PluginRegistry {
  try {
    if (!existsSync(REGISTRY_PATH)) {
      return { version: '1.0.0', plugins: {} };
    }
    const parsed = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8')) as PluginRegistry;
    parsed.plugins ??= {};
    return parsed;
  } catch {
    return { version: '1.0.0', plugins: {} };
  }
}

function saveRegistry(registry: PluginRegistry): void {
  mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
  writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`, 'utf-8');
}

function registryEntryFor(id: string): PluginRegistryEntry | undefined {
  return loadRegistry().plugins[id];
}

// ─── Resolución de paths de descubrimiento ───────────────────────────────────

function expandUserPath(p: string): string {
  return p
    .replace(/^~(?=\/|\\)/, homedir())
    .replace(/^%USERPROFILE%(?=\/|\\)/, homedir())
    .replace(/^%HOME%(?=\/|\\)/, homedir());
}

function resolvePluginRoots(): { base: string; source: PluginSource }[] {
  const config = loadPluginsConfig();
  const roots: { base: string; source: PluginSource }[] = [];

  const push = (base: string, source: PluginSource): void => {
    if (!base || roots.some((r) => resolve(r.base) === resolve(base))) return;
    roots.push({ base, source });
  };

  push(REPO_PLUGINS_DIR, 'repo');
  push(USER_PLUGINS_DIR, 'user');
  for (const p of config.pluginsPaths ?? []) {
    const expanded = expandUserPath(p);
    if (expanded) push(expanded, 'custom');
  }
  return roots;
}

// ─── Manifest: parseo y validación ───────────────────────────────────────────

function normalizeHooks(rawHooks: unknown): PluginHook[] {
  if (!Array.isArray(rawHooks)) return [];
  const hooks: PluginHook[] = [];
  for (const h of rawHooks) {
    if (typeof h === 'string' && h.trim()) {
      hooks.push({ event: h.trim(), script: 'index.ts' });
    } else if (h && typeof h === 'object') {
      const obj = h as Record<string, unknown>;
      if (typeof obj.event === 'string' && obj.event.trim()) {
        hooks.push({
          event: obj.event.trim(),
          script: typeof obj.script === 'string' && obj.script.trim() ? obj.script : 'index.ts',
        });
      }
    }
  }
  return hooks;
}

function parseManifest(manifestPath: string): { manifest?: PluginManifest; error?: string } {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `manifest inválido (JSON): ${msg}` };
  }

  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : '';
  const fallbackId = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '';
  const resolvedId = id || fallbackId;

  if (!resolvedId) return { error: `manifest sin id (ni name) en ${manifestPath}` };
  if (!ID_RE.test(resolvedId)) {
    return { error: `id inválido "${resolvedId}" (debe ser kebab-case: [a-z0-9-])` };
  }

  const version = typeof raw.version === 'string' ? raw.version.trim() : '';
  if (!SEMVER_RE.test(version)) {
    return { error: `versión inválida "${version}" (debe ser semver MAJOR.MINOR.PATCH)` };
  }

  const entry = typeof raw.entry === 'string' && raw.entry.trim() ? raw.entry.trim() : '';
  const mainFallback = typeof raw.main === 'string' && raw.main.trim() ? raw.main.trim() : '';
  const resolvedEntry = entry || mainFallback || 'index.ts';

  const manifest: PluginManifest = {
    id: resolvedId,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : resolvedId,
    version,
    description: typeof raw.description === 'string' ? raw.description : '',
    author: typeof raw.author === 'string' ? raw.author : '',
    entry: resolvedEntry,
    hooks: normalizeHooks(raw.hooks),
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
  };

  return { manifest };
}

// ─── Descubrimiento ──────────────────────────────────────────────────────────

export function discoverPlugins(): DiscoveredPlugin[] {
  const roots = resolvePluginRoots();
  const byId = new Map<string, DiscoveredPlugin>();

  for (const { base, source } of roots) {
    if (!existsSync(base)) continue;

    let entries: string[];
    try {
      entries = readdirSync(base);
    } catch {
      continue;
    }

    for (const name of entries) {
      const dir = join(base, name);
      let stat;
      try {
        stat = statSync(dir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      const manifestPath = join(dir, MANIFEST_FILE);
      if (!existsSync(manifestPath)) continue;

      const { manifest, error } = parseManifest(manifestPath);
      if (!manifest) {
        const id = name;
        byId.set(id, {
          id,
          dir,
          source,
          manifestPath,
          manifest: {
            id,
            name: name,
            version: '0.0.0',
            description: '',
            author: '',
            entry: MANIFEST_FILE,
            hooks: [],
          },
          valid: false,
          error,
          enabled: false,
          hooks: [],
        });
        continue;
      }

      if (byId.has(manifest.id)) continue; // primer path gana (repo > user > custom)

      const entryPath = join(dir, manifest.entry);
      const entryExists = existsSync(entryPath) && statSync(entryPath).isFile();
      const valid = entryExists;

      byId.set(manifest.id, {
        id: manifest.id,
        dir,
        source,
        manifestPath,
        manifest,
        valid,
        error: valid ? undefined : `entry no encontrado: ${manifest.entry}`,
        enabled: valid ? resolveEnabled(manifest.id, manifest.enabled ?? true) : false,
        hooks: manifest.hooks,
      });
    }
  }

  return [...byId.values()];
}

function resolveEnabled(id: string, defaultEnabled: boolean): boolean {
  const entry = registryEntryFor(id);
  if (entry && typeof entry.enabled === 'boolean') return entry.enabled;
  return defaultEnabled;
}

export function findPlugin(id: string): DiscoveredPlugin | undefined {
  return discoverPlugins().find((p) => p.id === id);
}

// ─── Hook runner (procesos separados — SEGURIDAD) ────────────────────────────

function runPluginScript(scriptPath: string, args: string[] = []): RunSyncResult {
  const cwd = dirname(scriptPath);
  if (/\.(ts|mts|cts)$/.test(scriptPath)) {
    return runNpxTsxSync(scriptPath, args, { cwd, timeout: 60_000 });
  }
  if (/\.(js|mjs|cjs)$/.test(scriptPath)) {
    return runSync(process.execPath, [scriptPath, ...args], { cwd, timeout: 60_000 });
  }
  // Script ejecutable arbitrario (permisos de ejecución del usuario)
  return runSync(scriptPath, args, { cwd, timeout: 60_000 });
}

export function runHooks(event: string): HookRunResult[] {
  const plugins = discoverPlugins().filter((p) => p.valid && p.enabled);
  const results: HookRunResult[] = [];

  for (const plugin of plugins) {
    for (const hook of plugin.hooks) {
      if (hook.event !== event) continue;

      const scriptPath = join(plugin.dir, hook.script);
      if (!existsSync(scriptPath)) {
        results.push({
          pluginId: plugin.id,
          event,
          script: hook.script,
          ok: false,
          status: null,
          stdout: '',
          stderr: '',
          error: `script de hook no encontrado: ${hook.script}`,
        });
        continue;
      }

      const r = runPluginScript(scriptPath);
      results.push({
        pluginId: plugin.id,
        event,
        script: hook.script,
        ok: r.status === 0,
        status: r.status,
        stdout: r.stdout.trim(),
        stderr: r.stderr.trim(),
        error: r.status !== 0 ? r.stderr.trim() || r.error?.message : undefined,
      });
    }
  }

  return results;
}

// ─── Instalación ─────────────────────────────────────────────────────────────

function inferRepoName(target: string): string {
  const cleaned = target.replace(/\.git(\/)?$/, '').replace(/\/+$/, '');
  const name = basename(cleaned);
  return name || 'plugin';
}

function uniqueDirName(base: string, wanted: string): string {
  let candidate = wanted;
  let i = 2;
  while (existsSync(join(base, candidate))) {
    candidate = `${wanted}-${i}`;
    i += 1;
  }
  return candidate;
}

export interface InstallResult {
  id: string;
  dir: string;
  source: PluginSource;
}

export function installPlugin(
  target: string,
  options: { user?: boolean; name?: string } = {},
): InstallResult {
  if (!target) throw new Error('falta el target de instalación: git-url o path local');

  const destBase = options.user ? USER_PLUGINS_DIR : REPO_PLUGINS_DIR;
  mkdirSync(destBase, { recursive: true });

  const isGit = GIT_URL_RE.test(target) || target.endsWith('.git') || target.startsWith('git@');

  let stagedDir: string;
  let destName = options.name;

  if (isGit) {
    destName = destName ?? inferRepoName(target);
    if (!ID_RE.test(destName)) {
      throw new Error(
        `nombre de directorio de plugin inválido "${destName}" (use --name <kebab-case>)`,
      );
    }
    stagedDir = join(destBase, uniqueDirName(destBase, destName));
    console.log(`[PLUGIN-MANAGER] Clonando ${target} → ${stagedDir} ...`);
    const r = runSync('git', ['clone', '--depth', '1', target, stagedDir], {
      cwd: ROOT,
      timeout: 120_000,
    });
    if (r.status !== 0) {
      rmSync(stagedDir, { recursive: true, force: true });
      throw new Error(`git clone falló: ${(r.stderr || r.error?.message || '').trim()}`);
    }
  } else {
    const src = resolve(target);
    if (!existsSync(src)) throw new Error(`path no encontrado: ${target}`);
    if (!statSync(src).isDirectory()) {
      throw new Error(`target de instalación debe ser un directorio (o git URL): ${target}`);
    }
    destName = destName ?? basename(src);
    if (!ID_RE.test(destName)) {
      throw new Error(
        `nombre de directorio de plugin inválido "${destName}" (use --name <kebab-case>)`,
      );
    }
    stagedDir = join(destBase, uniqueDirName(destBase, destName));
    console.log(`[PLUGIN-MANAGER] Copiando ${src} → ${stagedDir} ...`);
    cpSync(src, stagedDir, { recursive: true });
  }

  // Validar el manifest instalado antes de registrar
  const manifestPath = join(stagedDir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    rmSync(stagedDir, { recursive: true, force: true });
    throw new Error(`el plugin instalado no tiene ${MANIFEST_FILE}`);
  }
  const { manifest, error } = parseManifest(manifestPath);
  if (!manifest || error) {
    rmSync(stagedDir, { recursive: true, force: true });
    throw new Error(`manifest del plugin instalado inválido: ${error ?? 'sin manifest'}`);
  }

  const registry = loadRegistry();
  registry.plugins[manifest.id] = {
    enabled: true,
    source: options.user ? 'user' : 'repo',
    installedAt: new Date().toISOString(),
  };
  saveRegistry(registry);

  return { id: manifest.id, dir: stagedDir, source: options.user ? 'user' : 'repo' };
}

// ─── Eliminación ─────────────────────────────────────────────────────────────

export function removePlugin(id: string, options: { keepFiles?: boolean } = {}): void {
  const registry = loadRegistry();
  if (!registry.plugins[id]) {
    throw new Error(`plugin no registrado: ${id} (use 'list' para ver los plugins)`);
  }

  const plugin = findPlugin(id);
  if (!plugin) {
    delete registry.plugins[id];
    saveRegistry(registry);
    return;
  }

  if (!options.keepFiles) {
    console.log(`[PLUGIN-MANAGER] Eliminando directorio ${plugin.dir} ...`);
    rmSync(plugin.dir, { recursive: true, force: true });
  }

  delete registry.plugins[id];
  saveRegistry(registry);
}

// ─── enable / disable ────────────────────────────────────────────────────────

export function setPluginEnabled(id: string, enabled: boolean): DiscoveredPlugin {
  const plugin = findPlugin(id);
  if (!plugin) throw new Error(`plugin no encontrado: ${id} (use 'list' para ver los plugins)`);

  const registry = loadRegistry();
  const entry = registry.plugins[id] ?? {
    enabled,
    source: plugin.source,
    installedAt: new Date().toISOString(),
  };
  entry.enabled = enabled;
  registry.plugins[id] = entry;
  saveRegistry(registry);

  return { ...plugin, enabled };
}

// ─── Salida ──────────────────────────────────────────────────────────────────

function printList(plugins: DiscoveredPlugin[], quiet = false): void {
  if (quiet) return;
  const rows = plugins.map((p) => ({
    id: p.id,
    version: p.manifest.version,
    enabled: p.enabled ? 'yes' : 'no',
    source: p.source,
    entry: p.manifest.entry,
    hooks: p.hooks.map((h) => h.event).join(',') || '-',
    valid: p.valid ? 'ok' : `ERROR (${p.error ?? '?'})`,
  }));
  console.table(rows);
}

function printStatus(plugins: DiscoveredPlugin[]): void {
  const total = plugins.length;
  const valid = plugins.filter((p) => p.valid).length;
  const enabled = plugins.filter((p) => p.valid && p.enabled).length;
  const invalid = plugins.filter((p) => !p.valid);

  console.log('=== Plugin System Status ===');
  console.log(
    `total: ${total} | validos: ${valid} | habilitados: ${enabled} | invalidos: ${invalid.length}`,
  );
  console.log('');
  console.log('HABILITADOS:');
  for (const p of plugins.filter((x) => x.valid && x.enabled)) {
    console.log(
      `  [${p.source}] ${p.id}@${p.manifest.version} — hooks: ${p.hooks.map((h) => h.event).join(', ') || '-'}`,
    );
  }
  console.log('');
  console.log('DESHABILITADOS:');
  for (const p of plugins.filter((x) => x.valid && !x.enabled)) {
    console.log(`  [${p.source}] ${p.id}@${p.manifest.version}`);
  }
  if (invalid.length) {
    console.log('');
    console.log('INVALIDOS:');
    for (const p of invalid) {
      console.log(`  [${p.source}] ${p.id} — ${p.error}`);
    }
  }
}

function printHooks(event: string, results: HookRunResult[]): void {
  const ok = results.filter((r) => r.ok);

  for (const r of results) {
    const mark = r.ok ? 'OK' : 'FAIL';
    const detail = r.error ? ` — ${r.error}` : r.stdout ? ` — ${r.stdout}` : '';
    console.log(`[${mark}] ${r.pluginId} (${r.event}) ${r.script}${detail}`);
  }
  console.log(
    `\n${ok.length}/${results.length} hooks completaron con éxito para el evento "${event}"`,
  );
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const USAGE = `Uso:
  list                          Lista los plugins descubiertos (validos e invalidos)
  --status                      Resumen de estado del sistema de plugins
  install <git-url|path> [--user] [--name <dir>]
                                Instala un plugin desde git (clone) o path local (copia)
  remove <id> [--keep-files]    Desinstala un plugin (quita del registry y borra su dir)
  enable <id>                   Habilita un plugin (persistido en config/plugin-registry.json)
  disable <id>                  Deshabilita un plugin
  hooks <event> [--json]        Ejecuta los hooks de los plugins que escuchan <event>`;

function main(): void {
  const args = process.argv.slice(2);
  const has = (flag: string): boolean => args.includes(flag);
  const value = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
  };
  const positional = (i: number): string | undefined =>
    args.find((a, idx) => !a.startsWith('-') && idx === i) ?? undefined;

  const cmd = args.find((a) => !a.startsWith('-'));

  if (cmd === 'list' || has('--status')) {
    const plugins = discoverPlugins();
    if (has('--status')) {
      printStatus(plugins);
    } else {
      printList(plugins, has('--quiet'));
    }
    return;
  }

  if (cmd === 'install') {
    const target = args.find(
      (a, idx) => a !== 'install' && !a.startsWith('--') && idx === args.indexOf('install') + 1,
    );
    if (!target) {
      console.error('Falta el target: install <git-url|path>');
      console.error(USAGE);
      process.exitCode = 1;
      return;
    }
    try {
      const result = installPlugin(target, {
        user: has('--user'),
        name: value('--name'),
      });
      console.log(
        `[PLUGIN-MANAGER] Plugin instalado: ${result.id} en ${result.dir} (${result.source})`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[PLUGIN-MANAGER] Error instalando: ${msg}`);
      process.exitCode = 1;
    }
    return;
  }

  if (cmd === 'remove') {
    const id = positional(1);
    if (!id) {
      console.error('Falta el id: remove <id>');
      process.exitCode = 1;
      return;
    }
    try {
      removePlugin(id, { keepFiles: has('--keep-files') });
      console.log(`[PLUGIN-MANAGER] Plugin ${id} removido.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[PLUGIN-MANAGER] Error removiendo: ${msg}`);
      process.exitCode = 1;
    }
    return;
  }

  if (cmd === 'enable' || cmd === 'disable') {
    const id = positional(1);
    if (!id) {
      console.error(`Falta el id: ${cmd} <id>`);
      process.exitCode = 1;
      return;
    }
    try {
      const enabled = cmd === 'enable';
      setPluginEnabled(id, enabled);
      console.log(`[PLUGIN-MANAGER] Plugin ${id} ${enabled ? 'habilitado' : 'deshabilitado'}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[PLUGIN-MANAGER] Error: ${msg}`);
      process.exitCode = 1;
    }
    return;
  }

  if (cmd === 'hooks') {
    const event = positional(1) ?? value('--event');
    if (!event) {
      console.error('Falta el evento: hooks <event>');
      process.exitCode = 1;
      return;
    }
    const results = runHooks(event);
    if (has('--json')) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      printHooks(event, results);
    }
    if (results.some((r) => !r.ok)) process.exitCode = 1;
    return;
  }

  console.log('=== Plugin Manager ===');
  console.log(USAGE);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
