#!/usr/bin/env node
/**
 * Unit Tests: SLSA Provenance Signer (DSSE + Ed25519)
 * Verifies key generation, sign/verify round-trip, tamper detection, and keyid logic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  generateKeyPair,
  loadPrivateKey,
  loadPublicKey,
  keyId,
  buildEnvelope,
  signStatement,
  verifyEnvelope,
  parseSignerArgs,
  DSSE_PAYLOAD_TYPE,
} from '../../src/slsa-signer.ts';

function makeStatement(): Record<string, unknown> {
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: 'test.json', digest: { sha256: 'a'.repeat(64) } }],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: { buildDefinition: { buildType: 'test@v1' }, runDetails: { builder: { id: 'test' } } },
  };
}

describe('generateKeyPair', () => {
  it('creates private and public PEM files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gv-signer-keys-'));
    try {
      const { privateKey, publicKey } = generateKeyPair(dir);
      assert.ok(existsSync(privateKey));
      assert.ok(existsSync(publicKey));
      const priv = readFileSync(privateKey, 'utf-8');
      const pub = readFileSync(publicKey, 'utf-8');
      assert.match(priv, /BEGIN PRIVATE KEY/);
      assert.match(pub, /BEGIN PUBLIC KEY/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('keyId', () => {
  it('is stable for the same public key and 64 hex chars', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gv-signer-kid-'));
    try {
      const { publicKey } = generateKeyPair(dir);
      const pub = loadPublicKey(publicKey);
      const id1 = keyId(pub);
      const id2 = keyId(pub);
      assert.strictEqual(id1, id2);
      assert.match(id1, /^[0-9a-f]{64}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('signStatement + verifyEnvelope', () => {
  it('round-trips: sign then verify with the matching public key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gv-signer-rt-'));
    try {
      const { privateKey, publicKey } = generateKeyPair(dir);
      const stmtFile = join(dir, 'statement.json');
      const signedFile = join(dir, 'signed.json');
      writeFileSync(stmtFile, JSON.stringify(makeStatement()), 'utf-8');

      const envelope = signStatement(stmtFile, privateKey, signedFile);
      assert.strictEqual(envelope.payloadType, DSSE_PAYLOAD_TYPE);
      assert.strictEqual(envelope.signatures.length, 1);
      assert.ok(envelope.signatures[0].sig.length > 0);

      const { valid, statement, errors } = verifyEnvelope(envelope, publicKey);
      assert.strictEqual(valid, true, errors.join('; '));
      assert.deepStrictEqual(statement, makeStatement());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails verification when the payload is tampered', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gv-signer-tamper-'));
    try {
      const { privateKey, publicKey } = generateKeyPair(dir);
      const stmtFile = join(dir, 'statement.json');
      const signedFile = join(dir, 'signed.json');
      writeFileSync(stmtFile, JSON.stringify(makeStatement()), 'utf-8');
      const envelope = signStatement(stmtFile, privateKey, signedFile);

      // Tamper: modify the payload (re-encode a different statement)
      const tampered = { ...makeStatement(), subject: [{ name: 'evil.json' }] };
      envelope.payload = Buffer.from(JSON.stringify(tampered)).toString('base64');

      const { valid, errors } = verifyEnvelope(envelope, publicKey);
      assert.strictEqual(valid, false);
      assert.ok(errors.some((e) => e.includes('verification failed')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails verification with a different (wrong) public key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gv-signer-wrongkey-'));
    try {
      const { privateKey } = generateKeyPair(dir);
      const { publicKey: wrongKey } = generateKeyPair(join(dir, 'other'));
      const stmtFile = join(dir, 'statement.json');
      const signedFile = join(dir, 'signed.json');
      writeFileSync(stmtFile, JSON.stringify(makeStatement()), 'utf-8');
      const envelope = signStatement(stmtFile, privateKey, signedFile);

      const { valid, errors } = verifyEnvelope(envelope, wrongKey);
      assert.strictEqual(valid, false);
      assert.ok(errors.some((e) => e.includes('keyid mismatch') || e.includes('verification failed')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects malformed envelopes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gv-signer-malformed-'));
    try {
      const { publicKey } = generateKeyPair(dir);
      const { valid, errors } = verifyEnvelope({} as never, publicKey);
      assert.strictEqual(valid, false);
      assert.ok(errors.some((e) => e.includes('invalid DSSE envelope')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildEnvelope', () => {
  it('produces an unsigned envelope with correct keyid', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gv-signer-env-'));
    try {
      const { publicKey } = generateKeyPair(dir);
      const pub = loadPublicKey(publicKey);
      const env = buildEnvelope(makeStatement(), pub);
      assert.strictEqual(env.payloadType, DSSE_PAYLOAD_TYPE);
      assert.strictEqual(env.signatures[0].keyid, keyId(pub));
      assert.strictEqual(env.signatures[0].sig, '');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('parseSignerArgs', () => {
  it('defaults to sign action with sane defaults', () => {
    const cli = parseSignerArgs([]);
    assert.strictEqual(cli.action, 'sign');
    assert.ok(cli.statementFile.length > 0);
    assert.ok(cli.keyFile.length > 0);
  });

  it('parses genkey action with out dir', () => {
    const cli = parseSignerArgs(['genkey', '--out', 'provenance/keys']);
    assert.strictEqual(cli.action, 'genkey');
    assert.strictEqual(cli.outDir, 'provenance/keys');
  });

  it('parses verify action with file and public key', () => {
    const cli = parseSignerArgs(['verify', '-f', 'x.signed.json', '-p', 'pub.pem']);
    assert.strictEqual(cli.action, 'verify');
    assert.strictEqual(cli.statementFile, 'x.signed.json');
    assert.strictEqual(cli.publicKeyFile, 'pub.pem');
  });
});