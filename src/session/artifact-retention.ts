import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  lstatSync,
  writeFileSync,
} from 'fs';
import { join, relative, resolve, sep } from 'path';
import { pathToFileURL } from 'url';
import { z } from 'zod';
import { db } from '../database/db.js';
import { sessionSummary } from '../knowledge/engram-session-bridge.js';

export const RETENTION_DAYS = 30;
export const RETENTION_ALLOWLIST = [
  '.runtime',
  '.session',
  '.telemetry',
  'reports',
  '.backups',
] as const;
export const RETENTION_DENYLIST = [
  '.archive',
  'protected',
  '.session/snapshots',
  '.session/checkpoints',
  '.session/snapshots',
  '.runtime/backups',
  '.runtime/retention-audit',
  'vault',
] as const;

const ManifestEntry = z.object({
  path: z.string().min(1),
  owner: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  temporary: z.literal(true),
  generated: z.boolean().optional(),
  required: z.boolean().optional(),
});

const RetentionManifest = z
  .object({
    version: z.string().min(1),
    owner: z.string().min(1),
    entries: z.array(ManifestEntry),
  })
  .superRefine((manifest, context) => {
    manifest.entries.forEach((entry, index) => {
      if (entry.owner !== manifest.owner) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entries', index, 'owner'],
          message: 'owner mismatch',
        });
      }
    });
  });

export type RetentionManifest = z.infer<typeof RetentionManifest>;
export type RetentionCandidate = {
  path: string;
  owner: string;
  createdAt: string;
  reason: 'expired' | 'protected' | 'untrusted' | 'missing';
};

export type RetentionReport = {
  mode: 'dry-run' | 'apply';
  generatedAt: string;
  cutoff: string;
  manifests: string[];
  candidates: RetentionCandidate[];
  deleted: string[];
  skipped: RetentionCandidate[];
  auditPath?: string;
};

export function isAuthorizedAutomatedClose(reason: string): boolean {
  return (
    process.env.GV_RETENTION_APPLY_AUTHORIZED === '1' &&
    ['session-end', 'day-end-closure'].includes(reason)
  );
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isDenied(path: string): boolean {
  const normalized = normalizePath(path);
  return RETENTION_DENYLIST.some(
    (entry) => normalized === entry || normalized.startsWith(`${entry}/`),
  );
}

function isAllowed(path: string): boolean {
  const normalized = normalizePath(path);
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) return false;
  return RETENTION_ALLOWLIST.some(
    (entry) => normalized === entry || normalized.startsWith(`${entry}/`),
  );
}

function manifestPaths(root: string): string[] {
  return RETENTION_ALLOWLIST.map((directory) =>
    join(root, directory, 'retention-manifest.json'),
  ).filter((path) => existsSync(path));
}

function readManifest(path: string): RetentionManifest | null {
  try {
    return RetentionManifest.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return null;
  }
}

function collectFiles(root: string, path: string): string[] {
  const absolute = resolve(root, path);
  if (!absolute.startsWith(`${resolve(root)}${sep}`) || !existsSync(absolute)) return [];
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) return [];
  if (stat.isFile()) return [absolute];
  if (!stat.isDirectory()) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = join(absolute, entry.name);
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? collectFiles(root, relative(root, child)) : [child];
  });
}

function candidateFor(entry: z.infer<typeof ManifestEntry>, cutoffMs: number): RetentionCandidate {
  const path = normalizePath(entry.path);
  const date = new Date(entry.createdAt).getTime();
  const generatedReport = path === 'reports' || path.startsWith('reports/');
  const reason =
    entry.required || isDenied(path)
      ? 'protected'
      : !isAllowed(path) || (generatedReport && entry.generated !== true)
        ? 'untrusted'
        : date < cutoffMs
          ? 'expired'
          : 'missing';
  return { path, owner: entry.owner, createdAt: entry.createdAt, reason };
}

export function runArtifactRetention(
  options: {
    workspaceRoot?: string;
    now?: Date;
    apply?: boolean;
    authorizedAutomatedClose?: boolean;
    persistAudit?: boolean;
  } = {},
): RetentionReport {
  const root = resolve(options.workspaceRoot ?? process.cwd());
  const now = options.now ?? new Date();
  const cutoffMs = now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const manifests = manifestPaths(root);
  const entries = manifests.flatMap((path) => readManifest(path)?.entries ?? []);
  const candidates: RetentionCandidate[] = [];
  const skipped: RetentionCandidate[] = [];
  const deleted: string[] = [];

  for (const entry of entries) {
    const candidate = candidateFor(entry, cutoffMs);
    const absolute = resolve(root, candidate.path);
    if (candidate.reason !== 'expired' || !existsSync(absolute)) {
      skipped.push({
        ...candidate,
        reason: candidate.reason === 'expired' ? 'missing' : candidate.reason,
      });
      continue;
    }
    candidates.push(candidate);
    if (options.apply === true && options.authorizedAutomatedClose === true) {
      for (const file of collectFiles(root, candidate.path)) rmSync(file, { force: true });
      if (existsSync(absolute) && lstatSync(absolute).isDirectory())
        rmSync(absolute, { recursive: true, force: true });
      deleted.push(candidate.path);
    }
  }

  const mode =
    options.apply === true && options.authorizedAutomatedClose === true ? 'apply' : 'dry-run';
  const report: RetentionReport = {
    mode,
    generatedAt: now.toISOString(),
    cutoff: new Date(cutoffMs).toISOString(),
    manifests,
    candidates,
    deleted,
    skipped,
  };
  const auditDir = join(root, '.runtime', 'retention-audit');
  mkdirSync(auditDir, { recursive: true });
  const auditPath = join(auditDir, `retention-${now.toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(auditPath, JSON.stringify(report, null, 2), 'utf8');
  report.auditPath = auditPath;
  if (options.persistAudit !== false) {
    try {
      db().events.insertEvent('gentle-vanguard', 'artifact.retention', report);
    } catch {
      void 0;
    }
    sessionSummary(
      {
        goal: 'Artifact retention audit',
        discoveries: [
          `Retention ${mode}: ${candidates.length} expired candidate(s), ${deleted.length} deleted`,
        ],
        accomplished: [`Manifest audit written to ${normalizePath(relative(root, auditPath))}`],
        nextSteps: ['Review skipped artifacts before changing manifests'],
      },
      `retention-${now.toISOString()}`,
    );
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = runArtifactRetention();
  console.log(
    JSON.stringify(
      {
        mode: report.mode,
        candidates: report.candidates.length,
        deleted: report.deleted.length,
        auditPath: report.auditPath,
      },
      null,
      2,
    ),
  );
}
