#!/usr/bin/env node
/**
 * Publication Gates — TOCTOU (Time-Of-Check/Time-Of-Use) prevention.
 *
 * Implementa el patrón del libro para prevenir stale-approval:
 *   - Cada approval tiene un TTL (time-to-live)
 *   - Se verifica que el estado del target no haya cambiado desde la aprobación
 *   - Se requiere re-aprobación si el contenido cambió
 *   - Publicación bloqueada si el gate está expired
 *
 * Conceptos clave:
 *   - Approval: permiso para publicar/mergear con timestamp + hash del estado
 *   - Gate: punto de control que valida si un approval sigue siendo válido
 *   - TOCTOU check: compara hash actual con hash al momento de aprobación
 *
 * Flags:
 *   --check <target>    Check if publication gate is open for target
 *   --approve <target>  Approve publication for target
 *   --revoke <target>   Revoke approval for target
 *   --list              List all active approvals
 *   --prune             Remove expired approvals
 *   --gc                Garbage collect stale state
 *   --quiet             Minimal output (pipeline mode)
 *   --dry-run           Preview without saving
 */

import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  statSync,
  rmSync,
} from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

// ─── Types ────────────────────────────────────────────────────────────

type GateStatus = 'open' | 'closed' | 'expired' | 'revoked' | 'stale';

interface Approval {
  id: string;
  target: string;
  targetType: 'file' | 'directory' | 'branch';
  hash: string;
  approvedAt: string;
  expiresAt: string;
  approvedBy: string;
  reason: string;
  status: GateStatus;
  metadata: Record<string, unknown>;
}

interface GateCheck {
  target: string;
  status: GateStatus;
  currentHash: string;
  approvedHash: string;
  approvedAt: string | null;
  expiresAt: string | null;
  isExpired: boolean;
  isStale: boolean;
  detail: string;
}

interface PublicationGatesConfig {
  version: string;
  outputDir: string;
  defaultTTLMinutes: number;
  maxTTLMinutes: number;
  requireHashMatch: boolean;
  pruneAfterHours: number;
}

// ─── Constants ─────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const CONFIG_PATH = join(ROOT, 'config', 'publication-gates.json');
const DEFAULT_CONFIG: PublicationGatesConfig = {
  version: '1.0.0',
  outputDir: '.session/publication-gates',
  defaultTTLMinutes: 60,
  maxTTLMinutes: 1440,
  requireHashMatch: true,
  pruneAfterHours: 72,
};

// ─── Helpers ───────────────────────────────────────────────────────────

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadConfig(): PublicationGatesConfig {
  if (!existsSync(CONFIG_PATH)) return DEFAULT_CONFIG;
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function generateId(): string {
  return `GATE-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function computeHash(target: string): string {
  const targetPath = join(ROOT, target);
  if (!existsSync(targetPath)) return 'NOT_FOUND';

  try {
    const stat = statSync(targetPath);
    const hash = createHash('sha256');

    if (stat.isFile()) {
      hash.update(readFileSync(targetPath));
    } else if (stat.isDirectory()) {
      // Hash directory structure: sorted filenames + sizes + mod times
      const entries = readdirSync(targetPath).sort();
      for (const entry of entries) {
        const entryPath = join(targetPath, entry);
        try {
          const s = statSync(entryPath);
          hash.update(`${entry}:${s.size}:${s.mtimeMs}`);
        } catch {
          /* skip */
        }
      }
    }
    return hash.digest('hex').slice(0, 16);
  } catch {
    return 'ERROR';
  }
}

function loadApprovals(config: PublicationGatesConfig): Approval[] {
  const dir = join(ROOT, config.outputDir);
  if (!existsSync(dir)) return [];
  const approvals: Approval[] = [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    try {
      approvals.push(JSON.parse(readFileSync(join(dir, file), 'utf-8')));
    } catch {
      /* skip corrupt */
    }
  }
  return approvals.sort((a, b) => b.approvedAt.localeCompare(a.approvedAt));
}

function saveApproval(config: PublicationGatesConfig, approval: Approval): void {
  const dir = join(ROOT, config.outputDir);
  ensureDir(dir);
  writeFileSync(join(dir, `${approval.id}.json`), JSON.stringify(approval, null, 2));
}

function deleteApproval(config: PublicationGatesConfig, id: string): void {
  const filePath = join(ROOT, config.outputDir, `${id}.json`);
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true });
  }
}

function log(msg: string, level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' = 'INFO', quiet: boolean) {
  if (quiet) return;
  const colors: Record<string, string> = {
    INFO: '\x1b[36m',
    WARN: '\x1b[33m',
    ERROR: '\x1b[31m',
    SUCCESS: '\x1b[32m',
  };
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log(`${colors[level] ?? ''}[${ts}] [${level}] ${msg}\x1b[0m`);
}

// ─── Core API ──────────────────────────────────────────────────────────

export function approveTarget(opts: {
  target: string;
  targetType: Approval['targetType'];
  approvedBy: string;
  reason: string;
  ttlMinutes?: number;
  metadata?: Record<string, unknown>;
  quiet?: boolean;
}): Approval {
  const config = loadConfig();
  const ttl = Math.min(opts.ttlMinutes ?? config.defaultTTLMinutes, config.maxTTLMinutes);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttl * 60000);

  const approval: Approval = {
    id: generateId(),
    target: opts.target,
    targetType: opts.targetType,
    hash: computeHash(opts.target),
    approvedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    approvedBy: opts.approvedBy,
    reason: opts.reason,
    status: 'open',
    metadata: opts.metadata ?? {},
  };

  saveApproval(config, approval);
  log(
    `Approved ${opts.target} (${approval.id}) — expires ${expiresAt.toISOString()}`,
    'SUCCESS',
    opts.quiet ?? false,
  );
  return approval;
}

export function checkGate(target: string): GateCheck {
  const config = loadConfig();
  const approvals = loadApprovals(config);
  const currentHash = computeHash(target);
  const now = new Date();

  // Find the latest open approval for this target
  const activeApprovals = approvals.filter((a) => a.target === target && a.status === 'open');

  if (activeApprovals.length === 0) {
    return {
      target,
      status: 'closed',
      currentHash,
      approvedHash: '',
      approvedAt: null,
      expiresAt: null,
      isExpired: true,
      isStale: false,
      detail: 'No active approval found for this target',
    };
  }

  const latest = activeApprovals[0];
  const isExpired = new Date(latest.expiresAt) < now;
  const isStale = config.requireHashMatch && latest.hash !== currentHash;

  let status: GateStatus;
  if (isExpired) {
    status = 'expired';
  } else if (isStale) {
    status = 'stale';
  } else {
    status = 'open';
  }

  // Update status if changed
  if (latest.status !== status) {
    latest.status = status;
    saveApproval(config, latest);
  }

  const details: string[] = [];
  if (isExpired) details.push(`Approval expired at ${latest.expiresAt}`);
  if (isStale)
    details.push(`Target content changed since approval (hash: ${latest.hash} → ${currentHash})`);
  if (!isExpired && !isStale) details.push('Gate is open — approval is valid');

  return {
    target,
    status,
    currentHash,
    approvedHash: latest.hash,
    approvedAt: latest.approvedAt,
    expiresAt: latest.expiresAt,
    isExpired,
    isStale,
    detail: details.join('. '),
  };
}

export function revokeApproval(
  target: string,
  reason: string,
  quiet = false,
): { success: boolean; approvals?: Approval[]; error?: string } {
  const config = loadConfig();
  const approvals = loadApprovals(config);
  const targetApprovals = approvals.filter((a) => a.target === target && a.status === 'open');

  if (targetApprovals.length === 0) {
    return { success: false, error: `No active approvals found for: ${target}` };
  }

  for (const a of targetApprovals) {
    a.status = 'revoked';
    a.metadata['revokedAt'] = new Date().toISOString();
    a.metadata['revokeReason'] = reason;
    saveApproval(config, a);
  }

  log(`Revoked ${targetApprovals.length} approval(s) for ${target}: ${reason}`, 'WARN', quiet);
  return { success: true, approvals: targetApprovals };
}

export function pruneExpired(quiet = false): { removed: number } {
  const config = loadConfig();
  const approvals = loadApprovals(config);
  const now = new Date();
  let removed = 0;

  for (const a of approvals) {
    const isOld =
      now.getTime() - new Date(a.approvedAt).getTime() > config.pruneAfterHours * 3600000;
    if (a.status === 'expired' || a.status === 'revoked' || (a.status !== 'open' && isOld)) {
      deleteApproval(config, a.id);
      removed++;
    }
  }

  log(`Pruned ${removed} expired/revoked approvals`, removed > 0 ? 'INFO' : 'SUCCESS', quiet);
  return { removed };
}

export function listActiveApprovals(): Approval[] {
  const config = loadConfig();
  return loadApprovals(config).filter((a) => a.status === 'open');
}

// ─── CLI Handler ───────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let action = 'list';
  let target = '';
  let quiet = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--check':
        action = 'check';
        target = args[++i] ?? '';
        break;
      case '--approve':
        action = 'approve';
        target = args[++i] ?? '';
        break;
      case '--revoke':
        action = 'revoke';
        target = args[++i] ?? '';
        break;
      case '--list':
        action = 'list';
        break;
      case '--prune':
        action = 'prune';
        break;
      case '--gc':
        action = 'gc';
        break;
      case '--quiet':
        quiet = true;
        break;
      case '--dry-run':
        dryRun = true;
        break;
    }
  }

  if (dryRun) {
    console.log(`[DRY-RUN] Would run action=${action} target=${target}`);
    process.exit(0);
  }

  switch (action) {
    case 'check': {
      if (!target) {
        console.error('Provide target with --check <target>');
        process.exit(1);
      }
      const result = checkGate(target);
      const icons: Record<string, string> = {
        open: '✅',
        closed: '🔴',
        expired: '🟡',
        stale: '🟠',
        revoked: '⛔',
      };
      console.log(`\n=== PUBLICATION GATE: ${target} ===`);
      console.log(`${icons[result.status] ?? '❓'} Status: ${result.status}`);
      console.log(`Detail: ${result.detail}`);
      console.log(
        `Hash: ${result.currentHash}${result.isStale ? ` (was ${result.approvedHash})` : ''}`,
      );
      console.log(`Expires: ${result.expiresAt ?? 'N/A'}`);
      console.log(`Approved: ${result.approvedAt ?? 'N/A'}`);
      break;
    }
    case 'approve': {
      if (!target) {
        console.error('Provide target with --approve <target>');
        process.exit(1);
      }
      const approvedBy = args.includes('--by') ? args[args.indexOf('--by') + 1] : 'cli';
      const reason = args.includes('--reason')
        ? args[args.indexOf('--reason') + 1]
        : 'CLI approval';
      const ttl = args.includes('--ttl')
        ? parseInt(args[args.indexOf('--ttl') + 1], 10)
        : undefined;
      const result = approveTarget({
        target,
        targetType: 'file',
        approvedBy,
        reason,
        ttlMinutes: ttl,
        quiet,
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'revoke': {
      if (!target) {
        console.error('Provide target with --revoke <target>');
        process.exit(1);
      }
      const reason = args.includes('--reason')
        ? args[args.indexOf('--reason') + 1]
        : 'CLI revocation';
      const result = revokeApproval(target, reason, quiet);
      if (!result.success) {
        console.error(result.error);
        process.exit(1);
      }
      console.log(JSON.stringify(result.approvals, null, 2));
      break;
    }
    case 'list': {
      const approvals = listActiveApprovals();
      if (approvals.length === 0) {
        console.log('No active approvals.');
        break;
      }
      console.log('\n=== ACTIVE APPROVALS ===');
      for (const a of approvals) {
        const expiresIn = Math.round((new Date(a.expiresAt).getTime() - Date.now()) / 60000);
        console.log(
          `${a.id} | ${a.target.slice(0, 40).padEnd(40)} | expires in ${expiresIn}min | ${a.approvedBy}`,
        );
      }
      break;
    }
    case 'prune':
    case 'gc': {
      const result = pruneExpired(quiet);
      console.log(`Removed ${result.removed} expired/revoked approvals`);
      break;
    }
  }
}
