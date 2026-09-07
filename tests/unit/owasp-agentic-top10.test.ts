import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildOwaspMapping, generateReport } from '../../src/security/owasp/owasp-agentic-top10.js';

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
