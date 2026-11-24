import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  buildOwaspMapping,
  buildAgenticMapping,
  generateReport,
  generateAgenticReport,
} from '../../src/security/owasp/owasp-agentic-top10.js';

const ROOT = resolve(import.meta.dirname ?? '.', '..', '..');

describe('owasp-agentic-top10', () => {
  it('defines all 10 OWASP Agentic AI categories', () => {
    const mapping = buildOwaspMapping();
    assert.strictEqual(mapping.length, 10);
    const ids = mapping.map((c) => c.id);
    assert.ok(ids.includes('LLM01:2025'));
    assert.ok(ids.includes('LLM10:2025'));
  });

  it('every category has controls and evidence', () => {
    const mapping = buildOwaspMapping();
    for (const cat of mapping) {
      assert.ok(cat.controls.length > 0, `${cat.id} should have controls`);
      assert.ok(cat.evidence.length > 0, `${cat.id} should have evidence`);
      assert.ok(['full', 'partial', 'none'].includes(cat.coverage), `${cat.id} coverage invalid`);
    }
  });

  it('generates a report with coverage scoring', () => {
    const report = generateReport(false);
    assert.strictEqual(report.totalCategories, 10);
    assert.ok(report.overallCoverage >= 0 && report.overallCoverage <= 100);
    assert.strictEqual(report.fullCoverage + report.partialCoverage + report.noneCoverage, 10);
  });

  it('strict mode passes when coverage meets threshold', () => {
    // Current mapping: 10 full + 0 partial = 100% coverage (>= 80% threshold)
    const report = generateReport(true);
    assert.strictEqual(report.overallCoverage, 100);
    assert.strictEqual(report.fullCoverage, 10);
    assert.strictEqual(report.partialCoverage, 0);
    assert.strictEqual(report.noneCoverage, 0);
    assert.ok(report.strictPass);
  });

  it('strict mode fails when coverage is below threshold', () => {
    // Verify the threshold logic: coverage below 80% or any 'none' fails
    const report = generateReport(false);
    const wouldFail = report.overallCoverage < 80 || report.noneCoverage > 0;
    assert.strictEqual(wouldFail, report.overallCoverage < 80 || report.noneCoverage > 0);
  });

  it('covers all 10 categories fully', () => {
    const mapping = buildOwaspMapping();
    for (const cat of mapping) {
      assert.strictEqual(cat.coverage, 'full', `${cat.id} should be fully covered`);
    }
  });

  it('covers the highest-risk categories fully', () => {
    const mapping = buildOwaspMapping();
    const promptInjection = mapping.find((c) => c.id === 'LLM01:2025');
    const excessiveAgency = mapping.find((c) => c.id === 'LLM06:2025');
    assert.strictEqual(promptInjection?.coverage, 'full');
    assert.strictEqual(excessiveAgency?.coverage, 'full');
  });
});

// ── OWASP Top 10 for Agentic Applications 2026 (ASI01..ASI10) ──────────────
//
// El modulo se llama "agentic" pero hasta 2026-11-23 cubria la lista LLM. La
// lista agentic (publicada el 2025-12-09) es el canon vigente para sistemas
// autonomos. Estos tests fijan que la lista existe, que cada categoria tiene
// controles y evidencia, y — lo mas importante — que CADA control declarado
// EXISTE en disco: un mapeo con rutas inventadas certifica cobertura que no
// hay.

describe('owasp top 10 for agentic applications 2026 (ASI)', () => {
  it('defines all 10 agentic categories', () => {
    const mapping = buildAgenticMapping();
    assert.strictEqual(mapping.length, 10);
    const ids = mapping.map((c) => c.id);
    for (let i = 1; i <= 10; i += 1) {
      assert.ok(ids.includes(`ASI${String(i).padStart(2, '0')}:2026`), `falta ASI${i}`);
    }
  });

  it('every agentic category has controls and evidence', () => {
    for (const cat of buildAgenticMapping()) {
      assert.ok(cat.controls.length > 0, `${cat.id} should have controls`);
      assert.ok(cat.evidence.length > 0, `${cat.id} should have evidence`);
      assert.ok(['full', 'partial', 'none'].includes(cat.coverage), `${cat.id} coverage invalid`);
    }
  });

  it('every declared control EXISTS in the repo (no invented paths)', () => {
    for (const cat of buildAgenticMapping()) {
      for (const control of cat.controls) {
        assert.ok(
          existsSync(join(ROOT, control)),
          `${cat.id} declara un control inexistente: ${control}`,
        );
      }
    }
  });

  it('generates an agentic report with coverage scoring', () => {
    const report = generateAgenticReport(false);
    assert.strictEqual(report.totalCategories, 10);
    assert.strictEqual(report.fullCoverage + report.partialCoverage + report.noneCoverage, 10);
    assert.ok(report.overallCoverage >= 80, `cobertura insuficiente: ${report.overallCoverage}%`);
  });

  it('strict mode passes for the agentic list', () => {
    const report = generateAgenticReport(true);
    assert.ok(report.strictPass, `strict FAIL: ${report.overallCoverage}%`);
    assert.strictEqual(report.noneCoverage, 0);
  });

  it('the LLM list and the agentic list are BOTH covered (two current canons)', () => {
    const llm = buildOwaspMapping().map((c) => c.id);
    const agentic = buildAgenticMapping().map((c) => c.id);
    assert.strictEqual(llm.length, 10);
    assert.strictEqual(agentic.length, 10);
    // Ningun id puede vivir en las dos listas: son listas distintas.
    const overlap = llm.filter((id) => agentic.includes(id));
    assert.deepStrictEqual(overlap, []);
  });
});
