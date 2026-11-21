/** Tests de la revisión semántica independiente y la consolidación de veredictos
 * (GB-20261119, slice 3). Sin red: `completeFn` inyectado. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { consolidateVerdicts, semanticReview } from '../../src/agents/semantic-review.js';
import { editorialSuccessOf } from '../../src/agents/claim-evidence.js';
import type { CompleteFn } from '../../src/agents/editorial-provider.js';

describe('semanticReview', () => {
  const options = { model: 'mock' };

  it('verdict pass sin hallazgos produce estado sin hallazgos', async () => {
    const ok: CompleteFn = async () => JSON.stringify({ verdict: 'pass', findings: [] });
    const result = await semanticReview('A. B.', 'A. B.', options, ok);
    assert.equal(result.state, 'semantic-review-no-findings');
    assert.equal(result.findings, undefined);
  });

  it('verdict fail con hallazgos los normaliza y conserva', async () => {
    const fail: CompleteFn = async () =>
      JSON.stringify({
        verdict: 'fail',
        findings: [{ fragment: '10 conexiones', discrepancy: 'la fuente dice 8' }],
      });
    const result = await semanticReview('A. B.', 'A. C.', options, fail);
    assert.equal(result.state, 'semantic-review-failed');
    assert.match(result.findings?.[0] ?? '', /10 conexiones/);
  });

  it('una respuesta inconsistente (pass con hallazgos) es inválida', async () => {
    const inconsistent: CompleteFn = async () =>
      JSON.stringify({ verdict: 'pass', findings: ['algo'] });
    await assert.rejects(
      semanticReview('A. B.', 'A. C.', options, inconsistent),
      /Revisión semántica inválida/,
    );
  });
});

describe('consolidateVerdicts', () => {
  it('sin ejes hay veredicto pass', () => {
    assert.deepEqual(consolidateVerdicts([]), {
      verdict: 'pass',
      blockedBy: [],
      unavailable: [],
      warnings: [],
    });
  });

  it('la severidad se ordena blocked > unavailable > partial > pass', () => {
    const blocked = consolidateVerdicts([
      { axis: 'claims', state: 'claim-evidence-failed' },
      { axis: 'semantic', state: 'semantic-review-unavailable' },
      { axis: 'claims-2', state: 'claim-review-partial' },
    ]);
    assert.equal(blocked.verdict, 'blocked');
    assert.deepEqual(blocked.blockedBy, ['claims']);

    const unavailable = consolidateVerdicts([
      { axis: 'semantic', state: 'semantic-review-unavailable' },
      { axis: 'claims', state: 'claim-review-partial' },
    ]);
    assert.equal(unavailable.verdict, 'unavailable');

    const partial = consolidateVerdicts([{ axis: 'claims', state: 'claim-review-partial' }]);
    assert.equal(partial.verdict, 'partial');
    assert.deepEqual(partial.warnings, ['claims']);

    const pass = consolidateVerdicts([
      { axis: 'model-review', state: 'model-review-no-findings' },
      { axis: 'claims', state: 'claim-review-clean' },
      { axis: 'semantic', state: 'semantic-review-no-findings' },
    ]);
    assert.equal(pass.verdict, 'pass');
  });

  it('el veredicto de éxito incorpora el eje semántico', () => {
    assert.equal(
      editorialSuccessOf(
        'draft',
        false,
        'pending',
        'claim-review-clean',
        'semantic-review-no-findings',
      ),
      true,
    );
    assert.equal(
      editorialSuccessOf('draft', false, 'pending', 'claim-review-clean', 'semantic-review-failed'),
      false,
    );
    assert.equal(
      editorialSuccessOf(
        'draft',
        false,
        'pending',
        'claim-review-clean',
        'semantic-review-unavailable',
      ),
      false,
    );
    // summary/synthesis: el eje semántico no corre (no duplicación) y no afecta.
    assert.equal(
      editorialSuccessOf(
        'draft',
        true,
        'model-review-no-findings',
        'claim-review-clean',
        'skipped',
      ),
      true,
    );
  });
});
