#!/usr/bin/env node
/**
 * Temp File Registry
 *
 * Sistema de registro y ciclo de vida de archivos temporales.
 * Trackea qué archivos temporales se crearon, cuáles fueron autorizados
 * por el usuario para permanecer, cuáles se integraron al stack, y cuáles
 * deben limpiarse al cierre de sesión.
 *
 * Almacenamiento: .session/temp-file-registry.json
 *
 * Uso CLI:
 *   npx tsx src/tools/temp-file-registry.ts --list
 *   npx tsx src/tools/temp-file-registry.ts --add path/to/file --reason "exploration"
 *   npx tsx src/tools/temp-file-registry.ts --authorize path/to/file --reason "user approved"
 *   npx tsx src/tools/temp-file-registry.ts --integrate path/to/file --into "workflow/name"
 *   npx tsx src/tools/temp-file-registry.ts --prune
 *   npx tsx src/tools/temp-file-registry.ts --clean-unregistered
 *   npx tsx src/tools/temp-file-registry.ts --status path/to/file
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, resolve, relative } from 'path';
import { pathToFileURL } from 'url';

const ROOT = resolve(process.cwd());
const REGISTRY_FILE = join(ROOT, '.session', 'temp-file-registry.json');

// ─── Types ──────────────────────────────────────────────────────────────────

export type TempFileStatus = 'temporary' | 'authorized-pending' | 'permanent';

export interface TempFileEntry {
  /** Relative path from repo root (forward slashes) */
  path: string;
  /** ISO timestamp of when the file was created */
  created: string;
  /** Whether the user authorized this file to persist */
  authorized_by_user: boolean;
  /** ISO timestamp of authorization (null if not authorized) */
  authorized_at: string | null;
  /** Free-text reason for authorization */
  authorized_reason: string | null;
  /** ISO timestamp when the file was integrated into a workflow/process */
  integrated_at: string | null;
  /** Reference to what workflow/process it was integrated into */
  integrated_into: string | null;
  /** Current lifecycle status */
  status: TempFileStatus;
  /** Session ID that created this entry */
  created_in_session: string | null;
}

export interface TempFileRegistry {
  version: 1;
  lastUpdated: string;
  entries: TempFileEntry[];
}

// ─── Registry Operations ────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`[TEMP-REGISTRY] ${msg}`);
}
function ok(msg: string) {
  console.log(`[TEMP-REGISTRY] ✅ ${msg}`);
}
function warn(msg: string) {
  console.warn(`[TEMP-MEM] ⚠️ ${msg}`);
}

function getSessionId(): string | null {
  try {
    const sf = join(ROOT, '.session', 'session-current.json');
    if (existsSync(sf)) {
      const data = JSON.parse(readFileSync(sf, 'utf-8'));
      return data.sessionId || data.id || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function loadRegistry(): TempFileRegistry {
  try {
    if (existsSync(REGISTRY_FILE)) {
      const raw = readFileSync(REGISTRY_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as TempFileRegistry;
      // Ensure version field
      if (!parsed.version) parsed.version = 1;
      return parsed;
    }
  } catch (e) {
    warn(`Could not load registry: ${e instanceof Error ? e.message : 'unknown'}`);
  }
  return { version: 1, lastUpdated: new Date().toISOString(), entries: [] };
}

export function saveRegistry(registry: TempFileRegistry): void {
  registry.lastUpdated = new Date().toISOString();
  mkdirSync(join(ROOT, '.session'), { recursive: true });
  writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

/**
 * Normalize a file path to a consistent relative format (forward slashes, from repo root).
 */
function normalizePath(filePath: string): string {
  return relative(ROOT, resolve(filePath)).replace(/\\/g, '/');
}

/**
 * Add a new temp file entry to the registry.
 * If the file is already registered, it is NOT duplicated (idempotent).
 */
export function addEntry(
  filePath: string,
  reason?: string,
  status?: TempFileStatus,
): TempFileEntry {
  const registry = loadRegistry();
  const normalized = normalizePath(filePath);

  // Check if already exists
  const existing = registry.entries.find((e) => e.path === normalized);
  if (existing) {
    log(`File already registered: ${normalized} (status: ${existing.status})`);
    return existing;
  }

  const now = new Date().toISOString();
  const entry: TempFileEntry = {
    path: normalized,
    created: now,
    authorized_by_user: false,
    authorized_at: null,
    authorized_reason: reason || null,
    integrated_at: null,
    integrated_into: null,
    status: status || 'temporary',
    created_in_session: getSessionId(),
  };

  registry.entries.push(entry);
  saveRegistry(registry);
  ok(`Registered temp file: ${normalized} (status: ${entry.status})`);
  return entry;
}

/**
 * Mark a temp file as authorized by the user to persist.
 */
export function authorizeEntry(filePath: string, reason?: string): TempFileEntry | null {
  const registry = loadRegistry();
  const normalized = normalizePath(filePath);
  const entry = registry.entries.find((e) => e.path === normalized);

  if (!entry) {
    warn(`File not in registry: ${normalized}. Use --add first.`);
    // Auto-add as authorized-pending
    const now = new Date().toISOString();
    const newEntry: TempFileEntry = {
      path: normalized,
      created: now,
      authorized_by_user: true,
      authorized_at: now,
      authorized_reason: reason || 'User authorized permanence',
      integrated_at: null,
      integrated_into: null,
      status: 'authorized-pending',
      created_in_session: getSessionId(),
    };
    registry.entries.push(newEntry);
    saveRegistry(registry);
    ok(`Auto-registered and authorized: ${normalized}`);
    return newEntry;
  }

  entry.authorized_by_user = true;
  entry.authorized_at = new Date().toISOString();
  entry.authorized_reason = reason || entry.authorized_reason || 'User authorized permanence';
  if (entry.status === 'temporary') entry.status = 'authorized-pending';
  saveRegistry(registry);
  ok(`Authorized: ${normalized} (status: ${entry.status})`);
  return entry;
}

/**
 * Mark a temp file as integrated into a workflow/process.
 */
export function integrateEntry(filePath: string, into: string): TempFileEntry | null {
  const registry = loadRegistry();
  const normalized = normalizePath(filePath);
  const entry = registry.entries.find((e) => e.path === normalized);

  if (!entry) {
    warn(`File not in registry: ${normalized}`);
    return null;
  }

  entry.integrated_at = new Date().toISOString();
  entry.integrated_into = into;
  entry.status = 'permanent';
  saveRegistry(registry);
  ok(`Integrated: ${normalized} → ${into} (status: permanent)`);
  return entry;
}

/**
 * Get entry by path.
 */
export function getEntry(filePath: string): TempFileEntry | undefined {
  const registry = loadRegistry();
  const normalized = normalizePath(filePath);
  return registry.entries.find((e) => e.path === normalized);
}

/**
 * List entries filtered by status.
 */
export function listEntries(status?: TempFileStatus): TempFileEntry[] {
  const registry = loadRegistry();
  if (status) return registry.entries.filter((e) => e.status === status);
  return registry.entries;
}

/**
 * Find temp files that exist on disk but are NOT in the registry (unregistered temps).
 * Scans known temp directories.
 */
export function findUnregisteredTempFiles(): string[] {
  const registry = loadRegistry();
  const registeredPaths = new Set(registry.entries.map((e) => e.path));

  const tempDirs = ['.session/tmp/', '.session/cache/', '.temp/', 'tmp/'];

  const unregistered: string[] = [];
  for (const dir of tempDirs) {
    const fullDir = join(ROOT, dir);
    if (!existsSync(fullDir)) continue;
    try {
      const files = readdirRecursive(fullDir);
      for (const f of files) {
        const rel = normalizePath(f);
        if (!registeredPaths.has(rel) && !rel.endsWith('.gitkeep') && !rel.endsWith('.empty')) {
          unregistered.push(rel);
        }
      }
    } catch {
      /* skip unreadable dirs */
    }
  }

  return unregistered;
}

function readdirRecursive(dir: string): string[] {
  const result: string[] = [];
  try {
    const entries = require('fs').readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        result.push(...readdirRecursive(full));
      } else {
        result.push(full);
      }
    }
  } catch {
    /* ignore */
  }
  return result;
}

/**
 * Prune the registry: remove entries for files that no longer exist and are temporary.
 * Remove entries that are temporary and older than maxAgeDays.
 */
export function pruneRegistry(maxAgeDays = 30, dryRun = false): { removed: number; kept: number } {
  const registry = loadRegistry();
  const before = registry.entries.length;
  const now = Date.now();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

  const surviving: TempFileEntry[] = [];

  for (const entry of registry.entries) {
    const fullPath = join(ROOT, entry.path);
    const fileExists = existsSync(fullPath);
    const age = now - new Date(entry.created).getTime();

    // Keep if: file exists AND (is permanent or authorized-pending)
    // Keep if: file exists AND is temporary but younger than maxAge
    // Remove if: file does NOT exist
    // Remove if: temporary AND older than maxAge

    const shouldKeep = fileExists && (entry.status !== 'temporary' || age < maxAgeMs);

    if (shouldKeep) {
      surviving.push(entry);
    }
  }

  if (!dryRun) {
    registry.entries = surviving;
    saveRegistry(registry);
  }

  const removed = before - surviving.length;
  const kept = surviving.length;

  if (dryRun) {
    log(`[DRY-RUN] Would remove ${removed} entries, keep ${kept}`);
  } else {
    if (removed > 0) ok(`Pruned ${removed} stale registry entries (kept ${kept})`);
    else log(`Registry already clean (${kept} entries)`);
  }

  return { removed, kept };
}

/**
 * Clean up temp files that are NOT authorized (status=temporary) and NOT registered.
 * Only cleans files in known temp directories.
 * Does NOT touch files authorized by the user.
 */
export function cleanUnregisteredTemps(dryRun = false): { deleted: number } {
  const unregistered = findUnregisteredTempFiles();
  let deleted = 0;

  for (const relPath of unregistered) {
    const fullPath = join(ROOT, relPath);
    if (existsSync(fullPath)) {
      if (!dryRun) {
        try {
          rmSync(fullPath, { force: true });
          deleted++;
        } catch {
          /* skip locked files */
        }
      } else {
        deleted++;
      }
    }
  }

  if (dryRun) {
    log(`[DRY-RUN] Would delete ${deleted} unregistered temp files`);
    for (const f of unregistered.slice(0, 20)) {
      log(`  Would delete: ${f}`);
    }
    if (unregistered.length > 20) log(`  ... and ${unregistered.length - 20} more`);
  } else {
    if (deleted > 0) ok(`Cleaned ${deleted} unregistered temp files`);
    else log('No unregistered temp files to clean');
  }

  return { deleted };
}

/**
 * Scan for temporary files that are authorized-pending but now have their
 * file missing on disk (user deleted it manually).
 */
export function findOrphanedAuthorizations(): TempFileEntry[] {
  const registry = loadRegistry();
  const orphans: TempFileEntry[] = [];
  for (const entry of registry.entries) {
    if (entry.status === 'authorized-pending' || entry.status === 'permanent') {
      const fullPath = join(ROOT, entry.path);
      if (!existsSync(fullPath)) {
        orphans.push(entry);
      }
    }
  }
  return orphans;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: npx tsx src/tools/temp-file-registry.ts [options]

Options:
  --list [status]              List registry entries (optional filter: temporary|authorized-pending|permanent)
  --add <path> [--reason <r>]  Register a temp file
  --authorize <path> [--reason <r>]  Mark file as authorized to persist
  --integrate <path> --into <wf>     Mark file as integrated into workflow
  --status <path>              Show status of a specific file
  --unregistered               Find temp files not in registry
  --prune [--days <n>]         Prune stale registry entries (default: 30 days)
  --clean-unregistered         Delete unregistered temp files
  --orphans                    Find orphaned authorizations (files missing on disk)
  --dry-run                    Preview without making changes
  --help                       Show this help
`);
    return;
  }

  const dryRun = args.includes('--dry-run');

  // --list [status]
  if (args.includes('--list')) {
    const statusIdx = args.indexOf('--list') + 1;
    const statusFilter =
      statusIdx < args.length && !args[statusIdx].startsWith('--')
        ? (args[statusIdx] as TempFileStatus)
        : undefined;
    const entries = listEntries(statusFilter);
    if (entries.length === 0) {
      log('No entries found.');
      return;
    }
    log(`Found ${entries.length} entries${statusFilter ? ` (status: ${statusFilter})` : ''}:`);
    for (const e of entries) {
      const auth = e.authorized_by_user ? `🔓` : `🔒`;
      const integ = e.integrated_at ? `✅` : `⏳`;
      console.log(`  ${auth}${integ} [${e.status}] ${e.path}`);
      console.log(`       Created: ${e.created}`);
      if (e.authorized_reason) console.log(`       Reason: ${e.authorized_reason}`);
      if (e.integrated_into) console.log(`       Into: ${e.integrated_into}`);
    }
    return;
  }

  // --add <path> [--reason <r>]
  if (args.includes('--add')) {
    const idx = args.indexOf('--add') + 1;
    if (idx >= args.length) {
      console.error('ERROR: --add requires a path');
      process.exit(1);
    }
    const filePath = args[idx];
    const reasonIdx = args.indexOf('--reason');
    const reason = reasonIdx >= 0 && reasonIdx + 1 < args.length ? args[reasonIdx + 1] : undefined;
    addEntry(filePath, reason);
    return;
  }

  // --authorize <path> [--reason <r>]
  if (args.includes('--authorize')) {
    const idx = args.indexOf('--authorize') + 1;
    if (idx >= args.length) {
      console.error('ERROR: --authorize requires a path');
      process.exit(1);
    }
    const filePath = args[idx];
    const reasonIdx = args.indexOf('--reason');
    const reason = reasonIdx >= 0 && reasonIdx + 1 < args.length ? args[reasonIdx + 1] : undefined;
    authorizeEntry(filePath, reason);
    return;
  }

  // --integrate <path> --into <wf>
  if (args.includes('--integrate')) {
    const idx = args.indexOf('--integrate') + 1;
    if (idx >= args.length) {
      console.error('ERROR: --integrate requires a path');
      process.exit(1);
    }
    const filePath = args[idx];
    const intoIdx = args.indexOf('--into');
    if (intoIdx < 0 || intoIdx + 1 >= args.length) {
      console.error('ERROR: --integrate requires --into <workflow>');
      process.exit(1);
    }
    const into = args[intoIdx + 1];
    integrateEntry(filePath, into);
    return;
  }

  // --status <path>
  if (args.includes('--status')) {
    const idx = args.indexOf('--status') + 1;
    if (idx >= args.length) {
      console.error('ERROR: --status requires a path');
      process.exit(1);
    }
    const entry = getEntry(args[idx]);
    if (!entry) {
      log('File not found in registry.');
      process.exit(1);
    }
    console.log(JSON.stringify(entry, null, 2));
    return;
  }

  // --unregistered
  if (args.includes('--unregistered')) {
    const files = findUnregisteredTempFiles();
    if (files.length === 0) {
      log('No unregistered temp files found.');
      return;
    }
    log(`Found ${files.length} unregistered temp files:`);
    for (const f of files) {
      console.log(`  ${f}`);
    }
    return;
  }

  // --prune
  if (args.includes('--prune')) {
    const daysIdx = args.indexOf('--days');
    const days = daysIdx >= 0 && daysIdx + 1 < args.length ? parseInt(args[daysIdx + 1], 10) : 30;
    pruneRegistry(days, dryRun);
    return;
  }

  // --clean-unregistered
  if (args.includes('--clean-unregistered')) {
    cleanUnregisteredTemps(dryRun);
    return;
  }

  // --orphans
  if (args.includes('--orphans')) {
    const orphans = findOrphanedAuthorizations();
    if (orphans.length === 0) {
      log('No orphaned authorizations found.');
      return;
    }
    log(`Found ${orphans.length} orphaned authorization(s) — file missing on disk:`);
    for (const o of orphans) {
      console.log(`  ${o.path} (status: ${o.status}, authorized: ${o.authorized_at})`);
    }
    return;
  }

  console.error(`Unknown option: ${args[0]}. Use --help for usage.`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
