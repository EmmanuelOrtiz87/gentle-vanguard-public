#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  statSync,
} from 'fs';
import { dirname, join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { createHash } from 'crypto';

export interface CheckpointManifestFile {
  path: string;
  size: number;
  sha256: string;
}

export interface CheckpointManifest {
  checkpointId: string;
  createdAt: string;
  label?: string;
  files: CheckpointManifestFile[];
  totalSize: number;
  totalSizeFormatted: string;
  count: number;
  sessionId?: string;
}

export interface CheckpointSummary {
  id: string;
  createdAt: string;
  label?: string;
  count: number;
  size: string;
}

export interface VerificationResult {
  checkpointId: string;
  status: 'INTACT' | 'CORRUPTED' | 'PARTIAL';
  valid: number;
  invalid: number;
  missing: number;
}

function normalizeRoot(root: string): string {
  return resolve(root);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function computeFileHash(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

function getSessionRoot(root: string): string {
  return join(root, '.session');
}

function getCheckpointDir(root: string): string {
  return join(getSessionRoot(root), 'checkpoints');
}

function getManifestDir(root: string): string {
  return join(getSessionRoot(root), 'manifests');
}

function getManifestPath(root: string, checkpointId: string): string {
  return join(getManifestDir(root), `${checkpointId}.json`);
}

const EXCLUDED_DIRS = new Set(['checkpoints', 'manifests', 'snapshots', 'traces', 'tracing']);

function collectSessionFiles(dirPath: string, maxDepth: number = 6): string[] {
  const files: string[] = [];
  if (maxDepth <= 0) return files;
  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      files.push(...collectSessionFiles(join(dirPath, entry.name), maxDepth - 1));
    } else if (entry.isFile()) {
      files.push(join(dirPath, entry.name));
    }
  }
  return files;
}

export function pruneCheckpoints(rootInput: string, keepCount: number = 3): string[] {
  const root = normalizeRoot(rootInput);
  const checkpointDir = getCheckpointDir(root);
  if (!existsSync(checkpointDir)) return [];

  const checkpoints = readdirSync(checkpointDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .sort((a, b) => b.name.localeCompare(a.name));

  const pruned: string[] = [];
  for (let i = keepCount; i < checkpoints.length; i++) {
    const dir = join(checkpointDir, checkpoints[i].name);
    const manifest = join(getManifestDir(root), `${checkpoints[i].name}.json`);
    try {
      rmSync(dir, { recursive: true, force: true });
      if (existsSync(manifest)) rmSync(manifest, { force: true });
      pruned.push(checkpoints[i].name);
    } catch {
      console.warn(`[CHECKPOINT] Failed to prune ${checkpoints[i].name}`);
    }
  }
  return pruned;
}

export function createCheckpoint(
  rootInput: string,
  options: { checkpointId?: string; label?: string } = {},
): CheckpointManifest {
  const root = normalizeRoot(rootInput);
  const sessionDir = getSessionRoot(root);
  const checkpointDir = getCheckpointDir(root);
  const manifestDir = getManifestDir(root);
  const checkpointId =
    options.checkpointId ??
    `ckpt-${new Date()
      .toISOString()
      .replace(/[^0-9]/g, '')
      .slice(0, 14)}`;
  const targetDir = join(checkpointDir, checkpointId);

  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true });
  }

  ensureDir(targetDir);
  ensureDir(manifestDir);

  const files: CheckpointManifestFile[] = [];
  let totalSize = 0;

  const items = collectSessionFiles(sessionDir);

  for (const itemPath of items) {
    const relativePath = itemPath.slice(sessionDir.length + 1);
    const destPath = join(targetDir, relativePath);
    ensureDir(dirname(destPath));
    writeFileSync(destPath, readFileSync(itemPath));
    const size = statSync(itemPath).size;
    totalSize += size;
    files.push({ path: relativePath, size, sha256: computeFileHash(itemPath) });
  }

  const manifest: CheckpointManifest = {
    checkpointId,
    createdAt: new Date().toISOString(),
    label: options.label,
    files,
    totalSize,
    totalSizeFormatted: formatBytes(totalSize),
    count: files.length,
    sessionId: process.env.SESSION_ID,
  };

  writeFileSync(getManifestPath(root, checkpointId), JSON.stringify(manifest, null, 2), 'utf8');

  const pruned = pruneCheckpoints(root, 3);
  if (pruned.length > 0) {
    console.warn(`[CHECKPOINT] Pruned ${pruned.length} old checkpoint(s): ${pruned.join(', ')}`);
  }

  return manifest;
}

export function listCheckpoints(rootInput: string): CheckpointSummary[] {
  const root = normalizeRoot(rootInput);
  const checkpointDir = getCheckpointDir(root);
  if (!existsSync(checkpointDir)) return [];

  return readdirSync(checkpointDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a))
    .map((checkpointId) => {
      const manifestPath = getManifestPath(root, checkpointId);
      let manifest: CheckpointManifest | null = null;
      if (existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as CheckpointManifest;
        } catch {
          console.warn(`[CHECKPOINT] Skipping corrupt manifest: ${checkpointId}`);
        }
      }
      return {
        id: checkpointId,
        createdAt: manifest?.createdAt ?? '',
        label: manifest?.label,
        count: manifest?.count ?? 0,
        size: manifest?.totalSizeFormatted ?? 'N/A',
      };
    });
}

export function verifyCheckpoint(rootInput: string, checkpointId: string): VerificationResult {
  const root = normalizeRoot(rootInput);
  const manifestPath = getManifestPath(root, checkpointId);
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest for ${checkpointId} not found`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as CheckpointManifest;
  const sessionDir = getSessionRoot(root);
  let valid = 0;
  let invalid = 0;
  let missing = 0;

  for (const file of manifest.files) {
    const currentPath = join(sessionDir, file.path);
    if (!existsSync(currentPath)) {
      missing += 1;
      continue;
    }
    const hash = computeFileHash(currentPath);
    // eslint-disable-next-line security/detect-possible-timing-attacks -- hash comparison is not attacker-controlled timing
    if (hash === file.sha256) valid += 1;
    else invalid += 1;
  }

  let status: VerificationResult['status'] = 'INTACT';
  if (invalid > 0) status = 'CORRUPTED';
  else if (missing > 0) status = 'PARTIAL';

  return { checkpointId, status, valid, invalid, missing };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , action = 'list'] = process.argv;
  const root = normalizeRoot(process.cwd());
  if (action === 'create') {
    const manifest = createCheckpoint(root, { label: 'cli' });
    console.log(JSON.stringify(manifest));
  } else if (action === 'list') {
    console.log(JSON.stringify(listCheckpoints(root)));
  } else if (action === 'verify') {
    // Usage: checkpoint-manager.ts verify <checkpointId>
    // The shared destructuring previously consumed argv[3] as rootArg,
    // which misaligned verify's checkpointId lookup. Root always defaults
    // to cwd — the checkpoint store lives under <root>/.session.
    const checkpointId = process.argv[3] ?? '';
    console.log(JSON.stringify(verifyCheckpoint(root, checkpointId)));
  } else if (action === 'prune') {
    const keepCount = parseInt(process.argv[3] ?? '3', 10);
    console.log(JSON.stringify(pruneCheckpoints(root, keepCount)));
  }
}
