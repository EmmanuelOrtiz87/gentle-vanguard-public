#!/usr/bin/env node
/**
 * SLSA Provenance Signer (native TypeScript)
 *
 * Signs in-toto v1 attestation statements using the DSSE (Dead Simple Signing
 * Envelope) format with Ed25519 keys from Node's native crypto. This satisfies
 * SLSA Build L2/L3 signature requirements without external tooling
 * (cosign/slsa-verifier).
 *
 * DSSE envelope (https://github.com/secure-systems-lab/dsse):
 *   {
 *     "payload": "<base64 of statement>",
 *     "payloadType": "application/vnd.in-toto+json",
 *     "signatures": [{ "keyid": "<sha256 of public key>", "sig": "<base64>" }]
 *   }
 *
 * Usage:
 *   npx tsx src/security/slsa-signer.ts genkey --out provenance/keys
 *   npx tsx src/security/slsa-signer.ts sign -f provenance/gentle-vanguard-provenance.json
 *   npx tsx src/security/slsa-signer.ts verify -f provenance/gentle-vanguard-provenance.json
 */

import {
  createHash,
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DsseSignature {
  keyid: string;
  sig: string; // base64
}

export interface DsseEnvelope {
  payload: string; // base64 of the statement JSON
  payloadType: string;
  signatures: DsseSignature[];
}

export interface SignerOptions {
  statementFile: string;
  keyFile?: string; // private key PEM path
  output?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DSSE_PAYLOAD_TYPE = 'application/vnd.in-toto+json';
export const DEFAULT_PRIVATE_KEY = '.runtime/provenance/private-key.pem';
export const DEFAULT_PUBLIC_KEY = 'provenance/public-key.pem';
export const DEFAULT_SIGNED_OUTPUT = 'provenance/gentle-vanguard-provenance.signed.json';

// ---------------------------------------------------------------------------
// Key management
// ---------------------------------------------------------------------------

/** Generate an Ed25519 key pair and persist PEM files. Returns both paths. */
export function generateKeyPair(outDir: string): { privateKey: string; publicKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const privatePath = join(outDir, 'private-key.pem');
  const publicPath = join(outDir, 'public-key.pem');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), 'utf-8');
  writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }), 'utf-8');
  return { privateKey: privatePath, publicKey: publicPath };
}

/** Load a private key from PEM file. */
export function loadPrivateKey(filePath: string): KeyObject {
  return createPrivateKey(readFileSync(filePath, 'utf-8'));
}

/** Load a public key from PEM file. */
export function loadPublicKey(filePath: string): KeyObject {
  return createPublicKey(readFileSync(filePath, 'utf-8'));
}

/** Compute the keyid: SHA-256 of the SPKI DER encoding of the public key. */
export function keyId(publicKey: KeyObject): string {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex');
}

// ---------------------------------------------------------------------------
// DSSE envelope
// ---------------------------------------------------------------------------

/** Build a DSSE envelope from a statement object (or JSON string). */
export function buildEnvelope(statement: unknown, publicKey: KeyObject): DsseEnvelope {
  const payload = Buffer.from(JSON.stringify(statement), 'utf-8').toString('base64');
  return {
    payload,
    payloadType: DSSE_PAYLOAD_TYPE,
    signatures: [{ keyid: keyId(publicKey), sig: '' }],
  };
}

/** Sign a statement file, producing a DSSE envelope persisted to output. */
export function signStatement(
  statementFile: string,
  privateKeyFile: string,
  output: string,
): DsseEnvelope {
  const statement = JSON.parse(readFileSync(statementFile, 'utf-8'));
  const privateKey = loadPrivateKey(privateKeyFile);
  const publicKey = createPublicKey(privateKey);

  const payload = Buffer.from(JSON.stringify(statement), 'utf-8');
  const sig = cryptoSign(null, payload, privateKey);

  const envelope: DsseEnvelope = {
    payload: payload.toString('base64'),
    payloadType: DSSE_PAYLOAD_TYPE,
    signatures: [{ keyid: keyId(publicKey), sig: sig.toString('base64') }],
  };

  const outputPath = resolve(output);
  const outputDir = outputPath.slice(
    0,
    Math.max(outputPath.lastIndexOf('\\'), outputPath.lastIndexOf('/')),
  );
  if (outputDir) mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, JSON.stringify(envelope, null, 2) + '\n', 'utf-8');
  return envelope;
}

/**
 * Verify a DSSE envelope against a public key.
 * Returns { valid, statement, errors }.
 */
export function verifyEnvelope(
  envelope: DsseEnvelope,
  publicKeyFile: string,
): { valid: boolean; statement: unknown; errors: string[] } {
  const errors: string[] = [];

  if (!envelope.payload || !envelope.payloadType || !Array.isArray(envelope.signatures)) {
    return { valid: false, statement: null, errors: ['invalid DSSE envelope structure'] };
  }
  if (envelope.payloadType !== DSSE_PAYLOAD_TYPE) {
    errors.push(`payloadType must be ${DSSE_PAYLOAD_TYPE}`);
  }

  let statement: unknown = null;
  try {
    statement = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf-8'));
  } catch (err) {
    errors.push(`payload is not valid JSON: ${(err as Error).message}`);
  }

  const publicKey = loadPublicKey(publicKeyFile);
  const expectedKeyId = keyId(publicKey);
  const payload = Buffer.from(envelope.payload, 'base64');

  let anyValid = false;
  for (const sig of envelope.signatures) {
    if (sig.keyid && sig.keyid !== expectedKeyId) {
      errors.push(`signature keyid mismatch (expected ${expectedKeyId.slice(0, 12)}...)`);
      continue;
    }
    try {
      const ok = cryptoVerify(null, payload, publicKey, Buffer.from(sig.sig, 'base64'));
      if (ok) {
        anyValid = true;
      } else {
        errors.push('signature verification failed');
      }
    } catch (err) {
      errors.push(`signature error: ${(err as Error).message}`);
    }
  }

  if (!anyValid) errors.push('no valid signature found');
  return { valid: anyValid && errors.length === 0, statement, errors };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface SignerCliArgs {
  action: 'genkey' | 'sign' | 'verify';
  statementFile: string;
  keyFile: string;
  publicKeyFile: string;
  output: string;
  outDir: string;
}

export function parseSignerArgs(args: string[] = process.argv.slice(2)): SignerCliArgs {
  const action = (['genkey', 'sign', 'verify'].includes(args[0]) ? args[0] : 'sign') as
    'genkey' | 'sign' | 'verify';
  const parsed: SignerCliArgs = {
    action,
    statementFile: DEFAULT_SIGNED_OUTPUT,
    keyFile: DEFAULT_PRIVATE_KEY,
    publicKeyFile: DEFAULT_PUBLIC_KEY,
    output: DEFAULT_SIGNED_OUTPUT,
    outDir: 'provenance/keys',
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--file':
      case '-f':
        parsed.statementFile = args[++i];
        break;
      case '--key':
      case '-k':
        parsed.keyFile = args[++i];
        break;
      case '--public-key':
      case '-p':
        parsed.publicKeyFile = args[++i];
        break;
      case '--output':
      case '-o':
        parsed.output = args[++i];
        break;
      case '--out':
        parsed.outDir = args[++i];
        break;
      case '--help':
      case '-h':
        parsed.action = 'sign';
        break;
    }
  }
  return parsed;
}

export function printSignerHelp(): void {
  console.log(`
SLSA Provenance Signer (native TypeScript, DSSE + Ed25519)

Usage:
  npx tsx src/security/slsa-signer.ts genkey --out <dir>            # generate key pair
  npx tsx src/security/slsa-signer.ts sign -f <statement.json>      # sign a statement
  npx tsx src/security/slsa-signer.ts verify -f <signed.json>       # verify a signed envelope

Options:
  -f, --file <path>        Statement file (sign) or signed envelope (verify)
  -k, --key <path>         Private key PEM (default: ${DEFAULT_PRIVATE_KEY})
  -p, --public-key <path>  Public key PEM (default: ${DEFAULT_PUBLIC_KEY})
  -o, --output <path>      Signed output path (default: ${DEFAULT_SIGNED_OUTPUT})
      --out <dir>          Key output dir for genkey (default: provenance/keys)
  -h, --help               Show this help
`);
}

function runGenkey(cli: SignerCliArgs): boolean {
  const { privateKey, publicKey } = generateKeyPair(cli.outDir);
  console.log(`[OK] Ed25519 key pair generated`);
  console.log(`     private: ${privateKey}`);
  console.log(`     public:  ${publicKey}`);
  console.log(`     NOTE: keep private-key.pem secret (gitignored).`);
  return true;
}

function runSign(cli: SignerCliArgs): boolean {
  if (!existsSync(cli.statementFile)) {
    console.error(`ERROR: statement not found: ${cli.statementFile}`);
    return false;
  }
  if (!existsSync(cli.keyFile)) {
    console.error(
      `ERROR: private key not found: ${cli.keyFile}\n       Run: npx tsx src/security/slsa-signer.ts genkey --out provenance/keys`,
    );
    return false;
  }
  try {
    const envelope = signStatement(cli.statementFile, cli.keyFile, cli.output);
    console.log(`[OK] DSSE envelope signed (Ed25519)`);
    console.log(`     payloadType: ${envelope.payloadType}`);
    console.log(`     keyid:       ${envelope.signatures[0].keyid.slice(0, 16)}...`);
    console.log(`     output:      ${resolve(cli.output)}`);
    return true;
  } catch (err) {
    console.error(`ERROR: signing failed: ${(err as Error).message}`);
    return false;
  }
}

function runVerify(cli: SignerCliArgs): boolean {
  if (!existsSync(cli.statementFile)) {
    console.error(`ERROR: envelope not found: ${cli.statementFile}`);
    return false;
  }
  if (!existsSync(cli.publicKeyFile)) {
    console.error(`ERROR: public key not found: ${cli.publicKeyFile}`);
    return false;
  }
  try {
    const envelope = JSON.parse(readFileSync(cli.statementFile, 'utf-8')) as DsseEnvelope;
    const { valid, statement, errors } = verifyEnvelope(envelope, cli.publicKeyFile);
    if (!valid) {
      console.error('[FAIL] DSSE signature verification failed:');
      for (const e of errors) console.error(`  - ${e}`);
      return false;
    }
    const st = statement as { predicateType?: string; subject?: unknown[] };
    console.log(`[OK] Valid DSSE signature (Ed25519)`);
    console.log(`     payloadType: ${envelope.payloadType}`);
    console.log(`     predicateType: ${st.predicateType ?? 'unknown'}`);
    console.log(`     subject count: ${st.subject?.length ?? 0}`);
    return true;
  } catch (err) {
    console.error(`ERROR: verification failed: ${(err as Error).message}`);
    return false;
  }
}

const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  resolve(process.argv[1]).toLowerCase().endsWith('slsa-signer.ts');

if (isDirectRun) {
  const cli = parseSignerArgs();
  if (cli.action === 'genkey') {
    process.exitCode = runGenkey(cli) ? 0 : 1;
  } else if (cli.action === 'verify') {
    process.exitCode = runVerify(cli) ? 0 : 1;
  } else {
    process.exitCode = runSign(cli) ? 0 : 1;
  }
}
