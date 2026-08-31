/**
 * skill-registry.ts — Lifecycle registry for installed skill plugins (F3.4)
 *
 * State is persisted to `.runtime/skill-plugins.json` (idempotent writes,
 * whole-file replace). A SHA-256 hash over the entries gives lightweight
 * tamper evidence: `verifyIndex()` recomputes and compares it.
 *
 * Lifecycle: install -> enabled | disabled -> deprecated -> removed.
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { SkillManifest } from './skill-manifest.js';

export type SkillPluginStatus = 'enabled' | 'disabled' | 'deprecated';

export interface SkillPluginEntry {
  name: string;
  version: string;
  description: string;
  license?: string;
  permissions: string[];
  entrypoint: string;
  /** Origin URL/path the skill was installed from. */
  origin: string;
  /** How the source was fetched: local | git | archive. */
  originType: 'local' | 'git' | 'archive';
  installedAt: string; // ISO date
  /** SHA-256 of the entrypoint (SKILL.md) at install time. */
  checksum: string;
  status: SkillPluginStatus;
  manifestOrigin: 'gv-plugin.json' | 'SKILL.md';
}

export interface SkillRegistryFile {
  version: 1;
  updatedAt: string;
  /** SHA-256 over the canonical JSON of `skills`, for tamper evidence. */
  integrity: string;
  skills: Record<string, SkillPluginEntry>;
}

export interface RegistryOptions {
  /** Repo root (default: process.cwd()). `.runtime/` is resolved under it. */
  root?: string;
}

const REGISTRY_REL = join('.runtime', 'skill-plugins.json');

export function registryPath(opts: RegistryOptions = {}): string {
  return join(opts.root ?? process.cwd(), REGISTRY_REL);
}

function emptyRegistry(): SkillRegistryFile {
  return { version: 1, updatedAt: new Date().toISOString(), integrity: '', skills: {} };
}

export function computeIntegrity(skills: SkillRegistryFile['skills']): string {
  const canonical = JSON.stringify(
    Object.keys(skills)
      .sort()
      .map((k) => [k, skills[k]]),
  );
  return createHash('sha256').update(canonical).digest('hex');
}

export function loadRegistry(opts: RegistryOptions = {}): SkillRegistryFile {
  const p = registryPath(opts);
  if (!existsSync(p)) return emptyRegistry();
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as Partial<SkillRegistryFile>;
    if (raw.version !== 1 || typeof raw.skills !== 'object' || raw.skills === null) {
      return emptyRegistry();
    }
    return {
      version: 1,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
      integrity: typeof raw.integrity === 'string' ? raw.integrity : '',
      skills: raw.skills as SkillRegistryFile['skills'],
    };
  } catch {
    return emptyRegistry();
  }
}

export function saveRegistry(
  reg: SkillRegistryFile,
  opts: RegistryOptions = {},
): SkillRegistryFile {
  const dir = join(opts.root ?? process.cwd(), '.runtime');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const next: SkillRegistryFile = {
    ...reg,
    updatedAt: new Date().toISOString(),
    integrity: computeIntegrity(reg.skills),
  };
  writeFileSync(registryPath(opts), JSON.stringify(next, null, 2));
  return next;
}

/** Recompute integrity and compare against the persisted value. */
export function verifyIndex(opts: RegistryOptions = {}): { ok: boolean; expected: string; actual: string } {
  const reg = loadRegistry(opts);
  const actual = computeIntegrity(reg.skills);
  return { ok: reg.integrity === actual, expected: reg.integrity, actual };
}

// ─── Lifecycle operations ────────────────────────────────────────────────────

export interface UpsertInput {
  manifest: SkillManifest;
  origin: string;
  originType: SkillPluginEntry['originType'];
  checksum: string;
  manifestOrigin: SkillPluginEntry['manifestOrigin'];
}

/** Idempotent: reinstalling the same version is a no-op that refreshes metadata. */
export function upsertEntry(input: UpsertInput, opts: RegistryOptions = {}): SkillPluginEntry {
  const reg = loadRegistry(opts);
  const existing = reg.skills[input.manifest.name];
  const entry: SkillPluginEntry = {
    name: input.manifest.name,
    version: input.manifest.version,
    description: input.manifest.description,
    license: input.manifest.license,
    permissions: input.manifest.permissions,
    entrypoint: input.manifest.entrypoint,
    origin: input.origin,
    originType: input.originType,
    installedAt: existing?.installedAt ?? new Date().toISOString(),
    checksum: input.checksum,
    status: existing?.status ?? 'enabled',
    manifestOrigin: input.manifestOrigin,
  };
  reg.skills[entry.name] = entry;
  saveRegistry(reg, opts);
  return entry;
}

export function getEntry(name: string, opts: RegistryOptions = {}): SkillPluginEntry | undefined {
  return loadRegistry(opts).skills[name];
}

export function listEntries(opts: RegistryOptions = {}): SkillPluginEntry[] {
  return Object.values(loadRegistry(opts).skills).sort((a, b) => a.name.localeCompare(b.name));
}

export function setStatus(
  name: string,
  status: SkillPluginStatus,
  opts: RegistryOptions = {},
): { ok: boolean; message: string; entry?: SkillPluginEntry } {
  const reg = loadRegistry(opts);
  const entry = reg.skills[name];
  if (!entry) return { ok: false, message: `skill plugin '${name}' is not installed` };
  entry.status = status;
  saveRegistry(reg, opts);
  const past = status === 'enabled' ? 'enabled' : status === 'disabled' ? 'disabled' : 'deprecated';
  return { ok: true, message: `skill '${name}' is now ${past}`, entry };
}

export function removeEntry(
  name: string,
  opts: RegistryOptions = {},
): { ok: boolean; message: string } {
  const reg = loadRegistry(opts);
  if (!reg.skills[name]) return { ok: false, message: `skill plugin '${name}' is not installed` };
  delete reg.skills[name];
  saveRegistry(reg, opts);
  return { ok: true, message: `skill '${name}' removed from registry` };
}
