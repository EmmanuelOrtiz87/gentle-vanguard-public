#!/usr/bin/env node
/**
 * Unit Tests: Secret Scanner
 * Verifies pattern detection, entropy filtering, redaction, reports,
 * file/URL scanning and CLI exit codes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import {
  PATTERNS,
  buildReport,
  getPatternCount,
  redactSecret,
  scanFiles,
  scanText,
  scanUrl,
  shannonEntropy,
} from '../../src/security/secret-scanner.ts';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

// Synthetic (non-real) credential strings for testing.
const FAKE = {
  awsKey: 'AKIAIOSFODNN7EXAMPLE',
  github: `ghp_${'A'.repeat(36)}`,
  gcp: `AIza${'B'.repeat(35)}`,
  slack: `xoxb-${'A'.repeat(20)}`,
  stripe: `sk_live_${'A'.repeat(24)}`,
  jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
  openssh: '-----BEGIN OPENSSH PRIVATE KEY-----',
  sendgrid: `SG.${'a'.repeat(22)}.${'b'.repeat(43)}`,
  discord: `M${'a'.repeat(23)}.${'b'.repeat(6)}.${'c'.repeat(27)}`,
  databricks: `dapi${'a'.repeat(32)}`,
  gitlab: `glpat-${'ABCDEFGHIJKLMNOPQRST'.repeat(1)}`,
};

function runCli(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/security/secret-scanner-cli.ts', ...args],
    {
      cwd: ROOT,
      encoding: 'utf-8',
    },
  );
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

describe('Secret Scanner — pattern detection', () => {
  it('should expose at least 45 patterns', () => {
    assert.ok(PATTERNS.length >= 45, `expected >=45 patterns, got ${PATTERNS.length}`);
    assert.ok(getPatternCount('all') >= 45);
    assert.ok(getPatternCount('builtin') > 0);
  });

  it('should detect AWS access key IDs', () => {
    const m = scanText(`aws key: ${FAKE.awsKey}`);
    assert.strictEqual(m.length, 1);
    assert.strictEqual(m[0].pattern.name, 'AWS Access Key ID');
    assert.strictEqual(m[0].match, FAKE.awsKey);
  });

  it('should detect GitHub personal access tokens', () => {
    const m = scanText(`token=${FAKE.github}`);
    assert.strictEqual(m.length, 1);
    assert.strictEqual(m[0].pattern.name, 'GitHub Personal Access Token');
  });

  it('should detect GCP API keys', () => {
    const m = scanText(`AIza: ${FAKE.gcp}`);
    assert.strictEqual(m.length, 1);
    assert.strictEqual(m[0].pattern.name, 'GCP API Key');
  });

  it('should detect Slack tokens', () => {
    const m = scanText(`slack ${FAKE.slack}`);
    assert.strictEqual(m.length, 1);
    assert.strictEqual(m[0].pattern.name, 'Slack Token');
  });

  it('should detect Stripe live secret keys', () => {
    const m = scanText(`payment ${FAKE.stripe}`);
    assert.strictEqual(m.length, 1);
    assert.strictEqual(m[0].pattern.name, 'Stripe Live Secret Key');
  });

  it('should detect JWTs', () => {
    const m = scanText(`Bearer ${FAKE.jwt}`);
    assert.strictEqual(m.length, 1);
    assert.strictEqual(m[0].pattern.name, 'JWT Bearer Token');
  });

  it('should detect OpenSSH private keys', () => {
    const m = scanText(FAKE.openssh);
    assert.strictEqual(m.length, 1);
    assert.strictEqual(m[0].pattern.name, 'OpenSSH Private Key');
  });

  it('should detect SendGrid API keys', () => {
    const m = scanText(FAKE.sendgrid);
    assert.strictEqual(m.length, 1);
    assert.strictEqual(m[0].pattern.name, 'SendGrid API Key');
  });

  it('should detect Discord bot tokens', () => {
    const m = scanText(FAKE.discord);
    assert.strictEqual(m.length, 1);
    assert.strictEqual(m[0].pattern.name, 'Discord Bot Token');
  });

  it('should detect Databricks tokens', () => {
    const m = scanText(FAKE.databricks);
    assert.strictEqual(m.length, 1);
    assert.strictEqual(m[0].pattern.name, 'Databricks API Token');
  });

  it('should detect GitLab personal access tokens', () => {
    const m = scanText(FAKE.gitlab);
    assert.strictEqual(m.length, 1);
    assert.strictEqual(m[0].pattern.name, 'GitLab Personal Access Token');
  });

  it('should NOT flag GitHub Actions SHA pins as Codecov tokens', () => {
    // codecov-action pinned by full commit SHA = supply-chain hardening, not a secret.
    const sha = '0fb7174895f61a3b6b78fc075e0cd60383518dac';
    const pin = `uses: codecov/codecov-action@${sha} # v5`;
    const m = scanText(pin);
    assert.strictEqual(
      m.filter((x) => x.pattern.name === 'Codecov Token').length,
      0,
      `SHA pin falsely flagged: ${JSON.stringify(m.map((x) => x.pattern.name))}`,
    );
  });

  it('should still detect real Codecov upload tokens near keyword', () => {
    const token = 'a'.repeat(32);
    const m = scanText(`codecov upload token: "${token}"`);
    assert.strictEqual(m.filter((x) => x.pattern.name === 'Codecov Token').length, 1);
  });

  it('should record line numbers and context', () => {
    const m = scanText(
      'line one\nline two\nSECRET = "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"\nline four',
    );
    assert.strictEqual(m.length, 1);
    assert.strictEqual(m[0].line, 3);
    assert.ok(m[0].context.includes('SECRET'));
  });

  it('should NOT raise false positives on normal code', () => {
    const normal = `const apiKey = process.env.AWS_ACCESS_KEY_ID;
const secret = process.env.SECRET_KEY;
await client.authenticate(apiKey, secret);
// reference: https://github.com/acme/repo/blob/main/README.md
const uuid = "123e4567-e89b-12d3-a456-426614174000";
const alpha = "abcabcabcabcabcabcabcabcabcabc";`;
    const m = scanText(normal);
    assert.strictEqual(m.length, 0, `expected 0 false positives, got: ${JSON.stringify(m)}`);
  });
});

describe('Secret Scanner — entropy filter', () => {
  it('should compute Shannon entropy', () => {
    assert.strictEqual(shannonEntropy('aaaa'), 0);
    assert.ok(shannonEntropy('AB12cdEF34gh56ij') > 3.5);
  });

  it('should drop low-entropy matches when enabled', () => {
    const lowEntropy = `AKIA${'A'.repeat(16)}`; // 20 chars, all identical
    const without = scanText(lowEntropy);
    assert.strictEqual(without.length, 1, 'entropy off should keep the match');
    const withFilter = scanText(lowEntropy, { entropy: true });
    assert.strictEqual(withFilter.length, 0, 'entropy on should drop low-entropy match');
  });

  it('should keep high-entropy matches when enabled', () => {
    // Mixed-case/digit token → genuinely high entropy (unlike FAKE.github which is A*36).
    const githubMixed = `ghp_${'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'}`;
    const m = scanText(`token=${githubMixed}`, { entropy: true });
    assert.strictEqual(m.length, 1);
    assert.ok(m[0].entropyScore !== undefined && m[0].entropyScore >= 3.5);
  });
});

describe('Secret Scanner — redaction', () => {
  it('should keep first 4 + last 4 chars', () => {
    assert.strictEqual(redactSecret('AKIAIOSFODNN7EXAMPLE'), 'AKIA...MPLE');
  });

  it('should fully mask short values', () => {
    assert.strictEqual(redactSecret('short'), '*****');
    assert.strictEqual(redactSecret('ab'), '**');
  });
});

describe('Secret Scanner — report', () => {
  it('should summarize total, category and risk', () => {
    const text = [FAKE.github, FAKE.stripe, FAKE.gcp, FAKE.openssh, FAKE.slack].join('\n');
    const matches = scanText(text);
    const report = buildReport(matches);
    assert.strictEqual(report.total, 5);
    assert.strictEqual(report.byCategory['github'], 1);
    assert.strictEqual(report.byCategory['payment'], 1);
    assert.strictEqual(report.byCategory['gcp'], 1);
    assert.strictEqual(report.byCategory['private-key'], 1);
    assert.strictEqual(report.byCategory['slack'], 1);
    assert.strictEqual(report.byRisk.high, 5);
  });

  it('should apply config risk overrides per category', () => {
    const matches = scanText(`cloud secret ${FAKE.sendgrid}`);
    const report = buildReport(matches, { riskLevels: { cloud: 'high' } });
    assert.strictEqual(report.byRisk.high, 1);
    assert.strictEqual(report.byRisk.medium, 0);
  });
});

describe('Secret Scanner — file scanning', () => {
  function makeTree(): string {
    const dir = mkdtempSync(join(tmpdir(), 'secret-scan-test-'));
    writeFileSync(join(dir, '.gitignore'), 'ignored.txt\n');
    writeFileSync(join(dir, 'credentials.txt'), `aws key: ${FAKE.awsKey}\n`);
    writeFileSync(join(dir, 'ignored.txt'), `${FAKE.github}\n`);
    writeFileSync(join(dir, 'image.png'), `binary ${FAKE.awsKey}\n`);
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'lib.js'), `${FAKE.gitlab}\n`);
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'keep.txt'), `${FAKE.stripe}\n`);
    return dir;
  }

  it('should skip ignored extensions, skip dirs and .gitignore entries', async () => {
    const dir = makeTree();
    try {
      const matches = await scanFiles([dir]);
      const sources = matches.map((m) => m.source.replace(/\\/g, '/'));
      assert.strictEqual(matches.length, 2, JSON.stringify(sources));
      assert.ok(sources.some((s) => s.endsWith('credentials.txt')));
      assert.ok(sources.some((s) => s.endsWith('sub/keep.txt')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should honor extra ignoreExtensions', async () => {
    const dir = makeTree();
    try {
      const matches = await scanFiles([dir], { ignoreExtensions: ['txt'] });
      assert.strictEqual(matches.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should skip files above maxFileSizeBytes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'secret-scan-size-'));
    try {
      writeFileSync(join(dir, 'big.txt'), `x`.repeat(200) + FAKE.github);
      const matches = await scanFiles([dir], { maxFileSizeBytes: 50 });
      assert.strictEqual(matches.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Secret Scanner — URL scanning', () => {
  it('should scan a local HTTP response', async () => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/plain');
      res.end(`aws key ${FAKE.awsKey} present`);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const url = `http://127.0.0.1:${address.port}/health`;
      const matches = await scanUrl(url);
      assert.strictEqual(matches.length, 1);
      assert.strictEqual(matches[0].source, url);
    } finally {
      await new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      });
    }
  });
});

describe('Secret Scanner — CLI exit codes', () => {
  it('should exit 1 when secrets are found', () => {
    const dir = mkdtempSync(join(tmpdir(), 'secret-scan-cli-'));
    try {
      const file = join(dir, 'leak.txt');
      writeFileSync(file, `${FAKE.github}\n`);
      const { status, stdout } = runCli('--scan', file);
      assert.strictEqual(status, 1);
      assert.ok(stdout.includes('GitHub Personal Access Token'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should exit 0 when no secrets are found', () => {
    const dir = mkdtempSync(join(tmpdir(), 'secret-scan-cli-clean-'));
    try {
      const file = join(dir, 'clean.txt');
      writeFileSync(file, 'const x = 1; // nothing sensitive here\n');
      const { status } = runCli('--scan', file);
      assert.strictEqual(status, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should exit 2 on usage error', () => {
    const { status } = runCli();
    assert.strictEqual(status, 2);
  });

  it('should redact values by default and reveal with --no-redact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'secret-scan-cli-redact-'));
    try {
      const file = join(dir, 'leak.txt');
      writeFileSync(file, FAKE.github);
      const full = FAKE.github;

      const redacted = runCli('--scan', file, '--json');
      assert.strictEqual(redacted.status, 1);
      assert.ok(!redacted.stdout.includes(full), 'full secret must not leak when redacted');
      assert.ok(redacted.stdout.includes('ghp_...'), 'redacted value should be present');

      const shown = runCli('--scan', file, '--no-redact', '--json');
      assert.strictEqual(shown.status, 1);
      assert.ok(shown.stdout.includes(full), 'full secret should be shown with --no-redact');

      const parsed = JSON.parse(shown.stdout) as { total: number; byRisk: { high: number } };
      assert.strictEqual(parsed.total, 1);
      assert.strictEqual(parsed.byRisk.high, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
