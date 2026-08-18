#!/usr/bin/env node
/**
 * Unit Tests: SLSA Provenance Generator
 * Verifies digest computation, statement building and L1 validation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  sha256Digest,
  sha256Of,
  toTimestamp,
  buildProvenance,
  validateProvenance,
  artifactDescriptor,
  parseEnvironment,
  parseArgs,
  IN_TOTO_STATEMENT_V1,
  SLSA_PROVENANCE_V1,
  DEFAULT_BUILD_TYPE,
  DEFAULT_BUILDER_ID,
  type InTotoStatement,
} from '../../src/slsa-provenance.ts';

function makeTempFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'gv-slsa-test-'));
  const file = join(dir, 'artifact.json');
  writeFileSync(file, content, 'utf-8');
  return file;
}

function sampleStatement(): InTotoStatement {
  const dir = mkdtempSync(join(tmpdir(), 'gv-slsa-sample-'));
  const file = join(dir, 'sample.json');
  writeFileSync(file, '{"sample":true}', 'utf-8');
  return buildProvenance({
    artifacts: [file],
    buildType: DEFAULT_BUILD_TYPE,
    builderId: DEFAULT_BUILDER_ID,
    repoUrl: 'https://github.com/gentle-vanguard/gentle-vanguard',
    gitCommit: 'abc123',
    gitRef: 'refs/heads/develop',
    output: '',
  });
}

describe('sha256Digest', () => {
  it('computes the SHA-256 of a file', () => {
    const file = makeTempFile('hello slsa');
    try {
      const digest = sha256Digest(file);
      assert.match(digest, /^[0-9a-f]{64}$/);
      // "hello slsa" sha256 (verified vector)
      assert.equal(digest, 'a92fdf5a57f2f0780bbb85bb611357adc5209a2346ce74e71c7c256d4706443d');
    } finally {
      rmSync(join(file, '..'), { recursive: true, force: true });
    }
  });

  it('is deterministic for identical content', () => {
    const f1 = makeTempFile('same content');
    const f2 = makeTempFile('same content');
    try {
      assert.equal(sha256Digest(f1), sha256Digest(f2));
    } finally {
      rmSync(join(f1, '..'), { recursive: true, force: true });
      rmSync(join(f2, '..'), { recursive: true, force: true });
    }
  });
});

describe('sha256Of', () => {
  it('computes stable hex digest of a string', () => {
    assert.equal(sha256Of('abc'), sha256Of('abc'));
    assert.match(sha256Of('abc'), /^[0-9a-f]{64}$/);
  });
});

describe('toTimestamp', () => {
  it('formats RFC3339 UTC with Z and no ms', () => {
    const ts = toTimestamp(new Date('2026-08-17T10:30:00.123Z'));
    assert.match(ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.equal(ts, '2026-08-17T10:30:00Z');
  });
});

describe('buildProvenance', () => {
  it('produces an in-toto v1 statement with SLSA v1 predicate', () => {
    const file = makeTempFile('{"name":"test"}');
    try {
      const stmt = buildProvenance({
        artifacts: [file],
        buildType: DEFAULT_BUILD_TYPE,
        builderId: DEFAULT_BUILDER_ID,
        repoUrl: 'https://github.com/gentle-vanguard/gentle-vanguard',
        gitCommit: 'abc123',
        gitRef: 'refs/heads/develop',
        output: '',
      });
      assert.equal(stmt._type, IN_TOTO_STATEMENT_V1);
      assert.equal(stmt.predicateType, SLSA_PROVENANCE_V1);
      assert.equal(stmt.subject.length, 1);
      assert.equal(stmt.subject[0].name, 'artifact.json');
      assert.ok(stmt.subject[0].digest?.sha256);
      assert.equal(stmt.predicate.buildDefinition.buildType, DEFAULT_BUILD_TYPE);
      assert.equal(stmt.predicate.buildDefinition.externalParameters.repository, 'https://github.com/gentle-vanguard/gentle-vanguard');
      assert.equal(stmt.predicate.runDetails.builder.id, DEFAULT_BUILDER_ID);
      assert.ok(stmt.predicate.runDetails.metadata?.startedOn);
      assert.ok(stmt.predicate.runDetails.metadata?.finishedOn);
    } finally {
      rmSync(join(file, '..'), { recursive: true, force: true });
    }
  });

  it('records git commit as resolved dependency digest', () => {
    const stmt = sampleStatement();
    const dep = stmt.predicate.buildDefinition.resolvedDependencies?.[0];
    assert.ok(dep);
    assert.equal(dep.digest?.gitCommit, 'abc123');
    assert.equal(dep.name, 'refs/heads/develop');
  });

  it('uses empty resolvedDependencies when no repo', () => {
    const stmt = buildProvenance({
      artifacts: [],
      buildType: DEFAULT_BUILD_TYPE,
      builderId: DEFAULT_BUILDER_ID,
      repoUrl: '',
      gitCommit: '',
      output: '',
    });
    assert.deepEqual(stmt.predicate.buildDefinition.resolvedDependencies, []);
  });
});

describe('artifactDescriptor', () => {
  it('builds a ResourceDescriptor with sha256 digest', () => {
    const file = makeTempFile('{}');
    try {
      const desc = artifactDescriptor(file, 'https://github.com/gentle-vanguard/gentle-vanguard');
      assert.equal(desc.name, 'artifact.json');
      assert.ok(desc.digest?.sha256);
      assert.equal(desc.mediaType, 'application/json');
      assert.match(desc.uri ?? '', /^https:\/\/github\.com\/gentle-vanguard\/gentle-vanguard#artifact\.json$/);
    } finally {
      rmSync(join(file, '..'), { recursive: true, force: true });
    }
  });
});

describe('validateProvenance', () => {
  it('accepts a well-formed statement', () => {
    const errors = validateProvenance(sampleStatement());
    assert.deepEqual(errors, []);
  });

  it('rejects missing _type', () => {
    const stmt = sampleStatement();
    (stmt as { _type?: string })._type = 'wrong';
    const errors = validateProvenance(stmt);
    assert.ok(errors.some((e) => e.includes('_type')));
  });

  it('rejects wrong predicateType', () => {
    const stmt = sampleStatement();
    stmt.predicateType = 'https://slsa.dev/provenance/v0.2';
    const errors = validateProvenance(stmt);
    assert.ok(errors.some((e) => e.includes('predicateType')));
  });

  it('rejects missing subject digests', () => {
    const stmt = sampleStatement();
    stmt.subject = [{ uri: 'file://x' }];
    const errors = validateProvenance(stmt);
    assert.ok(errors.some((e) => e.includes('digest.sha256')));
  });

  it('rejects missing buildDefinition (SLSA L1 requirement)', () => {
    const stmt = sampleStatement();
    (stmt.predicate as { buildDefinition?: unknown }).buildDefinition = undefined;
    const errors = validateProvenance(stmt);
    assert.ok(errors.some((e) => e.includes('buildDefinition')));
  });

  it('rejects missing builder id (SLSA L1 requirement)', () => {
    const stmt = sampleStatement();
    (stmt.predicate.runDetails.builder as { id?: string }).id = '';
    const errors = validateProvenance(stmt);
    assert.ok(errors.some((e) => e.includes('builder.id')));
  });
});

describe('parseEnvironment', () => {
  it('parses k=v,k2=v2 pairs', () => {
    assert.deepEqual(parseEnvironment('a=1,b=two'), { a: '1', b: 'two' });
  });
  it('returns empty object for undefined', () => {
    assert.deepEqual(parseEnvironment(undefined), {});
  });
});

describe('parseArgs', () => {
  it('defaults to generate action with defaults', () => {
    const cli = parseArgs([]);
    assert.equal(cli.action, 'generate');
    assert.equal(cli.buildType, DEFAULT_BUILD_TYPE);
    assert.equal(cli.builderId, DEFAULT_BUILDER_ID);
  });

  it('parses verify action with file', () => {
    const cli = parseArgs(['verify', '--file', 'provenance/x.json']);
    assert.equal(cli.action, 'verify');
    assert.equal(cli.file, 'provenance/x.json');
  });

  it('collects multiple artifacts after -a', () => {
    const cli = parseArgs(['generate', '-a', 'a.json', 'b.json', '--repo', 'https://x']);
    assert.deepEqual(cli.artifacts, ['a.json', 'b.json']);
    assert.equal(cli.repoUrl, 'https://x');
  });
});
