/** Tests unitarios del verificador de evidencia por afirmación (GB-20261119).
 * La clasificación usa un `completeFn` inyectado: sin red, sin proveedores. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyClaims,
  claimStateOf,
  editorialSuccessOf,
  splitSentences,
} from '../../src/agents/claim-evidence.js';
import type { ClaimReport } from '../../src/agents/claim-evidence.js';
import type { CompleteFn } from '../../src/agents/editorial-provider.js';

describe('splitSentences', () => {
  it('parte por punto seguido de mayúscula, dígito o apertura de cita', () => {
    const sentences = splitSentences(
      'El middleware conserva las respuestas. Además cachea lecturas. «Resumen» aparte.',
    );
    assert.equal(sentences.length, 3);
    assert.match(sentences[0], /^El middleware/);
    assert.match(sentences[2], /^«Resumen»/);
  });

  it('no parte decimales, miles, versiones ni URLs', () => {
    const one = splitSentences(
      'El límite es 12,5 EUR y el total 1.000 solicitudes en la versión v2.1 del contrato.',
    );
    assert.equal(one.length, 1);
    const url = splitSentences(
      'El repositorio vive en bitbucket.org/directvla/ms-buy-flow-mw/src/main/. Sigue más texto.',
    );
    assert.equal(url.length, 2);
    assert.match(url[0], /ms-buy-flow-mw\/src\/main\/\.$/);
  });

  it('no parte abreviaciones frecuentes ni iniciales de nombre', () => {
    assert.equal(splitSentences('Es aproximado, aprox. el doble. Sigue la oración.').length, 2);
    assert.equal(splitSentences('Lo firmó J. Pérez. Sigue la oración.').length, 2);
  });

  it('no parte abreviaciones multilingües EN/PT (e.g., approx., prof., eng., ltda.)', () => {
    // English
    const en = splitSentences(
      'The service fee is approx. 15 USD per month. Mr. Smith approved it.',
    );
    assert.equal(en.length, 2);
    assert.match(en[0], /approx\. 15 USD/);
    assert.match(en[1], /^Mr\. Smith/);

    // Português
    const pt = splitSentences(
      'O projeto da Eng. Souza com a empresa Alfa Ltda. foi concluído. Ótimo resultado.',
    );
    assert.equal(pt.length, 2);
    assert.match(pt[0], /Alfa Ltda\. foi/);
    assert.match(pt[1], /^Ótimo resultado\./);
  });

  it('conserva las atribuciones [F1] dentro de la oración y cierra sin punto final', () => {
    const sentences = splitSentences(
      'La guía Backend describe lecturas cacheables [F2] y el acta propone GraphQL [F1]',
    );
    assert.equal(sentences.length, 1);
    assert.match(sentences[0], /\[F1\]$/);
  });
});

describe('classifyClaims', () => {
  const sources = [
    { id: 'F1', name: 'acta.md', text: 'El acta propone enviar la consulta GraphQL en el cuerpo.' },
    { id: 'F2', name: 'guia.md', text: 'El middleware conserva las respuestas en Redis.' },
  ];

  const verdictFor = (sentence: string) => {
    if (sentence.includes('Redis'))
      return { index: 0, claimClass: 'ACREDITADA', sourceId: 'F2', finding: '' };
    if (sentence.includes('propone'))
      return { index: 0, claimClass: 'ACREDITADA', sourceId: 'F1', finding: '' };
    return {
      index: 0,
      claimClass: 'SIN_ACREDITAR',
      sourceId: '',
      finding: 'ninguna fuente lo respalda',
    };
  };

  const mockComplete: CompleteFn = async (_m, _e, _t, _prompt, input) => {
    const parsed = JSON.parse(input) as { sentences: Array<{ index: number; sentence: string }> };
    return JSON.stringify({
      verdicts: parsed.sentences.map((s) => ({ ...verdictFor(s.sentence), index: s.index })),
    });
  };

  it('clasifica oraciones contra fuentes y marca blocking con SIN_ACREDITAR', async () => {
    const report = await classifyClaims(
      [
        'El middleware conserva las respuestas en Redis.',
        'El acta propone GraphQL en el cuerpo.',
        'Factura automáticamente en Marte.',
      ],
      sources,
      { model: 'mock' },
      mockComplete,
    );
    assert.equal(report.summary.total, 3);
    assert.equal(report.summary.accredited, 2);
    assert.equal(report.summary.unaccredited, 1);
    assert.equal(report.blocking, true);
    assert.equal(report.claims[1].sourceId, 'F1');
    assert.match(report.claims[2].finding ?? '', /ninguna fuente/);
  });

  it('reparte en lotes preservando los índices globales', async () => {
    const report = await classifyClaims(
      [
        'El middleware conserva las respuestas en Redis.',
        'El acta propone GraphQL en el cuerpo.',
        'Factura automáticamente en Marte.',
      ],
      sources,
      { model: 'mock', batchSize: 2 },
      mockComplete,
    );
    assert.deepEqual(
      report.claims.map((c) => [c.index, c.claimClass]),
      [
        [0, 'ACREDITADA'],
        [1, 'ACREDITADA'],
        [2, 'SIN_ACREDITAR'],
      ],
    );
  });

  it('un lote que falla deja sus oraciones en unclassified con el error, sin inventar veredictos', async () => {
    const failingComplete: CompleteFn = async (_m, _e, _t, _prompt, input) => {
      if (input.includes('"sentence":"Falla este lote completo."'))
        throw new Error('proveedor caído');
      const parsed = JSON.parse(input) as { sentences: Array<{ index: number; sentence: string }> };
      return JSON.stringify({
        verdicts: parsed.sentences.map((s) => ({
          index: s.index,
          claimClass: 'ACREDITADA',
          sourceId: 'F1',
        })),
      });
    };
    const report = await classifyClaims(
      ['Falla este lote completo.', 'El acta propone GraphQL en el cuerpo.'],
      sources,
      { model: 'mock', batchSize: 1 },
      failingComplete,
    );
    assert.equal(report.claims.length, 1);
    assert.deepEqual(report.unclassified, [{ index: 0, sentence: 'Falla este lote completo.' }]);
    assert.equal(report.errors.length, 1);
    assert.match(report.errors[0], /proveedor caído/);
    assert.equal(report.blocking, false);
  });

  it('una respuesta sin verdicts deja el lote sin clasificar', async () => {
    const emptyComplete: CompleteFn = async () => JSON.stringify({ note: 'sin verdicts' });
    const report = await classifyClaims(
      ['Oración cualquiera.'],
      sources,
      { model: 'mock' },
      emptyComplete,
    );
    assert.equal(report.unclassified.length, 1);
    assert.equal(report.claims.length, 0);
    assert.ok(report.errors.length >= 1);
  });
});

describe('claimStateOf y editorialSuccessOf (integración editorial-agent)', () => {
  const baseReport: ClaimReport = {
    claims: [],
    unclassified: [],
    summary: { total: 0, accredited: 0, inference: 0, unaccredited: 0, unclassified: 0 },
    blocking: false,
    errors: [],
  };

  it('SIN_ACREDITAR produce estado bloqueante; errores y vacíos producen parcial', () => {
    assert.equal(claimStateOf({ ...baseReport }), 'claim-review-clean');
    assert.equal(claimStateOf({ ...baseReport, blocking: true }), 'claim-evidence-failed');
    assert.equal(
      claimStateOf({ ...baseReport, unclassified: [{ index: 0, sentence: 'x' }] }),
      'claim-review-partial',
    );
    assert.equal(claimStateOf({ ...baseReport, errors: ['timeout'] }), 'claim-review-partial');
  });

  it('el veredicto de éxito combina draft, revisión de resumen y estado de afirmaciones', () => {
    assert.equal(editorialSuccessOf('draft', false, 'pending', 'claim-review-clean'), true);
    assert.equal(
      editorialSuccessOf('draft', true, 'model-review-no-findings', 'claim-review-clean'),
      true,
    );
    assert.equal(
      editorialSuccessOf('draft', true, 'model-review-failed', 'claim-review-clean'),
      false,
    );
    assert.equal(editorialSuccessOf('blocked', false, 'pending', 'claim-review-clean'), false);
    assert.equal(editorialSuccessOf('draft', false, 'pending', 'claim-evidence-failed'), false);
    assert.equal(editorialSuccessOf('draft', false, 'pending', 'claim-review-unavailable'), false);
    assert.equal(editorialSuccessOf('draft', false, 'pending', 'claim-review-partial'), true);
  });
});
