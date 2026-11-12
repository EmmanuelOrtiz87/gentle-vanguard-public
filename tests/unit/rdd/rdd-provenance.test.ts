#!/usr/bin/env node
/**
 * Unit Tests: RDD Provenance Integration
 * Verifies generateReleaseProvenance() selection logic and non-blocking behavior.
 *
 * POR QUÉ ESTE TEST RESTAURA EL ÁRBOL (2026-11-11)
 * -------------------------------------------------------------------------
 * `generateReleaseProvenance()` corre el generador SLSA **sobre el ROOT real**:
 * escribe `provenance/gentle-vanguard-provenance.json` (y su `.signed.json`).
 * Con la suite unitaria cableada al gate de pre-push, eso dejó el árbol
 * modificado DURANTE el gate y el tree-fence frenó el push: el test estaba
 * ensuciando el repo y el guardrail lo detectó (bien).
 *
 * Ahora el test:
 *   1. guarda y restaura los dos archivos (el repo queda como estaba), y
 *   2. lo VERIFICA: si el test deja el árbol sucio, falla.
 *
 * Un test que modifica el repo no es un test: es un evento lateral con
 * consecuencias.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { generateReleaseProvenance, type RDDWorkflow } from '../../../src/rdd/rdd-core.ts';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const PROVENANCE_FILES = [
  'provenance/gentle-vanguard-provenance.json',
  'provenance/gentle-vanguard-provenance.signed.json',
];

/** Guarda el estado de los archivos de provenance y devuelve el restaurador. */
function snapshotProvenance(): () => void {
  const backup = new Map<string, Buffer | null>();
  for (const rel of PROVENANCE_FILES) {
    const abs = join(ROOT, rel);
    backup.set(rel, existsSync(abs) ? readFileSync(abs) : null);
  }
  return () => {
    for (const [rel, content] of backup) {
      const abs = join(ROOT, rel);
      if (content === null) {
        if (existsSync(abs)) rmSync(abs, { force: true });
      } else {
        writeFileSync(abs, content);
      }
    }
  };
}

/** ¿El repo quedó sucio? (sólo provenance: es lo que este test toca). */
function provenanceDirty(): boolean {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', 'provenance/'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

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
    const restore = snapshotProvenance();
    try {
      const wf = makeWorkflow({ receipt: null });
      assert.doesNotThrow(() => generateReleaseProvenance(wf));
    } finally {
      restore();
    }
  });

  it('does not throw when receipt references a missing file', () => {
    const restore = snapshotProvenance();
    try {
      const wf = makeWorkflow({
        receipt: { id: 'nonexistent-receipt-id', candidateSha: 'abc123', approved: true },
      });
      assert.doesNotThrow(() => generateReleaseProvenance(wf));
    } finally {
      restore();
    }
  });

  it('does not throw for a fully valid workflow (real sbom + fake receipt)', () => {
    const restore = snapshotProvenance();
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
      restore();
    }
  });

  it('deja el repo limpio: el test no puede ensuciar el árbol', () => {
    const restore = snapshotProvenance();
    try {
      generateReleaseProvenance(makeWorkflow({ receipt: null }));
    } finally {
      restore();
    }
    assert.equal(
      provenanceDirty(),
      false,
      'el test dejó provenance/ modificado: eso rompe el tree-fence del gate de pre-push',
    );
  });
});
