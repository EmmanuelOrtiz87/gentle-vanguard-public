/**
 * skill-install.ts — Install external skills into skills/ (F3.4)
 *
 * Sources supported:
 *   - local directory path  (contains SKILL.md or gv-plugin.json)
 *   - git URL               (git clone --depth 1, argv array via runSync — no shell)
 *   - tar.gz / zip URL      (fetch -> `tar -xf`, bsdtar ships with Windows 10+)
 *
 * Pipeline per AGENTS.md procesos-ocultos: only `run`/`runSync` from
 * src/core/run-command.ts (windowsHide, argv arrays, no exec strings, no
 * spawn of npx.cmd). Node's fetch downloads archives.
 *
 * After fetch: manifest validation -> secret scan of the payload -> copy to
 * skills/<name>/ -> frontmatter stamp (`source: external-installed` +
 * provenance) -> registry upsert.
 */

/* eslint-disable security/detect-unsafe-regex -- literal URL classification patterns */
import { createHash } from 'crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runSync } from '../core/run-command.js';
import { scanText } from '../security/secret-scanner/scanner.js';
import {
  GV_PLUGIN_FILE,
  SKILL_MD_FILE,
  resolveManifest,
  type SkillManifest,
} from './skill-manifest.js';
import { getEntry, removeEntry, upsertEntry } from './skill-registry.js';

export interface InstallOptions {
  /** Repo root (default: process.cwd()). Skills land under `<root>/skills/`. */
  root?: string;
}

export interface InstallResult {
  ok: boolean;
  message: string;
  installedPath?: string;
  name?: string;
  version?: string;
  findings?: string[];
}

const GIT_URL_RE = /^(?:git\+)?(?:git|https?|ssh):\/\/[^\s]+(?:\.git)?$/i;
const ARCHIVE_URL_RE = /^https?:\/\/[^\s]+\.(?:tar\.gz|tgz|zip)(?:\?[^\s]*)?$/i;
const TEXT_EXT = new Set([
  '.md', '.txt', '.json', '.yml', '.yaml', '.ts', '.tsx', '.js', '.mjs', '.cjs',
  '.py', '.sh', '.ps1', '.env', '.toml', '.xml', '.html', '.css', '.csv', '.sql',
]);
const MAX_SCAN_BYTES = 2 * 1024 * 1024;

// ─── Secret scan of payload ──────────────────────────────────────────────────

/**
 * Scan all text files of a directory with the repo's real secret scanner
 * (80 patterns). Any high/medium-risk match blocks the install.
 */
export function scanSkillPayload(dir: string): string[] {
  const findings: string[] = [];
  const walk = (d: string) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === '.git' || ent.name === 'node_modules') continue;
        walk(p);
        continue;
      }
      if (!ent.isFile()) continue;
      const dot = ent.name.lastIndexOf('.');
      const ext = dot >= 0 ? ent.name.slice(dot).toLowerCase() : '';
      if (!TEXT_EXT.has(ext)) continue;
      let content: string;
      try {
        if (statSync(p).size > MAX_SCAN_BYTES) continue;
        content = readFileSync(p, 'utf-8');
      } catch {
        continue;
      }
      for (const m of scanText(content)) {
        findings.push(`${p}:${m.line}: ${m.pattern.name} (${m.pattern.risk})`);
      }
    }
  };
  walk(dir);
  return findings;
}

// ─── Source classification & fetch ────────────────────────────────────────────

type SourceType = 'local' | 'git' | 'archive';

function classifySource(source: string): SourceType | null {
  if (ARCHIVE_URL_RE.test(source)) return 'archive';
  if (GIT_URL_RE.test(source)) return 'git';
  if (existsSync(source) && statSync(source).isDirectory()) return 'local';
  return null;
}

/**
 * Locate the skill root inside a fetched tree: a directory that contains
 * SKILL.md or gv-plugin.json. Checks the tree root first, then immediate
 * single-level subdirectories.
 */
export function locateSkillDir(tree: string): string | null {
  if (existsSync(join(tree, SKILL_MD_FILE)) || existsSync(join(tree, GV_PLUGIN_FILE))) {
    return tree;
  }
  for (const ent of readdirSync(tree, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const p = join(tree, ent.name);
    if (existsSync(join(p, SKILL_MD_FILE)) || existsSync(join(p, GV_PLUGIN_FILE))) return p;
  }
  return null;
}

async function fetchToTemp(source: string, type: SourceType): Promise<string> {
  const tmp = mkdtempSync(join(tmpdir(), 'gv-skill-install-'));
  if (type === 'git') {
    const r = runSync('git', ['clone', '--depth', '1', source.replace(/^git\+/, ''), tmp], {
      timeout: 120000,
    });
    if (r.status !== 0) {
      throw new Error(`git clone failed: ${(r.stderr || r.stdout).toString().trim()}`);
    }
    return tmp;
  }
  // archive
  const isZip = /\.zip(\?|$)/i.test(source);
  const archivePath = join(tmp, `payload.${isZip ? 'zip' : 'tar.gz'}`);
  const out = join(tmp, 'extracted');
  mkdirSync(out, { recursive: true });

  const res = await fetch(source);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  writeFileSync(archivePath, Buffer.from(await res.arrayBuffer()));
  // bsdtar (Windows 10+/macOS/Linux) handles both tar.gz and zip.
  const r = runSync('tar', ['-xf', archivePath, '-C', out], { timeout: 60000 });
  if (r.status !== 0) {
    throw new Error(`extraction failed: ${(r.stderr || r.stdout).toString().trim()}`);
  }
  return out;
}

// ─── Frontmatter stamping ────────────────────────────────────────────────────

/**
 * Stamp the SKILL.md frontmatter with plugin provenance:
 *   metadata.source: external-installed
 *   metadata.installed-from / installed-at / checksum
 * Only the frontmatter block is touched; the body is preserved byte-for-byte.
 */
export function stampFrontmatter(
  skillMdPath: string,
  provenance: { origin: string; checksum: string },
): void {
  const content = readFileSync(skillMdPath, 'utf-8');
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) {
    throw new Error(`${skillMdPath} has no frontmatter to stamp`);
  }
  let fm = m[1];
  const stampLines = [
    `  source: external-installed`,
    `  installed-from: ${provenance.origin}`,
    `  installed-at: ${new Date().toISOString()}`,
    `  checksum: ${provenance.checksum}`,
  ];

  if (/^metadata:\s*$/m.test(fm)) {
    // Remove any previous stamp keys inside metadata (idempotent reinstall).
    fm = fm
      .replace(/^\s{2}(source|installed-from|installed-at|checksum):.*$\n?/gm, '')
      .replace(/^(metadata:\s*)$/m, `$1\n${stampLines.join('\n')}`);
  } else {
    fm = `${fm}\nmetadata:\n${stampLines.join('\n')}`;
  }
  writeFileSync(skillMdPath, `---\n${fm.trimEnd()}\n---${content.slice(m[0].length)}`);
}

// ─── Install ─────────────────────────────────────────────────────────────────

export async function installSkill(source: string, opts: InstallOptions = {}): Promise<InstallResult> {
  const root = opts.root ?? process.cwd();
  const type = classifySource(source);
  if (!type) {
    return { ok: false, message: `unsupported source '${source}' (expected local dir, git URL, or .tar.gz/.zip URL)` };
  }

  let fetchedDir: string | null = null;
  let tempDir: string | null = null;
  try {
    if (type === 'local') {
      fetchedDir = source;
    } else {
      tempDir = mkdtempSync(join(tmpdir(), 'gv-skill-src-'));
      fetchedDir = await fetchToTemp(source, type);
    }

    const skillDir = locateSkillDir(fetchedDir);
    if (!skillDir) {
      return { ok: false, message: `no ${SKILL_MD_FILE} or ${GV_PLUGIN_FILE} found in the fetched payload` };
    }

    // 1. Schema + permissions validation.
    const manifestResult = resolveManifest(skillDir);
    if (!manifestResult.ok || !manifestResult.manifest) {
      return { ok: false, message: `manifest validation failed (${manifestResult.origin}): ${manifestResult.errors.join('; ')}` };
    }
    const manifest: SkillManifest = manifestResult.manifest;

    // 2. Secret scan — refuse on any real finding.
    const findings = scanSkillPayload(skillDir);
    if (findings.length > 0) {
      return {
        ok: false,
        message: `refused: secret-like content detected in payload (${findings.length} finding(s))`,
        findings,
      };
    }

    // 3. Copy into skills/<name>/.
    const dest = join(root, 'skills', manifest.name);
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
    mkdirSync(join(root, 'skills'), { recursive: true });
    cpSync(skillDir, dest, {
      recursive: true,
      filter: (src) => !src.includes(join(skillDir, '.git')),
    });

    // 4. Stamp + checksum AFTER copy (checksum is of the shipped SKILL.md).
    const entryFile = join(dest, manifest.entrypoint);
    if (!existsSync(entryFile)) {
      rmSync(dest, { recursive: true, force: true });
      return { ok: false, message: `entrypoint '${manifest.entrypoint}' not found in payload` };
    }
    const checksum = createHash('sha256').update(readFileSync(entryFile)).digest('hex');
    if (manifest.entrypoint === SKILL_MD_FILE) {
      stampFrontmatter(entryFile, { origin: source, checksum });
    }

    // 5. Registry upsert (idempotent).
    upsertEntry(
      {
        manifest,
        origin: source,
        originType: type,
        checksum,
        manifestOrigin: manifestResult.origin as 'gv-plugin.json' | 'SKILL.md',
      },
      { root },
    );

    return {
      ok: true,
      message: `skill '${manifest.name}' v${manifest.version} installed -> skills/${manifest.name}`,
      installedPath: dest,
      name: manifest.name,
      version: manifest.version,
    };
  } catch (e) {
    return { ok: false, message: `install failed: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

/** Remove an installed plugin: skills/<name>/ directory + registry entry. */
export function removeSkill(name: string, opts: InstallOptions = {}): { ok: boolean; message: string } {
  const root = opts.root ?? process.cwd();
  const entry = getEntry(name, { root });
  const dest = join(root, 'skills', name);
  if (!entry && !existsSync(dest)) {
    return { ok: false, message: `skill plugin '${name}' is not installed` };
  }
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  removeEntry(name, { root });
  return { ok: true, message: `skill '${name}' removed (directory + registry entry)` };
}
