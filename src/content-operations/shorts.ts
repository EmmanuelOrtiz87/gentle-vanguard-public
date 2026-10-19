/** Bridge between gv-shorts-core generation requests and ContentOS jobs. */
import { createHash } from 'node:crypto';
import type { ShortRequest } from '../../packages/shared/src/short-request.js';
import type { Job } from './engine.js';

export type ShortJobDraftInput = {
  id: string;
  date: string;
  request: ShortRequest;
  campaign: string;
  theme: string;
  contentType?: string;
  asset?: string;
};

export type ShortQueueIntent = {
  eventId: string;
  request: ShortRequest;
};

/** Build a stable queue intent so retries cannot create duplicate short jobs. */
export function buildShortQueueIntent(input: Pick<ShortJobDraftInput, 'id' | 'request'>): ShortQueueIntent {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ id: input.id, request: input.request }))
    .digest('hex')
    .slice(0, 24);
  return { eventId: `short-${fingerprint}`, request: input.request };
}

/** Convert a generation request into the auditable DRAFT state used by ContentOS. */
export function createJobFromShortRequest(input: ShortJobDraftInput): Job {
  return {
    id: input.id,
    date: input.date,
    platform: input.request.platform,
    campaign: input.campaign,
    theme: input.theme,
    contentType: input.contentType ?? 'short-video',
    copy: input.request.brief,
    ...(input.asset ? { asset: input.asset } : {}),
    status: 'DRAFT',
    approvalRequired: true,
  };
}
