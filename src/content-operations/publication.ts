/**
 * Provider-neutral publication planning.
 *
 * This module is deliberately dry-run only. Official platform adapters can
 * consume the returned plan later, but no network call or credential lookup
 * belongs in the Content Operations domain layer.
 */
import { validate, type Job, type OperationEnvelope, type PlatformRegistry } from './engine.js';

export type PublicationTarget = { accountId: string; accountLabel?: string };

export type PublicationPlan = {
  jobId: string;
  platform: string;
  adapter: 'tiktok-content-posting' | 'youtube-data-api' | 'generic-manual';
  dryRun: true;
  requiresApproval: true;
  target: PublicationTarget;
  asset: string;
  caption: string;
  officialApi: string;
};

const ADAPTERS: Record<string, { adapter: PublicationPlan['adapter']; officialApi: string }> = {
  tiktok: {
    adapter: 'tiktok-content-posting',
    officialApi: 'https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post',
  },
  youtube: {
    adapter: 'youtube-data-api',
    officialApi: 'https://developers.google.com/youtube/v3/docs/videos/insert',
  },
};

/** Prepare an auditable, fail-closed plan. It never publishes and never mutates the job. */
export function preparePublication(
  job: Job,
  registry: PlatformRegistry,
  target?: PublicationTarget,
): OperationEnvelope<PublicationPlan> {
  const errors = validate(job, registry);
  const adapter = ADAPTERS[job.platform] ?? {
    adapter: 'generic-manual' as const,
    officialApi: 'https://github.com/emmanuelortiz87/gentle-vanguard',
  };

  if (job.status !== 'APPROVED') errors.push('job must be APPROVED before publication planning');
  if (!target?.accountId?.trim()) errors.push('expected target accountId is required');
  if (!job.asset) errors.push('asset is required for publication planning');

  if (errors.length || !target || !job.asset) {
    return { ok: false, error: { code: 'PUBLICATION_BLOCKED', message: errors.join('; ') } };
  }

  return {
    ok: true,
    data: {
      jobId: job.id,
      platform: job.platform,
      adapter: adapter.adapter,
      dryRun: true,
      requiresApproval: true,
      target,
      asset: job.asset,
      caption: `${job.copy}${job.cta ? `\n\n${job.cta}` : ''}`,
      officialApi: adapter.officialApi,
    },
  };
}
