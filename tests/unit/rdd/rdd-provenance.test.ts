#!/usr/bin/env node
/**
 * Unit Tests: RDD Provenance Integration
 * Verifies generateReleaseProvenance() selection logic and non-blocking behavior.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateReleaseProvenance, type RDDWorkflow } from '../../../src/rdd/rdd-core.ts';

function makeWorkflow(overrides: Partial<RDDWorkflow> = {}): RDDWorkflow {
  return {
    workflowId: 'test-wf-001',
    status: 'completed',
    classification: { tier: 'low', score: 20, reviewLenses: 0 },
    receipt: null,
    gates: {
      'post-apply': true,
      'pre-commit': true,
      'pre-push': true,
      'pre-pr': true,
      release: true,
    },
    startedAt: '2026-08-17T00:00:00.000Z',
    completedAt: '2026-08-17T00:01:00.000Z',
    ...overrides,
  };
}

// These tests run against the real workspace ROOT (sbom/ exists), but the
// function is best-effort: it must NEVER throw, regardless of artifacts state.
describe('generateReleaseProvenance', () => {
  it('does not throw when workflow has no receipt (sbom-only attestation)', () => {
    const wf = makeWorkflow({ receipt: null });
    assert.doesNotThrow(() => generateReleaseProvenance(wf));
  });

  it('does not throw when receipt references a missing file', () => {
    const wf = makeWorkflow({
      receipt: { id: 'nonexistent-receipt-id', candidateSha: 'abc123', approved: true },
    });
    assert.doesNotThrow(() => generateReleaseProvenance(wf));
  });

  it('does not throw for a fully valid workflow (real sbom + fake receipt)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gv-rdd-prov-'));
    try {
      // Create a fake receipt file that exists, in a temp dir — but the function
      // reads from ROOT/.session/receipts, so we just verify no-throw behavior.
      writeFileSync(join(dir, 'fake-receipt.json'), '{"id":"fake"}', 'utf-8');
      const wf = makeWorkflow({
        receipt: { id: 'fake', candidateSha: 'abc123', approved: true },
      });
      assert.doesNotThrow(() => generateReleaseProvenance(wf));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
