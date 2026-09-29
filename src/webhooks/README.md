# src/webhooks — Standard Webhooks 2026 (signing + verification)

Native implementation of the [Standard Webhooks](https://www.standardwebhooks.com/) signing
spec, adopted by OpenAI, Anthropic, Google, Svix, Twilio, Kong, Supabase, Mux, ngrok, Lob.
This is the stack's canonical way to sign outbound webhooks and verify inbound ones.

## What's in here

| File | Purpose |
| --- | --- |
| `standard-webhooks.ts` | Pure module: `StandardWebhooks` class (sign/verify), `generateSecret()`, structured `VerifyResult` |
| `secret-cli.ts` | CLI helper: `generate` / `validate <secret>` / `pair` (sender+receiver wiring) |

## Spec compliance

- Wire format: `<id>.<timestamp>.<body>` (raw bytes — no JSON re-serialize) → HMAC-SHA256 → base64
- Header names (both supported): `webhook-{id,timestamp,signature}` (spec) **or** `svix-{id,timestamp,signature}` (legacy alias)
- Signature header value: `v1,<base64>` (space-delimited for rotation; any v1 sig match is sufficient)
- Replay protection: `|now - timestamp| <= toleranceSeconds` (default 300s = 5min)
- Constant-time compare via `crypto.timingSafeEqual`
- Secret format: `whsec_<base64>` (generate via `secret-cli.ts generate`)

## Use cases in the stack

1. **`mp-bridge` worker → academy-crm** (`POST /api/webhooks/mp-sale`): close the security gap
   where the worker was POSTing unauthenticated sale notifications.
2. **Any future outbound webhook** (content-cms, prompt-studio, etc.) that needs receiver
   verification — same code, same `WEBHOOK_SIGNING_SECRET` env var pattern.

## Quick start

```bash
# 1. Generate a fresh secret
npx tsx src/webhooks/secret-cli.ts generate
# → whsec_<base64>

# 2. Or generate + see the matching env wiring for mp-bridge ⇄ CRM
npx tsx src/webhooks/secret-cli.ts pair

# 3. Validate a secret (exit 0 if valid)
npx tsx src/webhooks/secret-cli.ts validate whsec_AAAA...
```

## Sender (mp-bridge)

```ts
import { StandardWebhooks } from '../webhooks/standard-webhooks.js';

const sw = new StandardWebhooks(env.WEBHOOK_SIGNING_SECRET);
const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const ts = Math.floor(Date.now() / 1000);
const body = JSON.stringify(payload); // signed EXACT body bytes
const sig = sw.sign(id, ts, body);

await fetch(env.CRM_WEBHOOK_URL, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'webhook-id': id,
    'webhook-timestamp': ts.toString(),
    'webhook-signature': sig,
  },
  body,
});
```

Env var: `WEBHOOK_SIGNING_SECRET` on the worker side.

## Receiver (academy-crm or any consumer)

```ts
import { StandardWebhooks } from '.../webhooks/standard-webhooks.js';

// MUST preserve raw body bytes — JSON.parse loses ordering / whitespace
const rawBody = await readRawBody(req);
const headers = {
  id: req.headers['webhook-id'],
  timestamp: req.headers['webhook-timestamp'],
  signature: req.headers['webhook-signature'],
};

const sw = new StandardWebhooks(env.CRM_WEBHOOK_SECRET);
const result = sw.verify(headers, rawBody);
if (!result.ok) return res.status(401).json({ error: result.reason });
```

Env var: `CRM_WEBHOOK_SECRET` on the receiver side (same value as the sender).

## Rotation (zero-downtime)

1. Generate a new secret (`secret-cli.ts generate`).
2. Set the **new** value on the receiver FIRST (receiver should accept BOTH old + new during
   rotation window).
3. Update sender to sign with the new secret. The Standard Webhooks `signMulti()` method
   produces a header with both old + new signatures (any v1 match counts).
4. Remove the old value everywhere.

## Tests

```bash
node --import tsx --test tests/unit/webhooks/standard-webhooks.test.ts
# 13 tests: roundtrip, prefix aliases (svix/webhook), tampered body, replay,
# tolerance, rotation multi-sig, structured errors, malformed secrets,
# raw bytes, constant-time compare
```

Integration test: `apps/academy-crm/server/webhook.test.ts` (4 tests: missing sig,
bad sig, valid signed roundtrip, idempotency by externalReference).

## Why this matters

The mp-bridge worker had `notifySale()` POSTing to `CRM_WEBHOOK_URL` with **no signature** —
anyone who knew (or guessed) the URL could inject fake sales. Standard Webhooks closes that
gap with HMAC-SHA256 + replay protection, using the same wire format already adopted by 10+
major SaaS providers (so future integrations get it for free).