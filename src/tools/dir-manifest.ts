#!/usr/bin/env node

/**
 * dir-manifest.ts — Recursive directory manifest generator.
 *
 * Produces a stable JSON inventory of every file under a directory tree,
 * preserving the historical { created_at, files } schema used by
 * GENTLE_VANGUARD_MASTER/00-FILE_MANIFEST_FINAL.json.
 *
 * Usage:
 *   npx tsx src/tools/dir-manifest.ts <directory> [--out <file>] [--stdout]
 *
 * Default output file: <directory>/00-FILE_MANIFEST_FINAL.json
 */

import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

interface ManifestFile {
  path: string;
  bytes: number;
}
interface Manifest {
  created_at: string;
  generated_by?: string;
  total_files?: number;
  total_bytes?: number;
  files: ManifestFile[];
}

function parseArgs(): { dir: string; out: string | null; stdout: boolean } {
  const raw = process.argv.slice(2);
  const dirArg = raw.find((a) => !a.startsWith('--'));
  if (!dirArg) {
    console.error('Usage: npx tsx src/tools/dir-manifest.ts <directory> [--out <file>] [--stdout]');
    process.exit(2);
  }
  const outIdx = raw.indexOf('--out');
  return {
    dir: resolve(dirArg),
    out: outIdx !== -1 && raw[outIdx + 1] ? resolve(raw[outIdx + 1]) : null,
    stdout: raw.includes('--stdout'),
  };
}

/** Depth-first walk; deterministic order (directories sorted, then files sorted). */
export function walkFiles(root: string, dir: string = root): string[] {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(root, full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

export function buildManifest(root: string): Manifest {
  const files: ManifestFile[] = walkFiles(root).map((full) => ({
    path: relative(root, full).split(sep).join('/'),
    bytes: statSync(full).size,
  }));
  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  return {
    created_at: new Date().toISOString(),
    generated_by: 'gentle-vanguard src/tools/dir-manifest.ts',
    total_files: files.length,
    total_bytes: totalBytes,
    files,
  };
}

function main(): void {
  const { dir, out, stdout } = parseArgs();
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`Not a directory: ${dir}`);
    process.exit(2);
  }
  const manifest = buildManifest(dir);
  const json = JSON.stringify(manifest, null, 2) + '\n';
  const target = out ?? join(dir, '00-FILE_MANIFEST_FINAL.json');
  writeFileSync(target, json, 'utf8');
  if (stdout) console.log(json);
  console.log(
    `[dir-manifest] ${manifest.total_files} files (${(manifest.total_bytes! / 1024 / 1024).toFixed(1)} MB) -> ${target}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
