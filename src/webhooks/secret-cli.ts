#!/usr/bin/env node
/**
 * src/webhooks/secret-cli.ts — CLI helper: generate / validate webhook secrets.
 *
 * Usage:
 *   npx tsx src/webhooks/secret-cli.ts generate          # → whsec_<base64>
 *   npx tsx src/webhooks/secret-cli.ts validate <secret> # exit 0 valid / 1 invalid
 *   npx tsx src/webhooks/secret-cli.ts pair              # generate + show env wiring
 *
 * Pure CLI (no I/O outside stdout/stderr). Idempotent.
 */

import {
  generateSecret,
  StandardWebhooks,
} from './standard-webhooks.js';

const args = process.argv.slice(2);
const cmd = args[0];

function printHelp(): void {
  console.log(`src/webhooks/secret-cli.ts — Standard Webhooks secret tooling

Usage:
  generate        Generate a new endpoint secret (whsec_<base64>, 32 bytes by default)
  validate <s>    Validate secret format (whsec_ prefix + non-empty base64)
  pair            Generate a secret AND show the matching env-var wiring
                  for mp-bridge (sender) and academy-crm (receiver)
  --help | -h     Show this help

Examples:
  npx tsx src/webhooks/secret-cli.ts generate
  npx tsx src/webhooks/secret-cli.ts validate whsec_AAAA...
  npx tsx src/webhooks/secret-cli.ts pair`);
}

switch (cmd) {
  case '--help':
  case '-h':
  case 'help':
    printHelp();
    break;

  case 'generate': {
    const secret = generateSecret();
    console.log(secret);
    break;
  }

  case 'validate': {
    const secret = args[1];
    if (!secret) {
      console.error('error: validate requires a secret argument');
      process.exit(2);
    }
    const ok = StandardWebhooks.isValidSecret(secret);
    if (!ok) {
      console.error(`invalid: secret must start with "whsec_" and decode to non-empty base64`);
      process.exit(1);
    }
    console.log('valid');
    break;
  }

  case 'pair': {
    const secret = generateSecret();
    console.log(`# Webhook signing secret (rotate independently from MP_* / CRM_*)`);
    console.log(`# Sender (mp-bridge worker) signs outbound /api/crm/mp-sale with this:`);
    console.log(`WEBHOOK_SIGNING_SECRET=${secret}`);
    console.log(``);
    console.log(`# Receiver (academy-crm) verifies incoming POST /api/webhooks/mp-sale:`);
    console.log(`CRM_WEBHOOK_SECRET=${secret}`);
    console.log(``);
    console.log(`# Same value on both sides. To rotate, generate a new secret, set the`);
    console.log(`# new value on the receiver FIRST (verify accepts any v1 sig in a`);
    console.log(`# multi-sig header), then update the sender, then remove the old value.`);
    break;
  }

  default:
    printHelp();
    process.exit(cmd ? 2 : 0);
    break;
}