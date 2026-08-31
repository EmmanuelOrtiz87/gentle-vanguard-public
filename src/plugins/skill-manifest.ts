/**
 * skill-manifest.ts — Plugin contract for external skills (F3.4)
 *
 * A skill plugin can declare itself in two equivalent ways:
 *   1. A `gv-plugin.json` manifest file at the skill root.
 *   2. The standard SKILL.md YAML frontmatter (the real format used by the
 *      ~199 skills in this repo): `name`, `description` (inline or `>` folded)
 *      and a nested `metadata:` block with `source`, `license`, `version`,
 *      and optionally `permissions`.
 *
 * Both paths converge on the same zod-validated `SkillManifest`.
 */

/* eslint-disable security/detect-unsafe-regex -- validated literal patterns (kebab/semver), no user input in regex position */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

// ─── Permissions model (closed enum) ─────────────────────────────────────────

export const SKILL_PERMISSIONS = [
  'filesystem-read',
  'filesystem-write',
  'network',
  'subprocess',
  'none',
] as const;

export type SkillPermission = (typeof SKILL_PERMISSIONS)[number];

/**
 * `none` is exclusive: a manifest that declares it cannot declare any
 * capability permission at the same time.
 */
const permissionsSchema = z
  .array(z.enum(SKILL_PERMISSIONS))
  .min(1)
  .refine(
    (perms) => !(perms.includes('none') && perms.length > 1),
    { message: "'none' cannot be combined with other permissions" },
  )
  .default(['none']);

// ─── Manifest schema ─────────────────────────────────────────────────────────

const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export const skillManifestSchema = z.object({
  /** Kebab-case skill name (also the install directory name). */
  name: z
    .string()
    .min(2)
    .max(64)
    .regex(KEBAB_RE, 'name must be kebab-case (a-z, 0-9, hyphens)'),
  /** Semantic version. */
  version: z.string().regex(SEMVER_RE, 'version must be semver (e.g. 1.2.0)'),
  /** Human/trigger description. */
  description: z.string().min(10).max(4000),
  /** Provenance: where the skill came from (URL, path, repo). */
  source: z.string().min(1).max(500).optional(),
  /** SPDX-style license identifier (MIT, Apache-2.0, ...). */
  license: z.string().min(1).max(64).optional(),
  /** Declared capabilities. Closed enum; `none` is exclusive. */
  permissions: permissionsSchema,
  /** Entry document relative to the skill root. */
  entrypoint: z
    .string()
    .min(5)
    .refine((p) => !p.startsWith('/') && !p.includes('..'), {
      message: 'entrypoint must be a relative path inside the skill',
    })
    .default('SKILL.md'),
  /** Free-form optional metadata (author, homepage, tags...). */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type SkillManifest = z.infer<typeof skillManifestSchema>;

export interface ManifestResult {
  ok: boolean;
  manifest?: SkillManifest;
  /** Human-readable validation errors (empty when ok). */
  errors: string[];
  /** Which detection path produced the manifest. */
  origin: 'gv-plugin.json' | 'SKILL.md' | 'none';
}

function toResult(
  parsed: ReturnType<typeof skillManifestSchema.safeParse>,
  origin: ManifestResult['origin'],
): ManifestResult {
  if (parsed.success) return { ok: true, manifest: parsed.data, errors: [], origin };
  const errors = parsed.error.issues.map(
    (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
  );
  return { ok: false, errors, origin };
}

// ─── Path A: gv-plugin.json ──────────────────────────────────────────────────

export function manifestFromGvPluginJson(json: unknown): ManifestResult {
  return toResult(skillManifestSchema.safeParse(json), 'gv-plugin.json');
}

// ─── Path B: SKILL.md frontmatter (the real repo format) ─────────────────────

export interface ParsedFrontmatter {
  fields: Record<string, string | string[]>;
  /** One-level-nested blocks (e.g. `metadata:`). */
  nested: Record<string, Record<string, string>>;
  body: string;
}

/**
 * Minimal YAML-subset parser that covers the frontmatter actually used by
 * skills in this repo: scalar keys, `>` folded multi-line descriptions,
 * `- ` item arrays, and one level of nested mappings (`metadata:`).
 */
export function parseSkillFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { fields: {}, nested: {}, body: content };
  const yaml = match[1];
  const body = match[2];

  const fields: Record<string, string | string[]> = {};
  const nested: Record<string, Record<string, string>> = {};
  let currentKey = '';
  let currentNestedKey: string | null = null;
  let currentArray: string[] = [];

  const flushArray = () => {
    if (currentKey && currentArray.length > 0) {
      fields[currentKey] = currentArray;
      currentArray = [];
    }
  };

  for (const rawLine of yaml.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) continue;

    const nestedMatch = line.match(/^(\s{2,})([a-zA-Z0-9_-]+):\s*(.*)$/);
    const keyMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);

    if (keyMatch && (!nestedMatch || nestedMatch[1].length === 0)) {
      flushArray();
      currentNestedKey = null;
      currentKey = keyMatch[1];
      const value = keyMatch[2].trim();
      if (value === '') {
        // Could be a nested block start (e.g. `metadata:`) — resolved lazily.
        currentNestedKey = currentKey;
        nested[currentKey] = {};
      } else if (value.startsWith('[') && value.endsWith(']')) {
        fields[currentKey] = value
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (value === '>') {
        fields[currentKey] = ''; // folded block scalar, accumulated below
      } else {
        fields[currentKey] = value;
      }
      continue;
    }

    if (nestedMatch && currentNestedKey !== null) {
      const v = nestedMatch[3].trim().replace(/^["']|["']$/g, '');
      nested[currentNestedKey][nestedMatch[2]] = v;
      continue;
    }

    if (line.trim().startsWith('- ')) {
      currentArray.push(line.trim().slice(2).trim());
      continue;
    }

    // Continuation of a folded (`>`) scalar.
    if (currentKey && typeof fields[currentKey] === 'string') {
      fields[currentKey] = `${fields[currentKey]} ${line.trim()}`.trim();
    } else if (currentKey && Array.isArray(fields[currentKey])) {
      fields[currentKey] = [...fields[currentKey], line.trim()];
    }
  }
  flushArray();

  return { fields, nested, body };
}

/**
 * Build a manifest from SKILL.md frontmatter. Fields map as follows:
 *   name        -> name
 *   description -> description
 *   metadata.source      -> source (optional)
 *   metadata.license     -> license (optional)
 *   metadata.version     -> version (REQUIRED for installable plugins)
 *   metadata.permissions -> permissions (comma-separated or array; default none)
 */
export function manifestFromSkillMd(content: string): ManifestResult {
  const { fields, nested } = parseSkillFrontmatter(content);
  const meta = nested.metadata ?? {};

  const rawPerms = Array.isArray(fields.permissions)
    ? fields.permissions
    : typeof meta.permissions === 'string'
      ? meta.permissions.split(',').map((s) => s.trim()).filter(Boolean)
      : ['none'];

  const candidate: Record<string, unknown> = {
    name: fields.name,
    description: typeof fields.description === 'string' ? fields.description : undefined,
    permissions: rawPerms,
  };
  if (meta.source) candidate.source = meta.source;
  if (meta.license) candidate.license = meta.license;
  if (meta.version) candidate.version = meta.version;
  if (meta.author || meta.homepage || meta.upstream) {
    candidate.metadata = {
      ...(meta.author ? { author: meta.author } : {}),
      ...(meta.homepage ? { homepage: meta.homepage } : {}),
      ...(meta.upstream ? { upstream: meta.upstream } : {}),
    };
  }

  return toResult(skillManifestSchema.safeParse(candidate), 'SKILL.md');
}

// ─── Resolution over a skill directory ───────────────────────────────────────

export const GV_PLUGIN_FILE = 'gv-plugin.json';
export const SKILL_MD_FILE = 'SKILL.md';

/**
 * Resolve and validate the manifest of a skill directory. Prefers an explicit
 * `gv-plugin.json`; falls back to SKILL.md frontmatter. Either one suffices.
 */
export function resolveManifest(dir: string): ManifestResult {
  const gvPath = join(dir, GV_PLUGIN_FILE);
  if (existsSync(gvPath)) {
    try {
      const json: unknown = JSON.parse(readFileSync(gvPath, 'utf-8'));
      return manifestFromGvPluginJson(json);
    } catch (e) {
      return {
        ok: false,
        origin: 'gv-plugin.json',
        errors: [`${GV_PLUGIN_FILE} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`],
      };
    }
  }

  const mdPath = join(dir, SKILL_MD_FILE);
  if (existsSync(mdPath)) {
    return manifestFromSkillMd(readFileSync(mdPath, 'utf-8'));
  }

  return {
    ok: false,
    origin: 'none',
    errors: [`no ${GV_PLUGIN_FILE} nor ${SKILL_MD_FILE} found in ${dir}`],
  };
}
