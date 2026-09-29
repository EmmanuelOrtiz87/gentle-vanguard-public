#!/usr/bin/env node
/**
 * Standard Webhooks — signing/verification per the 2026 spec.
 *
 * Spec adopted by OpenAI, Anthropic, Google, Svix, Twilio, Kong, Supabase,
 * Mux, ngrok, Lob (https://www.standardwebhooks.com/).
 *
 * Wire format:
 *   - Signing key: base64-decoded portion of secret after `whsec_` prefix.
 *   - Signed string: `<id>.{timestamp}.{body>` (raw bytes, no JSON re-serialize).
 *   - Signature: base64(HMAC-SHA256), prefixed with `v1,`; space-delimited for rotation.
 *   - Headers accepted (aliases, both sets valid):
 *       webhook-id        svix-id
 *       webhook-timestamp svix-timestamp
 *       webhook-signature svix-signature
 *   - Replay protection: |now - timestamp| <= toleranceSeconds (default 300 = 5 min).
 *   - Verification: constant-time compare (timingSafeEqual).
 *   - Multiple signatures: ANY v1,<sig> match is sufficient (supports rotation).
 *
 * Usage:
 *   const sw = new StandardWebhooks(secret);
 *   const sig = sw.sign(msgId, Date.now(), rawBody);   // outbound
 *   const ok  = sw.verify(headers, rawBody);          // inbound (with default 5min)
 *
 * Pure module — no I/O, no Node-only deps beyond crypto. Easy to unit-test.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SIG_PREFIX = 'v1,';
const SECRET_PREFIX = 'whsec_';
const DEFAULT_TOLERANCE_SECONDS = 300; // 5 minutes — spec default

export interface WebhookHeaders {
  id?: string;
  timestamp?: string;
  signature?: string;
  /** Optional explicit overrides if you want to bypass alias fallback */
  'webhook-id'?: string;
  'webhook-timestamp'?: string;
  'webhook-signature'?: string;
  'svix-id'?: string;
  'svix-timestamp'?: string;
  'svix-signature'?: string;
}

export interface VerifyOptions {
  /** seconds; defaults to 300 (5 min per spec) */
  toleranceSeconds?: number;
  /** override `now` for tests */
  now?: number;
}

export interface VerifyResult {
  ok: boolean;
  reason?:
    | 'missing-id'
    | 'missing-timestamp'
    | 'missing-signature'
    | 'bad-timestamp'
    | 'expired'
    | 'bad-signature'
    | 'no-v1-signature'
    | 'secret-malformed';
}

/**
 * Generate a new endpoint secret in the Standard Webhooks wire format:
 * `whsec_<random-base64>`. Use this for new outbound endpoints so consumers
 * can verify with the same spec.
 */
export function generateSecret(byteLength = 32): string {
  // base64-encode N random bytes; spec recommends 32 bytes minimum.
  return SECRET_PREFIX + randomBytes(byteLength).toString('base64');
}

export class StandardWebhooks {
  private readonly key: Buffer;
  private readonly secret: string;

  constructor(secret: string) {
    this.secret = secret;
    if (!secret.startsWith(SECRET_PREFIX)) {
      throw new Error(
        `secret must start with "${SECRET_PREFIX}"; got ${secret.slice(0, 8)}...`,
      );
    }
    const b64 = secret.slice(SECRET_PREFIX.length);
    this.key = Buffer.from(b64, 'base64');
    if (this.key.length === 0) {
      throw new Error('secret base64 portion is empty after whsec_ prefix');
    }
  }

  /** Produce the signature header value (`v1,<sig> [v1,<sig2> ...]`). */
  sign(id: string, timestampSeconds: number, body: string | Buffer): string {
    if (!id) throw new Error('sign: id required');
    const ts = String(Math.floor(timestampSeconds));
    const data = `${id}.${ts}.${toBuffer(body).toString('utf8')}`;
    const sig = createHmac('sha256', this.key).update(data, 'utf8').digest('base64');
    return SIG_PREFIX + sig;
  }

  /** Sign with multiple secrets (e.g., old + new during rotation). */
  signMulti(
    secrets: StandardWebhooks[],
    id: string,
    timestampSeconds: number,
    body: string | Buffer,
  ): string {
    return secrets.map((s) => s.sign(id, timestampSeconds, body)).join(' ');
  }

  /** Verify an incoming webhook. Returns structured result (don't throw on bad sig). */
  verify(
    headers: WebhookHeaders,
    body: string | Buffer,
    options: VerifyOptions = {},
  ): VerifyResult {
    const id = headers.id ?? headers['webhook-id'] ?? headers['svix-id'];
    const tsRaw =
      headers.timestamp ?? headers['webhook-timestamp'] ?? headers['svix-timestamp'];
    const sigRaw =
      headers.signature ?? headers['webhook-signature'] ?? headers['svix-signature'];

    if (!id) return { ok: false, reason: 'missing-id' };
    if (!tsRaw) return { ok: false, reason: 'missing-timestamp' };
    if (!sigRaw) return { ok: false, reason: 'missing-signature' };

    const ts = Number(tsRaw);
    if (!Number.isFinite(ts) || ts <= 0) return { ok: false, reason: 'bad-timestamp' };

    const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
    const now = (options.now ?? Math.floor(Date.now() / 1000)) * 1000;
    const tsMs = ts * 1000;
    if (Math.abs(now - tsMs) > tolerance * 1000) {
      return { ok: false, reason: 'expired' };
    }

    const expected = this.expectedSignatures(id, ts, body);
    if (expected.length === 0) return { ok: false, reason: 'bad-signature' };

    const provided = sigRaw
      .split(' ')
      .map((s) => s.trim())
      .filter((s) => s.startsWith(SIG_PREFIX))
      .map((s) => s.slice(SIG_PREFIX.length));

    if (provided.length === 0) return { ok: false, reason: 'no-v1-signature' };

    const expectedBuf = Buffer.from(expected[0], 'base64');
    for (const p of provided) {
      const providedBuf = Buffer.from(p, 'base64');
      if (
        providedBuf.length === expectedBuf.length &&
        timingSafeEqual(providedBuf, expectedBuf)
      ) {
        return { ok: true };
      }
    }
    return { ok: false, reason: 'bad-signature' };
  }

  /** Returns the canonical v1 signature(s) for the (id, ts, body) tuple. */
  private expectedSignatures(
    id: string,
    ts: number,
    body: string | Buffer,
  ): string[] {
    const data = `${id}.${ts}.${toBuffer(body).toString('utf8')}`;
    return [createHmac('sha256', this.key).update(data, 'utf8').digest('base64')];
  }

  /** Expose secret prefix check (e.g., for endpoint validation before persistence). */
  static isValidSecret(secret: string): boolean {
    return (
      secret.startsWith(SECRET_PREFIX) &&
      Buffer.from(secret.slice(SECRET_PREFIX.length), 'base64').length > 0
    );
  }
}

function toBuffer(b: string | Buffer): Buffer {
  return Buffer.isBuffer(b) ? b : Buffer.from(b, 'utf8');
}