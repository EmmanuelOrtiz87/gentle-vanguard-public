#!/usr/bin/env node
/**
 * Content Operations Engine — offline-first domain service.
 *
 * This module intentionally does not call remote APIs. It validates and
 * packages content jobs so the same artifacts can be consumed by the CMS,
 * CLI or future official platform adapters.
 *
 * Design principles (see docs/operations/CONTENT-OPERATIONS-ENGINE.md):
 *  - Local-first: packaging works without network.
 *  - Human-in-the-loop: remote publication requires APPROVED gate.
 *  - Idempotent: a job is never packaged twice with different output.
 *  - Auditable: every state transition can be reconstructed.
 *  - No secrets in Git.
 */
import { basename, resolve } from 'node:path';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export type Status =
  'DRAFT' | 'VALIDATED' | 'PACKAGED' | 'REVIEW' | 'APPROVED' | 'PUBLISHED' | 'MEASURED' | 'FAILED';

export type Job = {
  id: string;
  date: string;
  timezone?: string;
  platform: string;
  campaign: string;
  theme: string;
  contentType: string;
  title?: string;
  copy: string;
  cta?: string;
  asset?: string;
  status: Status;
  approvalRequired: boolean;
  variants?: string[];
  output?: string;
};

export type PlatformCapability = {
  mode: 'adapter' | 'manual' | 'native-repo';
  media: boolean;
  approvalRequired: boolean;
};

export type PlatformRegistry = {
  version: string;
  platforms: Record<string, PlatformCapability>;
};

/** Valid state transitions. A job can only move along these edges. */
export const TRANSITIONS: Record<Status, Status[]> = {
  DRAFT: ['VALIDATED', 'FAILED'],
  VALIDATED: ['PACKAGED', 'FAILED'],
  PACKAGED: ['REVIEW', 'FAILED'],
  REVIEW: ['APPROVED', 'FAILED'],
  APPROVED: ['PUBLISHED', 'FAILED'],
  PUBLISHED: ['MEASURED'],
  MEASURED: [],
  FAILED: ['DRAFT'],
};

export function canTransition(from: Status, to: Status): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function loadPlatformRegistry(root: string): PlatformRegistry {
  const path = resolve(root, 'config/content-operations/platforms.json');
  return JSON.parse(readFileSync(path, 'utf8')) as PlatformRegistry;
}

export function validate(job: Job, registry?: PlatformRegistry): string[] {
  const errors: string[] = [];

  if (!job.id) errors.push('missing id');
  if (!job.date) errors.push('missing date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(job.date))
    errors.push(`invalid date format: ${job.date} (expected YYYY-MM-DD)`);
  if (!job.platform) errors.push('missing platform');
  if (!job.copy?.trim()) errors.push('missing copy');
  if (!job.campaign) errors.push('missing campaign');
  if (!job.theme) errors.push('missing theme');
  if (!job.contentType) errors.push('missing contentType');
  if (!job.approvalRequired) {
    errors.push('approvalRequired must be true for remote publication');
  }
  if (!job.status) errors.push('missing status');
  if (job.status && !(job.status in TRANSITIONS)) {
    errors.push(`unknown status: ${job.status}`);
  }

  if (registry) {
    if (!registry.platforms[job.platform]) {
      errors.push(
        `unknown platform: ${job.platform} (not in config/content-operations/platforms.json)`,
      );
    } else {
      const cap = registry.platforms[job.platform];
      if (cap.approvalRequired && !job.approvalRequired) {
        errors.push(`platform ${job.platform} requires approvalRequired=true`);
      }
      if (cap.media && !job.asset) {
        errors.push(`platform ${job.platform} supports media — asset is recommended`);
      }
    }
  }

  return errors;
}

export function transition(job: Job, to: Status): Job {
  if (!canTransition(job.status, to)) {
    throw new Error(`Invalid transition ${job.status} -> ${to}`);
  }
  return { ...job, status: to };
}

/**
 * Package a job into a local, offline-ready packet.
 * Idempotent: if the packet already exists with the same content hash, it is
 * not rewritten (avoids duplicate publication on retries).
 */
export function packageJob(root: string, job: Job): string {
  const out = resolve(root, '.runtime/content-operations', job.date, job.platform, job.id);
  mkdirSync(out, { recursive: true });

  const caption = `${job.copy}${job.cta ? `\n\n${job.cta}` : ''}\n`;
  const publication = {
    ...job,
    generatedAt: new Date().toISOString(),
    status: 'REVIEW' as Status,
  };

  const captionPath = resolve(out, 'caption.txt');
  const pubPath = resolve(out, 'publication.json');
  const statusPath = resolve(out, 'STATUS.txt');

  // Idempotency: if the packet exists and matches, do not rewrite.
  if (existsSync(pubPath)) {
    const existing = JSON.parse(readFileSync(pubPath, 'utf8')) as Job;
    if (
      existing.id === job.id &&
      existing.copy === job.copy &&
      existing.platform === job.platform
    ) {
      return out;
    }
  }

  writeFileSync(captionPath, caption, 'utf8');
  writeFileSync(pubPath, JSON.stringify(publication, null, 2), 'utf8');
  writeFileSync(statusPath, 'REVIEW\n', 'utf8');

  if (job.asset) {
    const source = resolve(root, job.asset);
    if (existsSync(source)) {
      copyFileSync(source, resolve(out, basename(source)));
    }
  }

  return out;
}

export function loadManifest(root: string): Job[] {
  const manifestPath = resolve(root, 'content/operations/master-manifest.json');
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as Job[];
}

export function saveManifest(root: string, jobs: Job[]): void {
  const manifestPath = resolve(root, 'content/operations/master-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(jobs, null, 2) + '\n', 'utf8');
}
